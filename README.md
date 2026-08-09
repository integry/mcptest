# mcptest.io

`mcptest.io` is a browser-based inspector, playground, evaluator, and public catalog for remote Model Context Protocol (MCP) servers. It speaks the current stateless MCP protocol and remains compatible with stateful and legacy servers already in production.

## What it supports

- **MCP 2026-07-28 (stateless):** probes with `server/discover`, sends self-describing requests, and adds the required `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` routing headers.
- **MCP 2025 and earlier (stateful):** automatically falls back to `initialize` / `notifications/initialized`, retains `Mcp-Session-Id`, and supports JSON or SSE responses over Streamable HTTP.
- **Legacy HTTP+SSE:** detects the original two-endpoint transport as a final compatibility fallback.
- **Capabilities:** discovers and exercises tools, resources, and prompts with raw JSON-RPC logs and schema-driven tool forms.
- **Authentication:** supports OAuth 2.1 with PKCE, bearer tokens, and API keys. Target credentials remain separate from Firebase credentials when the optional CORS proxy is used.
- **Server catalog:** ships a validated catalog of public remote servers, authentication and protocol badges, and indexable server report pages included in the sitemap.
- **Evaluation:** creates shareable server reports and reusable tool-call dashboards.

The exact URL entered by a user or supplied by the catalog is tried first. Conventional `/mcp` and `/sse` paths are compatibility fallbacks; they do not replace an explicit custom endpoint.

## Protocol negotiation

The client uses automatic version negotiation from the official TypeScript SDK:

1. It sends a bounded `server/discover` probe.
2. A 2026 server returns its supported versions and capabilities. The connection remains stateless: there is no initialization handshake or transport session ID.
3. A 2025-only server triggers a transparent fallback to the stateful `initialize` handshake.
4. If Streamable HTTP is unavailable, the client can try the deprecated HTTP+SSE transport.

An authentication response is not treated as evidence that a server is legacy. The UI surfaces the auth requirement so the user can provide OAuth, bearer-token, or API-key credentials and retry the same endpoint.

See the in-app guides for the complete wire behavior:

- `/docs/what-is-mcp`
- `/docs/remote-vs-local`
- `/docs/testing-guide`
- `/docs/troubleshooting`

## Local development

Requirements: Node.js 22 or newer and npm.

```bash
git clone https://github.com/integry/mcptest.git
cd mcptest
cp .env.example .env
npm ci
npm run dev
```

Vite serves the app at `http://localhost:5173` by default.

### Environment variables

The app works without Firebase when `VITE_FIREBASE_AUTH_ENABLED=false`. To enable sign-in and persisted user data, configure the documented `VITE_FIREBASE_*` values in `.env`.

Set `VITE_CLOUDFLARE_WORKER_URL` for persisted dashboards and reports. Set `VITE_PROXY_URL` to an approved deployment of `cors-proxy-worker` when browser CORS prevents a direct connection. The proxy requires Firebase authentication and forwards MCP target credentials through its isolated target-auth channel.

Do not commit `.env` or real server credentials.

## Verification

```bash
npm test
npm run typecheck
npm run validate-catalog
npm run build
npm run build:workers
npm audit --audit-level=low
```

`npm run build` creates the Vite production bundle, generates one static HTML report document per catalog server, and refreshes `sitemap.xml` and `robots.txt`.
`npm run build:workers` type-checks the TypeScript proxy and creates dry-run Cloudflare bundles for both Workers.

Install the two Worker package trees separately before running their combined build:

```bash
npm --prefix cors-proxy-worker ci
npm --prefix cloudflare-worker ci
npm run build:workers
```

## Catalog maintenance

Catalog seeds live in `src/data/serverCatalog.json`; `src/data/serverCatalog.ts` combines them with the latest validation snapshot. Run `npm run validate-catalog` after changing a seed. Validation uses actual MCP negotiation and records the observed endpoint, transport, protocol era, version, reachability, and authentication requirement in `src/data/catalogValidation.json`.

A protected endpoint that returns a valid authentication challenge can be catalog-valid and reachable without being transport-verified anonymously. Keep that distinction explicit in catalog metadata and UI copy.

## Core JSON-RPC methods

- `server/discover` — advertises versions and capabilities for the stateless 2026 era.
- `tools/list` and `tools/call` — discover and invoke tools.
- `resources/list` and `resources/read` — discover and read resources.
- `prompts/list` and `prompts/get` — discover and render prompts.
- `initialize` and `notifications/initialized` — stateful compatibility handshake for 2025-era servers.

The authoritative references are the [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/), the [current specification](https://modelcontextprotocol.io/specification/2026-07-28), and the official TypeScript SDK's [protocol-version guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md).

## License

MIT
