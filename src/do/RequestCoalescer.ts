import { DurableObject } from "cloudflare:workers";
import type {
  Env,
  CoalescedKey,
  SerializableResponse,
  CacheEntry,
} from "../types";

/**
 * Configuration for building cache keys and upstream API URLs
 */
export interface CoalescerConfig {
  /**
   * Builds the cache key from request parameters
   * This determines what makes two requests "identical" for coalescing
   *
   * @example
   * // For products by ID and fields:
   * (params) => `${params.productId}::${params.fields.sort().join(',')}`
   *
   * // For user data by ID only:
   * (params) => params.userId
   */
  buildCacheKey: (params: Record<string, any>) => CoalescedKey;

  /**
   * Builds the upstream API URL from request parameters
   *
   * @example
   * // For products API:
   * (params, apiBase) => {
   *   const url = new URL(`${apiBase}/product`);
   *   url.searchParams.set('productId', params.productId);
   *   if (params.fields?.length) url.searchParams.set('fields', params.fields.join(','));
   *   return url.toString();
   * }
   */
  buildUpstreamUrl: (params: Record<string, any>, apiBase: string) => string;
}

/**
 * RequestCoalescer is a generic Durable Object that implements request coalescing and multi-tier caching.
 *
 * **Purpose:**
 * - Prevents thundering herd: Multiple concurrent identical requests are deduplicated into one upstream call
 * - Multi-tier caching: Memory → Durable Object Storage → Upstream API
 * - Stale-while-revalidate: Returns stale data immediately while refreshing in background
 *
 * **Cache Hierarchy:**
 * 1. Memory cache (fastest, lost on hibernation)
 * 2. Persistent storage (survives hibernation, per-DO instance)
 * 3. Upstream API (fallback)
 */
export class RequestCoalescer extends DurableObject<Env> {
  /**
   * Map of in-flight requests to prevent duplicate concurrent fetches.
   * Key: coalesced request key, Value: Promise of the upstream fetch
   */
  private inflightRequests = new Map<
    CoalescedKey,
    Promise<SerializableResponse>
  >();

  /**
   * Ephemeral in-memory cache for fastest access.
   * Lost on hibernation but provides sub-millisecond response times.
   */
  private memoryCache = new Map<CoalescedKey, CacheEntry>();

  /** Time in milliseconds that cached data is considered fresh */
  private readonly FRESH_TTL_MS: number;

