import type { Env } from "./types";
import { getProducts } from "./routes/products";
import { ROUTES } from "./constants/routes";

/**
 * Request Coalescing Worker
 *
 * Uses Durable Objects for request coalescing and multi-tier caching
 * to prevent thundering herd problems.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // Product API endpoint with request coalescing
    // GET /products?productId=SKU123&fields=name,price
    if (url.pathname === ROUTES.PRODUCTS) {
      return getProducts(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
