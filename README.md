# Request Coalescing with Cloudflare Durable Objects

**Generic, reusable request coalescing using Durable Objects** for multi-tier caching to prevent thundering herd problems.

## Problem Statement

When multiple requests for the same resource arrive simultaneously (thundering herd), they can overwhelm upstream APIs with duplicate calls. This project demonstrates how Cloudflare Durable Objects solve this by:

- **Deduplicating** concurrent identical requests into a single upstream call
- **Caching** responses across memory and persistent storage
- **Serving stale data** while revalidating in the background

## Key Features

✨ **Fully Generic & Reusable**

- Not limited to one specific API - works with **any API or resource type**
- Configurable cache keys (by ID, fields, or any combination)
- Configurable upstream URLs and request patterns
- Easy to add new endpoints with minimal code

🚀 **Request Coalescing**

- Multiple concurrent identical requests → single upstream call
- Automatic deduplication using configurable cache keys

💾 **Multi-tier Caching**

- Memory cache (sub-millisecond)
- Persistent storage (survives hibernation)
- Upstream API (fallback)

⚡ **Stale-While-Revalidate**

- Serve stale data immediately
- Refresh in background
- Zero-latency updates for users

🌐 **Named Durable Objects**

- Consistent routing based on configurable parameters
- Global singleton per unique resource

## Project Structure

```
src/
├── index.ts                      # Main worker (add routes here)
├── types/
│   ├── index.ts
│   ├── env.ts                    # Environment configuration
│   └── cache.ts                  # Cache-related types
├── routes/
│   ├── coalesced-handler.ts      # Generic handler factory 🎯
│   └── products.example.ts       # Example: Product API template
└── do/
    ├── RequestCoalescer.ts       # Generic coalescing DO 🎯
    └── README.md                 # Architecture docs
```

## Quick Start

### Running Locally

```bash
npm install
npx wrangler dev
```

## Example: Product API with Request Coalescing

Let's implement a product API endpoint that coalesces requests and caches responses.

### 1. Create the Route Handler

The example file `src/routes/products.example.ts` contains a complete implementation that:

- **Parses** `productId` and `fields` from query parameters
- **Validates** required parameters (returns 400 if missing)
- **Routes** requests to a Durable Object by `productId`
- **Builds cache keys** using `productId` + sorted fields for consistency
- **Constructs upstream URLs** to fetch from your API

The handler uses `createCoalescedHandler` which wraps all the coalescing and caching logic.

### 2. Register the Route

Add to `src/routes/index.ts`:

```typescript
import { getProducts } from "./products.example";

export const routes: Record<string, RouteHandler> = {
  "/products": getProducts,
};
```

That's it! The main worker automatically routes to registered handlers.

### 3. Test It

```bash
# Start the dev server
npx wrangler dev

# Make a request
curl "http://localhost:8787/products?productId=SKU123&fields=name,price"
```

**Response:**

```json
{
  "id": "SKU123",
  "name": "Product Name",
  "price": 42.5
}
```

### What Just Happened?

1. ✅ Your request was routed to a named Durable Object based on `productId`
2. ✅ The DO checked its multi-tier cache (memory → storage → upstream)
3. ✅ Multiple concurrent requests for the same product+fields are coalesced into one upstream call
4. ✅ Results are cached for fast subsequent access
5. ✅ Stale data is served instantly while refreshing in the background

## Adding More Endpoints

You can create handlers for any resource type by following the same pattern:

1. **Copy** `src/routes/products.example.ts` as a starting point
2. **Define your params interface** (e.g., `OrderParams`, `ConfigParams`)
3. **Configure** how to parse requests, build cache keys, and construct upstream URLs
4. **Register** in `src/routes/index.ts`

The framework handles all the coalescing, caching, and stale-while-revalidate logic automatically.

## Configuration

The `buildCacheKey` function determines what makes requests "identical":

```typescript
// Simple: Just by ID
buildCacheKey: (params) => params.productId;

// With fields: ID + sorted fields
buildCacheKey: (params) => {
  const fields = Array.from(new Set(params.fields)).sort();
  return `${params.productId}::${fields.join(",")}`;
};

// Complex: Multiple dimensions
buildCacheKey: (params) =>
  `${params.region}::${params.productId}::${params.variant}`;
```

### DO Routing Strategies

The `buildDOName` function controls which Durable Object handles requests:

```typescript
// By resource ID (recommended for most cases)
buildDOName: (params) => params.productId;

// By region (geographic distribution)
buildDOName: (params) => `${params.region}::${params.id}`;

// By tenant (multi-tenancy)
buildDOName: (params) => params.tenantId;
```

### Environment Variables

Configure in `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "PRODUCT_API_BASE": "https://api.example.com",
    "FRESH_TTL_MS": "10000", // 10s - how long data is fresh
    "STALE_TTL_MS": "60000", // 60s - how long stale data is served
  },
}
```

## How It Works

1. **Request arrives** at `/products?productId=SKU123&fields=name,price`
2. **Route handler** parses and validates parameters
3. **DO selection** via `buildDOName` - same params → same DO globally
4. **Cache key** built via `buildCacheKey` - determines request uniqueness
5. **Cache hierarchy checked**:
   - Memory cache (sub-ms)
   - Persistent storage (survives hibernation)
   - In-flight requests (coalescing!)
   - Stale data (with background refresh)
   - Upstream API (last resort)
6. **Response cached** in memory + storage for future requests

**Coalescing in Action:**

- 100 concurrent requests arrive for same product+fields
- DO creates **1 upstream request**
- All 100 requests await and receive the same response
- Subsequent requests hit cache instantly

**Stale-While-Revalidate:**

- Data expires but is within stale window
- Returns stale data immediately (instant response)
- Triggers background refresh (coalesced with other refreshes)
- Next request gets fresh data

See [src/do/README.md](src/do/README.md) for detailed architecture documentation.

## Use Cases

This pattern works for any high-traffic API scenario:

- **Product/Catalog APIs** - E-commerce product pages
- **Pricing APIs** - Real-time pricing with frequent identical requests
- **Inventory APIs** - Stock levels checked by many users
- **Content APIs** - CMS content, blog posts, articles
- **Configuration APIs** - App configs, feature flags
- **Rate-limited APIs** - Reduce load on upstream services

## Deployment

```bash
npx wrangler deploy
```

## Architecture Details

See [src/do/README.md](src/do/README.md) for detailed documentation on the RequestCoalescer architecture and internals.

## License

MIT
