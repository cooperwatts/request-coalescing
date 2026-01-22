import type { Env } from "../types";
import type { RequestCoalescer, CoalescerConfig } from "../do/RequestCoalescer";

/**
 * Configuration for creating a coalesced request handler
 */
export interface RouteConfig<
  T extends Record<string, any> = Record<string, any>,
> {
  /**
   * Name of the Durable Object binding in wrangler.jsonc
   */
  doBindingName: keyof Env;

  /**
   * Name of the environment variable containing the upstream API base URL
   */
  apiBaseEnvVar: keyof Env;

  /**
   * Default API base URL if the environment variable is not set
   */
  defaultApiBase?: string;

  /**
   * Parses and validates request parameters from the incoming Request
   * Returns the parameters or an error Response
   */
  parseRequest: (request: Request) => T | Response;

  /**
   * Builds a stable Durable Object name from the request parameters
   * Ensures requests with the same parameters route to the same DO instance
   *
   * @example
   * // For products, route by product ID:
   * (params) => params.productId
   *
   * // For complex keys, normalize:
   * (params) => `${params.userId}::${params.fields.sort().join(',')}`
   */
  buildDOName: (params: T) => string;

  /**
   * Coalescer configuration for cache key and upstream URL building
   */
  coalescerConfig: CoalescerConfig;
}

/**
 * Creates a generic request handler with coalescing via Durable Objects
 *
 * This factory function allows you to create any type of coalesced API endpoint
 * by providing configuration for parameter parsing, DO naming, and request handling.
 *
 * @example
 * // Create a product handler
 * const getProducts = createCoalescedHandler({
 *   doBindingName: 'REQUEST_COALESCER',
 *   apiBaseEnvVar: 'PRODUCT_API_BASE',
 *   defaultApiBase: '/mock-api',
 *   parseRequest: (request) => {
 *     const url = new URL(request.url);
 *     const productId = url.searchParams.get('productId');
 *     if (!productId) return Response.json({ error: 'Missing productId' }, { status: 400 });
 *     return { productId, fields: url.searchParams.get('fields')?.split(',') || [] };
 *   },
 *   buildDOName: (params) => params.productId,
 *   coalescerConfig: {
 *     buildCacheKey: (params) => `${params.productId}::${params.fields.sort().join(',')}`,
 *     buildUpstreamUrl: (params, apiBase) => {
 *       const url = new URL(`${apiBase}/product`);
 *       url.searchParams.set('productId', params.productId);
 *       if (params.fields.length) url.searchParams.set('fields', params.fields.join(','));
 *       return url.toString();
 *     }
 *   }
 * });
 */
export function createCoalescedHandler<
  T extends Record<string, any> = Record<string, any>,
>(config: RouteConfig<T>): (request: Request, env: Env) => Promise<Response> {
  return async (request: Request, env: Env): Promise<Response> => {
    // Parse and validate request
    const paramsOrError = config.parseRequest(request);
    if (paramsOrError instanceof Response) {
      return paramsOrError;
    }
    const params = paramsOrError;

    // Get the Durable Object stub
    const doNamespace = env[
      config.doBindingName
    ] as DurableObjectNamespace<RequestCoalescer>;
    if (!doNamespace) {
      return Response.json(
        {
          error: `Durable Object binding '${String(config.doBindingName)}' not found`,
        },
        { status: 500 },
      );
    }

    const doName = config.buildDOName(params);
    const stub = doNamespace.getByName(doName);

    // Determine upstream API base URL
    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;
    const envApiBase = env[config.apiBaseEnvVar] as string | undefined;
    const apiBase = envApiBase ?? config.defaultApiBase ?? origin;

    // Call the DO via RPC
    try {
      const result = await (stub as any as RequestCoalescer).fetchCoalesced(
        params,
        apiBase,
        config.coalescerConfig,
      );

      // Return the response
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: result.headers,
      });
    } catch (error) {
      // Upstream failed and no LKG available
      return Response.json(
        {
          error: "Service temporarily unavailable",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 503 },
      );
    }
  };
}