  /** Time in milliseconds that stale data can still be served (with background refresh) */
  private readonly STALE_TTL_MS: number;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Configure TTLs with safe defaults
    this.FRESH_TTL_MS = Number(env.FRESH_TTL_MS ?? 10_000); // 10s fresh
    this.STALE_TTL_MS = Number(env.STALE_TTL_MS ?? 60_000); // 60s stale
  }

  /**
   * Retrieves data with request coalescing and multi-tier caching.
   * This is a generic method that can handle any type of request based on the provided configuration.
   *
   * **Request Flow:**
   * 1. Check memory cache (fastest)
   * 2. Check persistent storage
   * 3. Coalesce with any in-flight requests for the same key
   * 4. Serve stale data if available (with background refresh)
   * 5. Fetch from upstream (as last resort)
   *
   * @param params - Request parameters (e.g., { productId, fields } or { userId, options })
   * @param apiBase - Base URL of the upstream API
   * @param config - Configuration for building cache keys and upstream URLs
   * @returns Serializable response containing status, headers, and body
   *
   * @remarks
   * This is an RPC method called by the Worker. Multiple concurrent calls
   * with identical cache keys will be coalesced into a single upstream request.
   */
  async fetchCoalesced(
    params: Record<string, any>,
    apiBase: string,
    config: CoalescerConfig,
  ): Promise<SerializableResponse> {
    const cacheKey = config.buildCacheKey(params);
    const now = Date.now();

    // Step 1: Try memory cache (sub-millisecond response)
    const memoryCacheResult = this.checkMemoryCache(cacheKey, now);
    if (memoryCacheResult) {
      return memoryCacheResult;
    }

    // Step 2: Try persistent storage
    const storageCacheResult = await this.checkStorageCache(cacheKey, now);
    if (storageCacheResult) {
      return storageCacheResult;
    }

    // Step 3: Check if a request is already in-flight for this key
    const inflightResult = this.checkInflightRequest(cacheKey);
    if (inflightResult) {
      return inflightResult;
    }

    // Step 4: Try serving stale data (if within stale window)
    const staleResult = await this.tryServeStale(
      cacheKey,
      params,
      apiBase,
      config,
      now,
    );
    if (staleResult) {
      return staleResult;
    }

    // Step 5: No cache available - fetch from upstream and coalesce
    return this.fetchAndCoalesce(cacheKey, params, apiBase, config);
  }

  /**
   * Checks the in-memory cache for fresh data.
   *
   * @param cacheKey - The cache key to look up
   * @param now - Current timestamp in milliseconds
   * @returns Response if found and fresh, null otherwise
   */
  private checkMemoryCache(
    cacheKey: CoalescedKey,
    now: number,
  ): SerializableResponse | null {
    const cached = this.memoryCache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
      return {
        status: cached.status,
        headers: cached.headers,
        body: cached.body,
      };
    }

    return null;
  }

  /**
   * Checks persistent storage for fresh data.
   * If found, also warms the memory cache.
   *
   * @param cacheKey - The cache key to look up
   * @param now - Current timestamp in milliseconds
   * @returns Response if found and fresh, null otherwise
   */
  private async checkStorageCache(
    cacheKey: CoalescedKey,
    now: number,
  ): Promise<SerializableResponse | null> {
    const persisted = await this.ctx.storage.get<CacheEntry>(cacheKey);

    if (!persisted) {
      return null;
    }

    const isFresh = persisted.persistedAt + this.FRESH_TTL_MS > now;
    if (!isFresh) {
      return null;
    }

    // Warm the memory cache for subsequent fast access
    this.memoryCache.set(cacheKey, {
      ...persisted,
      expiresAt: now + this.FRESH_TTL_MS,
    });

    return {
      status: persisted.status,
      headers: persisted.headers,
      body: persisted.body,
    };
  }

  /**
   * Checks if there's already an in-flight request for this cache key.
   * If so, piggybacks on that request instead of making a duplicate call.
   *
   * @param cacheKey - The cache key to check
   * @returns Promise of the in-flight request, or null if none exists
   */
  private checkInflightRequest(
    cacheKey: CoalescedKey,
  ): Promise<SerializableResponse> | null {
    return this.inflightRequests.get(cacheKey) ?? null;
  }

  /**
   * Attempts to serve stale data if available and within the stale window.
   * When stale data is served, a background refresh is triggered.
   *
   * This implements the "stale-while-revalidate" pattern.
   *
   * @param cacheKey - The cache key
   * @param params - Request parameters
   * @param apiBase - API base URL
   * @param config - Coalescer configuration
   * @param now - Current timestamp
   * @returns Stale response if available, null otherwise
   */
  private async tryServeStale(
    cacheKey: CoalescedKey,
    params: Record<string, any>,
    apiBase: string,
    config: CoalescerConfig,
    now: number,
  ): Promise<SerializableResponse | null> {
    const persisted = await this.ctx.storage.get<CacheEntry>(cacheKey);

    if (!persisted) {
      return null;
    }

    const isWithinStaleWindow = persisted.persistedAt + this.STALE_TTL_MS > now;
    if (!isWithinStaleWindow) {
      return null;
    }

    // Trigger background refresh (fire-and-forget)
    // Concurrent refresh requests will be coalesced
    void this.backgroundRefresh(cacheKey, params, apiBase, config);

    // Return stale data immediately
    return {
      status: persisted.status,
      headers: { ...persisted.headers, "CF-Cache-Status": "STALE" },
      body: persisted.body,
    };
  }

  /**
   * Fetches from upstream and registers the request as in-flight to enable coalescing.
   * Multiple concurrent calls with the same key will await the same promise.
   *
   * @param cacheKey - The cache key
   * @param params - Request parameters
   * @param apiBase - API base URL
   * @param config - Coalescer configuration
   * @returns Promise of the response
   */
  private fetchAndCoalesce(
    cacheKey: CoalescedKey,
    params: Record<string, any>,
    apiBase: string,
    config: CoalescerConfig,
  ): Promise<SerializableResponse> {
    const fetchPromise = this.fetchUpstreamAndCache(
      cacheKey,
      params,
      apiBase,
      config,
    ).finally(() => {
      // Clean up the in-flight map when done
      this.inflightRequests.delete(cacheKey);
    });

    this.inflightRequests.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  /**
   * Triggers a background refresh for stale data.
   * If a refresh is already in progress, it piggybacks on that request.
   *
   * @param cacheKey - The cache key
   * @param params - Request parameters
   * @param apiBase - API base URL
   * @param config - Coalescer configuration
   */
  private async backgroundRefresh(
    cacheKey: CoalescedKey,
    params: Record<string, any>,
    apiBase: string,
    config: CoalescerConfig,
  ): Promise<void> {
    // If already refreshing, don't start another one
    if (this.inflightRequests.has(cacheKey)) {
      return;
    }

    const refreshPromise = this.fetchUpstreamAndCache(
      cacheKey,
      params,
      apiBase,
      config,
    ).finally(() => {
      this.inflightRequests.delete(cacheKey);
    });

    this.inflightRequests.set(cacheKey, refreshPromise);
    await refreshPromise;
  }

  /**
   * Fetches data from the upstream API and caches it in both memory and storage.
   * Falls back to Last Known Good (LKG) if upstream fails or returns 5xx error.
   *
   * @param cacheKey - The cache key
   * @param params - Request parameters
   * @param apiBase - Base URL of the upstream API
   * @param config - Coalescer configuration
   * @returns Serializable response from upstream or LKG fallback
   */
  private async fetchUpstreamAndCache(
    cacheKey: CoalescedKey,
    params: Record<string, any>,
    apiBase: string,
    config: CoalescerConfig,
  ): Promise<SerializableResponse> {
    // Build the upstream API URL using the provided configuration
    const url = config.buildUpstreamUrl(params, apiBase);

    try {
      // Fetch from upstream
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      // If upstream returns 5xx error, fall back to LKG
      if (response.status >= 500) {
        const lkg = await this.getLastKnownGood(cacheKey);
        if (lkg) {
          return lkg;
        }
      }

      // Parse response body (gracefully handle non-JSON)
      const body = await response.json().catch(() => null);

      // Construct response headers
      const headers: Record<string, string> = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${Math.floor(this.FRESH_TTL_MS / 1000)}, stale-while-revalidate=${Math.floor(this.STALE_TTL_MS / 1000)}`,
        "CF-Cache-Status": "MISS", // Indicates this came from upstream
      };

      const now = Date.now();
      const cacheEntry: CacheEntry = {
        status: response.status,
        headers,
        body,
        expiresAt: now + this.FRESH_TTL_MS,
        persistedAt: now,
      };

      // Store in both caches (memory for speed, storage for persistence)
      // Only cache successful responses (2xx/3xx)
      if (response.status < 400) {
        this.memoryCache.set(cacheKey, cacheEntry);
        await this.ctx.storage.put(cacheKey, cacheEntry);
      }

      return {
        status: response.status,
        headers,
        body,
      };
    } catch (error) {
      // Network error, timeout, or other fetch failure
      // Try to return Last Known Good from storage
      const lkg = await this.getLastKnownGood(cacheKey);
      if (lkg) {
        return lkg;
      }

      // No LKG available, throw the error
      throw error;
    }
  }

  /**
   * Retrieves Last Known Good (LKG) data from storage, ignoring TTL.
   * This is used as a fallback when upstream is unavailable or returns errors.
   *
   * @param cacheKey - The cache key
   * @returns LKG response with special header, or null if not found
   */
  private async getLastKnownGood(
    cacheKey: CoalescedKey,
  ): Promise<SerializableResponse | null> {
    const persisted = await this.ctx.storage.get<CacheEntry>(cacheKey);

    if (!persisted) {
      return null;
    }

    // Return LKG regardless of age, with special header indicating fallback
    return {
      status: persisted.status,
      headers: {
        ...persisted.headers,
        "CF-Cache-Status": "LKG",
        "X-LKG-Age": String(Date.now() - persisted.persistedAt),
      },
      body: persisted.body,
    };
  }
}
