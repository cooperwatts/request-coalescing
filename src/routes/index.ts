import type { Env } from "../types";
import { getProducts } from "./products.example";

/**
 * Route handler type
 */
export type RouteHandler = (request: Request, env: Env) => Promise<Response>;

/**
 * Route Registry
 *
 * Add your route handlers here
 *
 */
export const routes: Record<string, RouteHandler> = {
  "/products": getProducts,
};
