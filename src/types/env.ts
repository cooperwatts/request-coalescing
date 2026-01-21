import type { ProductCoalescer } from "../do/ProductCoalescer";

export type Env = {
  PRODUCT_COALESCER: DurableObjectNamespace<ProductCoalescer>;
  // Optional; if not set, we'll fall back to the Worker's own mock route (/mock-api/product)
  PRODUCT_API_BASE?: string;
  // Tunables
  FRESH_TTL_MS?: string; // e.g. "10000"
  STALE_TTL_MS?: string; // e.g. "60000"
};
