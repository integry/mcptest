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
- **Headless release gate:** evaluates remote endpoints in CI and emits the same versioned JSON and Markdown report semantics as the web app.

The exact URL entered by a user or supplied by the catalog is tried first. Conventional `/mcp` and `/sse` paths are compatibility fallbacks; they do not replace an explicit custom endpoint.

For command-line and GitHub Actions usage, credential handling, thresholds, and
stable exit codes, see the [headless release gate guide](docs/headless-release-gate.md).

## Embedding a badge

Show that your MCP server has been tested by adding a badge to its README. Every report page and catalog server profile has a "Share and embed" section with ready-to-copy Markdown, HTML and reStructuredText snippets that link to the public report for the endpoint.

```markdown
[![Tested on mcptest.io](https://mcptest.io/badge/mcptest.svg)](https://mcptest.io/report/https%3A%2F%2Fexample.com%2Fmcp)
```

Replace the URL-encoded endpoint after `/report/` with your own. Result badges use the release decision vocabulary from the report: `ready.svg`, `review.svg`, `blocked.svg`, `unknown.svg` and `authorization-required.svg` under `https://mcptest.io/badge/`. These static badges record the result at the time you copied the snippet.

Catalog servers can use a badge that follows the latest catalog validation instead:

```markdown
[![Tested on mcptest.io](https://mcptest.io/badge/server/context7.svg)](https://mcptest.io/servers/context7/)
```

The main worker serves `GET /badge/server/<catalog id>.svg` from validation data bundled at build time (`src/data/catalogValidation.json`), so a badge request never contacts the MCP server. Redeploy the worker after running `npm run validate-catalog` to publish new results. A negotiated session maps to `ready`, an authentication challenge to `authorization-required`, an offline endpoint to `blocked` and an inconclusive probe to `unknown`. Unknown ids return the neutral badge with HTTP 200, so an embed never shows a broken image. Run `npm run generate-badges` after changing `src/utils/badges.ts` to regenerate the static SVGs in `public/badge/`.

## Report history and privacy

Completed reports are saved as redacted snapshots in the current browser so the report page can show semantic drift. History retains the newest 10 snapshots for each endpoint and 20 snapshots overall. Once either limit is reached, the oldest applicable snapshots are removed automatically.

Snapshots contain the public report artifact, including bounded tool contracts, protocol and transport observations, OAuth metadata, capabilities, scores, timings, and findings. Report redaction runs before local storage; credentials and secret-bearing fields are never retained. The report history panel can export the redacted history, delete one snapshot, or delete all report history. Deleting all history removes only the dedicated report-history storage key and leaves tabs, dashboards, recent servers, and OAuth data unchanged.

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

Every guide is also available as raw Markdown by appending `.md` to its URL, `/llms.txt` indexes all of them, and `/learn/feed.xml` is an RSS feed of every guide, most recently reviewed first.

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

## Adding a content page

All `/learn/*` and `/docs/*` guides are Markdown files in `src/content/articles/`. The file name is the slug, so `src/content/articles/my-guide.md` is served at `/learn/my-guide`. No React code changes are needed: the browser registry (`src/content/learnRegistry.ts`) loads every file at build time, and `scripts/generate-seo-pages.js` prerenders the same files into static HTML, `dist/<path>.md`, `sitemap.xml`, and `llms.txt`.

A file starts with YAML frontmatter followed by the body (standard Markdown with GitHub tables; code fences get JetBrains Mono styling and syntax highlighting for `bash`, `http`, `javascript`, `typescript`, `json`, and `yaml`):

```markdown
---
title: How to connect to a remote MCP server
summary: One sentence shown under the title, in the index, and in llms.txt.
track: use
level: newcomer
order: 1
category: Getting started
readingTimeMinutes: 8
lastReviewed: "2026-08-17"
relatedSlugs:
  - oauth-for-mcp-explained
sourceLinks:
  - title: MCP 2026-07-28 specification
    url: "https://modelcontextprotocol.io/specification/2026-07-28"
---

## First heading

Body text. Internal links such as [the testing guide](/docs/testing-guide) use site-relative paths.
```

Required fields:

