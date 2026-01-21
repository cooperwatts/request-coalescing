import type { Env } from "../types";
import type { ProductCoalescer } from "../do/ProductCoalescer";

/**
 * Parses and normalizes fields from query params
 */
function parseFields(fieldsParam: string | null): string[] {
  return (fieldsParam ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
}

/**
 * Creates a stable DO name from productId and fields
 * Ensures same product+fields always routes to the same DO instance
 */
function createDOName(productId: string, fields: string[]): string {
  const normalizedFields = Array.from(new Set(fields)).sort();
  return `${productId}::${normalizedFields.join(",") || "ALL"}`;
}

/**
 * Gets product data with request coalescing via Durable Objects
 *
 * GET /products?productId=SKU123&fields=name,price
 */
export async function getProducts(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);

  // Parse query params
  const productId = url.searchParams.get("productId");
  const fields = parseFields(url.searchParams.get("fields"));

  // Validate required params
  if (!productId) {
    return Response.json(
      { error: "Missing required query param: productId" },
      { status: 400 },
    );
  }

  // Get the Durable Object stub
  const doName = createDOName(productId, fields);
  const stub = env.PRODUCT_COALESCER.getByName(doName);

  // Determine upstream API base URL
  const origin = `${url.protocol}//${url.host}`;
  const apiBase = env.PRODUCT_API_BASE ?? `${origin}/mock-api`;

  // Call the DO via RPC
  const result = await (stub as any as ProductCoalescer).getProduct(
    productId,
    fields,
    apiBase,
  );

  // Return the response
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: result.headers,
  });
}
