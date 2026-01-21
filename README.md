# Request Coalescing with Cloudflare Durable Objects

Request coalescing using Durable Objects for multi-tier caching to prevent thundering herd problems.

## Problem Statement

When multiple requests for the same resource arrive simultaneously (thundering herd), they can overwhelm upstream APIs with duplicate calls. This project demonstrates how Cloudflare Durable Objects solve this by:

- **Deduplicating** concurrent identical requests into a single upstream call
- **Caching** responses across memory and persistent storage
- **Serving stale data** while revalidating in the background

## Project Structure

```
src/
├── index.ts                  # Main worker entry point
├── constants/                # Application constants
│   └── routes.ts            # Route path definitions
├── types/                    # TypeScript type definitions
│   ├── index.ts
│   ├── env.ts               # Environment configuration
│   └── cache.ts             # Cache-related types
├── routes/                   # Route handlers
│   └── products.ts          # Product API with request coalescing
└── do/                       # Durable Objects
    ├── ProductCoalescer.ts  # Request coalescing + multi-tier cache
    └── README.md            # Architecture documentation
```

## Key Features

- **Request coalescing**: Multiple concurrent identical requests → single upstream call
- **Multi-tier caching**: Memory → Storage → Upstream
- **Stale-while-revalidate**: Serve stale data while refreshing in background
- **Named Durable Objects**: Same product+fields always routes to same instance globally
- **Production-ready**: Clean architecture with proper separation of concerns

## API

### Get Product

```http
GET /products?productId=SKU123&fields=name,price
```

**Query Parameters:**

- `productId` (required) - Unique product identifier
- `fields` (optional) - Comma-separated list of fields to return

**Response:**

```json
{
  "id": "SKU123",
  "name": "Product Name",
  "price": 42.5
}
```

## Running Locally

```bash
# Install dependencies
npm install

# Start development server
npx wrangler dev
```

## Deployment

```bash
# Deploy to Cloudflare Workers
npx wrangler deploy
```

## Configuration

Set environment variables in `wrangler.jsonc`:

- `PRODUCT_API_BASE` - Upstream API URL (required)
- `FRESH_TTL_MS` - Cache freshness duration (default: 10000ms / 10s)
- `STALE_TTL_MS` - Stale data serving duration (default: 60000ms / 60s)

## How It Works

1. Request arrives at `/products?productId=SKU123&fields=name,price`
2. Worker routes to named Durable Object based on `productId + fields`
3. DO checks:
   - **Memory cache** (fastest, lost on hibernation)
   - **Storage cache** (persistent, survives hibernation)
   - **Upstream API** (slowest, single request for all concurrent calls)
4. Multiple concurrent requests for same product+fields are coalesced into one upstream call
5. Results are cached in both memory and storage for future requests

**Stale-While-Revalidate:**

- If data is stale but within `STALE_TTL_MS`, returns immediately
- Triggers background refresh (also coalesced with other requests)
- Next request gets fresh data

See [src/do/README.md](src/do/README.md) for detailed architecture documentation.

## Use Case

- **Product APIs** - High-traffic product detail pages with frequent identical requests