| Field | Meaning |
| --- | --- |
| `title` | Page `<h1>`; also the default `<title>` as `title \| mcptest.io`. |
| `summary` | One-line description used in the index, related lists, llms.txt, and as the default meta description. |
| `track` | Navigation track: `understand`, `use`, `build`, or `reference`. |
| `level` | Audience: `newcomer`, `practitioner`, or `expert`. |
| `order` | Position within the track (positive integer, unique per track). Drives the sidebar and previous/next links. |
| `category` | Free-form editorial section name used in structured data. |
| `readingTimeMinutes` | Positive integer. |
| `lastReviewed` | `YYYY-MM-DD` (quote it so it stays a string). |
| `relatedSlugs` | Slugs of related articles; every slug must exist. |
| `sourceLinks` | At least one `{ title, url }` reference. |

Optional fields:

| Field | Meaning |
| --- | --- |
| `path` | Canonical URL path override, for example `/docs/testing-guide`. Defaults to `/learn/<slug>`. Must be unique and must not collide with the React-only pages. |
| `navTitle` | Short label for the sidebar (defaults to `title`). |
| `metaTitle`, `metaDescription` | SEO overrides for `<title>` and the meta description. |
| `component` | Name of a registered React component (`src/content/componentRegistry.ts`) rendered where the body contains a `<!-- component -->` line, or after the body if the marker is absent. |

Tracks and their descriptions live in `src/content/contentModel.ts`. The registry validates every rule above when the app or the build starts, so a broken article fails `npm test` and `npm run build` rather than shipping. Privacy, Terms, and Contact remain React components; their routes and metadata are registered in the same registry (`COMPONENT_PAGES`) with titles in `src/data/pageMetadata.json`.

## Verification

```bash
npm test
npm run typecheck
npm run validate-catalog
npm run build
npm run build:workers
npm audit --audit-level=low
```

`npm run build` creates the Vite production bundle, generates one static HTML report document per catalog server, and refreshes `sitemap.xml` and `robots.txt`. It also writes the crawler-visible landing copy into `dist/index.html` (the text lives in `src/content/landingCopy.ts`, shared with `LandingHero`) and renders a 1200x630 Open Graph image per page to `dist/og/` with satori and resvg, no browser needed. Images whose inputs have not changed are copied from `node_modules/.cache/og`, so only the first build renders all of them.
`npm run build:workers` type-checks the TypeScript proxy and creates dry-run Cloudflare bundles for both Workers.

After `npm run build`, the built site has its own checks: `npm run test:first-paint` (cold first load of the home page in headless Chromium), `npm run test:bundle-graph` (the chunk graph in `dist/.vite/manifest.json`: the inspector, Firebase, the Markdown renderer and highlight.js must stay out of the JavaScript every page loads), `npm run test:e2e` (Playwright smoke suite against a mock MCP server) and `npm run test:lighthouse` / `npm run test:lighthouse:mobile` (Lighthouse budgets, desktop and mobile). `npm run analyze` prints what is in each chunk, and `npm run lighthouse-summary` tabulates the last Lighthouse reports.

Install the two Worker package trees separately before running their combined build:

```bash
npm --prefix cors-proxy-worker ci
npm --prefix cloudflare-worker ci
npm run build:workers
```

## Catalog maintenance

Catalog seeds live in `src/data/serverCatalog.json`; `src/data/serverCatalog.ts` combines them with the latest validation snapshot. Run `npm run validate-catalog` after changing a seed. Validation uses actual MCP negotiation and records the observed endpoint, transport, protocol era, version, reachability, and authentication requirement in `src/data/catalogValidation.json`.

A protected endpoint that returns a valid authentication challenge can be catalog-valid and reachable without being transport-verified anonymously. Keep that distinction explicit in catalog metadata and UI copy.

Server authors can submit a new entry by pull request. See [docs/catalog-submissions.md](docs/catalog-submissions.md) for the required fields, the validation that runs, and the logo licensing rules.

## Core JSON-RPC methods

- `server/discover` — advertises versions and capabilities for the stateless 2026 era.
- `tools/list` and `tools/call` — discover and invoke tools.
- `resources/list` and `resources/read` — discover and read resources.
- `prompts/list` and `prompts/get` — discover and render prompts.
- `initialize` and `notifications/initialized` — stateful compatibility handshake for 2025-era servers.

The authoritative references are the [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/), the [current specification](https://modelcontextprotocol.io/specification/2026-07-28), and the official TypeScript SDK's [protocol-version guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md).

## License

MIT
