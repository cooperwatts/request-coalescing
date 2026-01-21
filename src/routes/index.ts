import type { Env } from "../types";
// import { getProducts } from "./products.example";

/**
 * Route handler type
 */
export type RouteHandler = (request: Request, env: Env) => Promise<Response>;

/**
 * Route Registry
 *
 * Add your route handlers here - no need to modify index.ts!
 *
 * Example:
 * import { getProducts } from "./products.example";
 *
 * export const routes: Record<string, RouteHandler> = {
 *   "/products": getProducts,
 * };
 */
export const routes: Record<string, RouteHandler> = {
  // Add your routes here
  // "/products": getProducts,
};
