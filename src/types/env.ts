import type { RequestCoalescer } from "../do/RequestCoalescer";

/**
 * Environment bindings and variables for the Worker
 *
 * This is now generic - you can configure it for any type of coalesced request.
 */
export type Env = {
  // Generic Durable Object namespace for request coalescing
  REQUEST_COALESCER: DurableObjectNamespace<RequestCoalescer>;

  // API base URLs - add more as needed for different resources
  PRODUCT_API_BASE?: string;

  // Tunables for cache TTLs
  FRESH_TTL_MS?: string; // e.g. "10000" (10 seconds)
  STALE_TTL_MS?: string; // e.g. "60000" (60 seconds)
};
