# mcptest.io press facts

A facts sheet to hand out with the launch. Every number below comes from the repository at the commit this file was added in, and the command that produces it is listed under [How the numbers were derived](#how-the-numbers-were-derived). Rerun those commands before handing the sheet out; the catalog changes every week.

## One line

mcptest.io is a browser-based inspector, playground, evaluator and public catalog for remote Model Context Protocol (MCP) servers. It needs no install and no account.

## Key facts

| Fact | Value |
| --- | --- |
| Product | mcptest.io, <https://mcptest.io> |
| Source | <https://github.com/integry/mcptest> |
| License | MIT (copyright Rinalds Uzkalns / Unchained Development OÜ) |
| Price | Free |
| Runs on | A current web browser; nothing to install |
| Servers it can test | Remote servers over Streamable HTTP (MCP 2026-07-28 stateless and 2025 stateful) and legacy HTTP+SSE |
| Servers it cannot test | Local stdio servers |
| Public catalog | 218 remote servers in 18 categories, all `online` at the last validation run (2026-10-20) |
| Catalog revalidation | Weekly, Mondays 06:17 UTC, by a GitHub Actions workflow that opens a pull request with the new evidence |
| Guides | 38 guides in four tracks: Understand 10, Use 10, Build 10, Reference 8 |
| Transport diagnostics | 6 transport diagnostic ids plus 1 tool output-contract finding, each with a reference section |
| Report retention | A public permalink keeps the newest 20 published snapshots per endpoint; local report history keeps 10 per endpoint and 20 overall |
| Badge results | `ready`, `review`, `blocked`, `unknown`, `authorization-required`, plus a neutral "Tested on mcptest.io" badge |
| CI | Headless CLI (`npm run mcptest`) from a checkout of the repository, JSON and Markdown reports, stable exit codes 0 to 4 |

### Catalog breakdown (2026-10-20 validation)

Authentication observed without credentials: 181 OAuth, 27 none, 6 bearer token, 4 API key.

Of the 218 servers, 44 completed an anonymous MCP handshake during validation and reported a protocol version: all 27 that need no authentication, plus 17 that declare OAuth, an API key or a bearer token but still answer the handshake. The other 174 answered with an authentication challenge, which the catalog counts as reachable but not transport-verified anonymously. For the 44, the negotiated protocol versions were: 2026-07-28 (6), 2025-11-25 (27), 2025-06-18 (7), 2025-03-26 (3), 2024-11-05 (1).

Categories: Developer Tools 28, Documentation 19, Observability 19, Cloud 19, Productivity 13, Databases 13, CRM 12, Security 11, Project Management 11, Search 11, Communication 10, Design 10, Analytics 10, Finance 9, AI Infrastructure 9, Payments 8, Automation 5, Marketplace 1.

## What a report checks

A report is produced by the same evaluator in the browser and in the headless CLI (`src/utils/evaluation.ts`). It has these sections; the maximum score of each is in brackets.

- **Core Protocol Adherence** (15): negotiates the protocol with the official TypeScript SDK. It tries the 2026 stateless `server/discover` first, falls back to the 2025 `initialize` handshake, and records which era and version the server speaks.
- **MCP Capabilities** (10): lists tools, resources, resource templates and prompts. When tools declare an `outputSchema`, the structured output of recorded calls is validated against it (finding `tool.output-contract-violation`). Results of playground calls and saved test plans are attached.
- **Transport Layer Modernity** (15): identifies Streamable HTTP or the deprecated HTTP+SSE transport and records transport diagnostics: 406 on the `Accept` header, 405 on the GET stream, 415 on `Content-Type`, 429 rate limiting, missing `Access-Control-Expose-Headers`, and an SSE content-type mismatch. Each id links to its section in the [transport diagnostics reference](https://mcptest.io/learn/mcp-transport-diagnostics-reference).
- **Security Posture** (40): checks OAuth protected-resource metadata and authorization-server metadata.
- **Web Client Accessibility** (15): whether a browser page can complete MCP negotiation directly at the endpoint, with the CORS headers it could read. This section is browser-only; the headless CLI leaves it unknown and does not score it.
- **Performance Baseline** (15): time for endpoint selection, connection and protocol negotiation.
- **Authorization**: when the server challenges for credentials, the report records the challenge and an `authorization-required` outcome rather than a failure.

Each report ends in a release decision (`ready`, `review`, `blocked` or `unknown`) with prioritized findings. Reports export as JSON (schema at <https://mcptest.io/schemas/report/v2.schema.json>) and Markdown.

Authentication supported in the browser: OAuth 2.1 with PKCE (pre-registered client, Client ID Metadata Document, dynamic client registration), bearer tokens and API keys. Headless runs accept a bearer token or API key only; they do not run interactive OAuth.

## What shipped on 2026-10-20

- A landing page that explains the tool and links the catalog and guides.
- The catalog grew from 111 to 218 servers, with weekly revalidation.
- README badges: static result badges and live catalog badges at `/badge/server/<id>.svg`.
- Transport diagnostics with links to a reference page.
- Structured output validation against tool `outputSchema`.
- OAuth hardening.
- Public report permalinks (`/r/<id>`) with per-endpoint history and a live badge for the latest published snapshot (`/badge/report/<encoded url>.svg`).
- In-app server submission at `/submit`, which opens a reviewed pull request.
- 38 guides across Understand, Use, Build and Reference.
- `/llms.txt`, an RSS feed at `/learn/feed.xml`, raw Markdown for every guide (append `.md`), and a 1200x630 Open Graph image per page.
- A monthly "What changed in MCP" digest, the first one for October 2026.

The pre-launch issue listed "40+ guides". The repository has 38 guide files; use 38 unless more are merged before posting.

## Hosting facts that are public

- The app is a static Vite build. The routes for badges (`/badge/server/*`, `/badge/report/*`), report permalinks (`/r`, `/r/*`) and submissions (`/api/catalog/submissions`) are served by a Cloudflare Worker on the `mcptest.io` zone (`wrangler.toml`), with Durable Objects for published reports, user state and the submission rate limiter.
- The optional CORS proxy is a separate Cloudflare Worker (`cors-proxy-worker/`). It is used only when the browser cannot read the server directly. Anonymous use is limited to 60 requests per minute per IP address; signed-in use to 600 per minute per user.
- Sign-in is optional and uses Firebase Authentication. Without signing in, the tool works with local browser storage.
- Badge requests never contact the MCP server; live catalog badges are served from validation data bundled at build time.
- Published reports are redacted before storage: the Worker validates them against the report schema and rejects anything its redaction guard still flags.

## Links

| What | URL |
| --- | --- |
| App | <https://mcptest.io> |
| Catalog | <https://mcptest.io/catalog> |
| Submit a server | <https://mcptest.io/submit> |
| Guides | <https://mcptest.io/learn> |
| Testing guide | <https://mcptest.io/docs/testing-guide> |
| Comparison with MCP Inspector, MCPJam, Glama and Postman | <https://mcptest.io/learn/mcptest-vs-mcp-inspector> |
| Transport diagnostics reference | <https://mcptest.io/learn/mcp-transport-diagnostics-reference> |
| October 2026 MCP digest | <https://mcptest.io/learn/mcp-changes-2026-10> |
| llms.txt | <https://mcptest.io/llms.txt> |
| RSS | <https://mcptest.io/learn/feed.xml> |
| Report schema | <https://mcptest.io/schemas/report/v2.schema.json> |
| Example catalog page | <https://mcptest.io/servers/context7/> |
| Example live badge | <https://mcptest.io/badge/server/context7.svg> |
| Source | <https://github.com/integry/mcptest> |
| Headless CLI guide | <https://github.com/integry/mcptest/blob/master/docs/headless-release-gate.md> |
| Catalog submission guide | <https://github.com/integry/mcptest/blob/master/docs/catalog-submissions.md> |

## How the numbers were derived

Run from the repository root.

```bash
# Catalog size (218) and unique ids
node -e 'const c=require("./src/data/serverCatalog.json");console.log(c.length,new Set(c.map(s=>s.id)).size)'

# Validation status, date range, auth types, protocol versions (servers with a version = anonymous handshake)
node -e '
const v=require("./src/data/catalogValidation.json");
const t=(f)=>v.reduce((k,s)=>{const x=f(s);k[x]=(k[x]||0)+1;return k},{});
console.log(t(s=>s.status),t(s=>s.authType),t(s=>s.protocolVersion));
const d=v.map(s=>s.checkedAt).sort();console.log(d[0],d[d.length-1]);'

# Categories (18)
node -e 'const c=require("./src/data/serverCatalog.json");const k={};c.forEach(s=>k[s.category]=(k[s.category]||0)+1);console.log(Object.keys(k).length,k)'

# Catalog size before this release (111) is in the commit that expanded it
git log --oneline -1 -- src/data/serverCatalog.json

# Guides (38) and guides per track
ls src/content/articles/*.md | wc -l
grep -h '^track:' src/content/articles/*.md | sort | uniq -c

# Transport diagnostics (6 + 1)
grep -c '^## transport\.' src/content/articles/mcp-transport-diagnostics-reference.md
grep -c '^## tool\.' src/content/articles/mcp-transport-diagnostics-reference.md

# Report sections and maximum scores
grep -nE "name: '|maxScore:" src/utils/evaluation.ts

# Retention: published permalinks (20); local history limits (10 / 20) are in the README
grep -n 'PUBLISHED_REPORT_RETENTION =' src/utils/publishedReportIdentity.ts

# Revalidation schedule, proxy rate limits, Worker routes
grep -n cron .github/workflows/catalog-revalidation.yml
grep -n 'limit =' cors-proxy-worker/wrangler.toml
grep -n pattern wrangler.toml

# Badge files
ls public/badge
```
