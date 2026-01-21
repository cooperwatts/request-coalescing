# Request Coalescing with Cloudflare Durable Objects

**Generic, reusable request coalescing using Durable Objects** for multi-tier caching to prevent thundering herd problems.

## Problem Statement

When multiple requests for the same resource arrive simultaneously (thundering herd), they can overwhelm upstream APIs with duplicate calls. This project demonstrates how Cloudflare Durable Objects solve this by:

- **Deduplicating** concurrent identical requests into a single upstream call
- **Caching** responses across memory and persistent storage
- **Serving stale data** while revalidating in the background

## Key Features

✨ **Fully Generic & Reusable**

- Not limited to products - works with **any API or resource type**
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
├── index.ts                       # Main worker (add routes here)
├── constants/
│   └── routes.ts                 # Route definitions
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

Rename `src/routes/products.example.ts` to `src/routes/products.ts` (it already contains):

```typescript
import { createCoalescedHandler } from "./coalesced-handler";

interface ProductParams {
  productId: string;
  fields: string[];
}

export const getProducts = createCoalescedHandler<ProductParams>({
  // Uses the REQUEST_COALESCER binding from wrangler.jsonc
  doBindingName: "REQUEST_COALESCER",

  // Environment variable for upstream API base URL
  apiBaseEnvVar: "PRODUCT_API_BASE",
  defaultApiBase: "/mock-api",

  // Parse and validate incoming request
  parseRequest: (request) => {
    const url = new URL(request.url);
    const productId = url.searchParams.get("productId");

    if (!productId) {
      return Response.json(
        { error: "Missing required query param: productId" },
        { status: 400 },
      );
    }

    const fieldsParam = url.searchParams.get("fields");
    const fields = (fieldsParam ?? "")
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);

    return { productId, fields };
  },

  // Route by product ID - same product → same DO instance
  buildDOName: (params) => params.productId,

  // Configure cache keys and upstream URLs
  coalescerConfig: {
    // Cache key: productId + sorted fields
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
```

### 2. Register the Route

Add to `src/routes/index.ts`:

```typescript
import { getProducts } from "./products";

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

You can create handlers for any resource type by following the same pattern as products:

1. **Copy the pattern** from `src/routes/products.example.ts`
2. **Define your params interface** (e.g., `UserParams`, `OrderParams`)
3. **Configure** `parseRequest`, `buildDOName`, and `coalescerConfig`
4. **Register** in `src/routes/index.ts`

Example for a users endpoint - create `src/routes/users.ts`:

```typescript
import { createCoalescedHandler } from "./coalesced-handler";

interface UserParams {
  userId: string;
}

export const getUsers = createCoalescedHandler<UserParams>({
  doBindingName: "REQUEST_COALESCER",
  apiBaseEnvVar: "USER_API_BASE",
  defaultApiBase: "/mock-api",

  parseRequest: (request) => {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    if (!userId) {
      return Response.json({ error: "Missing userId" }, { status: 400 });
    }
    return { userId };
  },

  buildDOName: (params) => params.userId,

  coalescerConfig: {
    buildCacheKey: (params) => params.userId,
    buildUpstreamUrl: (params, apiBase) =>
      `${apiBase}/user?userId=${params.userId}`,
  },
});
```

Then add to `src/routes/index.ts`:

```typescript
import { getUsers } from "./users";

export const routes = {
  "/products": getProducts,
  "/users": getUsers, // ← Add this
};
```

That's it! 🎉

### Cache Key Patterns

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

// By user (all user requests → same DO)
buildDOName: (params) => params.userId;

// By region (geographic distribution)
buildDOName: (params) => `${params.region}::${params.id}`;
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
- **User Profile APIs** - Profile data, settings, preferences
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
