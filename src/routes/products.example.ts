import { createCoalescedHandler } from "./coalesced-handler";

/**
 * EXAMPLE: Product data handler with request coalescing
 *
 * This demonstrates how to create a coalesced endpoint.
 * To use this example:
 *
 * Add to src/routes/index.ts:
 *    import { getProducts } from "./products.example";
 *
 *    export const routes = {
 *      "/products": getProducts,
 *    };
 *
 * The PRODUCT_API_BASE is already configured in wrangler.jsonc

export const getProducts = createCoalescedHandler<ProductParams>({
  // Uses the REQUEST_COALESCER binding from wrangler.jsonc
  doBindingName: "REQUEST_COALESCER",

  // Environment variable for upstream API base URL
  apiBaseEnvVar: "PRODUCT_API_BASE",

  // Default API base if env var not set
  defaultApiBase: "/mock-api",

  // Parse and validate incoming request
  parseRequest: (request) => {
    const url = new URL(request.url);
    const productId = url.searchParams.get("productId");

    // Validate required params
    if (!productId) {
      return Response.json(
        { error: "Missing required query param: productId" },
        { status: 400 },
      );
    }

    // Parse optional fields parameter
    const fieldsParam = url.searchParams.get("fields");
    const fields = (fieldsParam ?? "")
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);

    return { productId, fields };
  },

  // Build stable DO name - requests with same product ID go to same DO instance
  buildDOName: (params) => params.productId,

  // Configure how to build cache keys and upstream URLs
  coalescerConfig: {
    // Cache key includes both product ID and fields (sorted for consistency)
    buildCacheKey: (params) => {
      const normalizedFields = Array.from(new Set(params.fields)).sort();
      return `${params.productId}::${normalizedFields.join(",")}`;
    },

    // Build upstream API URL
    buildUpstreamUrl: (params, apiBase) => {
      const url = new URL(`${apiBase.replace(/\/+$/, "")}/product`);
      url.searchParams.set("productId", params.productId);
      if (params.fields.length > 0) {
        url.searchParams.set("fields", params.fields.join(","));
      }
      return url.toString();
    },
  },
});
