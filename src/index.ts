import type { Env } from "./types";
import { routes } from "./routes";

/**
 * Request Coalescing Worker
 *
 * Uses Durable Objects for request coalescing and multi-tier caching
 * to prevent thundering herd problems.
 *
 * This is a generic implementation - add new routes by:
 * 1. Creating handlers with `createCoalescedHandler` in the routes/ directory
 * 2. Adding them to the routes registry in src/routes/index.ts
 *
 * See src/routes/products.example.ts for a complete example.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // Check registered routes
    const handler = routes[url.pathname];
    if (handler) {
      return handler(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

// Export the Durable Object class
export { RequestCoalescer } from "./do/RequestCoalescer";
