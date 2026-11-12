---
title: "Deploy a remote MCP server on Vercel Functions"
navTitle: "Deploy MCP on Vercel"
summary: "Run a tested stateless MCP sample on Vercel Functions, configure duration and browser CORS, and check production domains, cold starts and SSE in mcptest.io."
track: "build"
level: "practitioner"
order: 400
category: "Deployment"
readingTimeMinutes: 7
lastReviewed: "2026-10-24"
metaTitle: "Deploy MCP on Vercel | mcptest.io"
metaDescription: "Run a tested stateless MCP sample on Vercel Functions, configure duration and browser CORS, and check production domains, cold starts and SSE in mcptest.io."
relatedSlugs:
  - deploy-remote-mcp-server
  - remote-mcp-server-with-hono
  - mcp-cors-headers-for-browser-clients
  - test-mcp-server-before-deploying
sourceLinks:
  - title: "MCP TypeScript SDK: stateless web handlers"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/serving/web-standard"
  - title: "Vercel: Node.js functions and fetch exports"
    url: "https://vercel.com/docs/functions/runtimes/node-js"
  - title: "Vercel: function duration and limits"
    url: "https://vercel.com/docs/functions/configuring-functions/duration"
  - title: "Vercel: streaming functions"
    url: "https://vercel.com/docs/functions/streaming-functions"
  - title: "Vercel: deployment protection"
    url: "https://vercel.com/docs/deployment-protection"
  - title: "Vercel: adding a domain"
    url: "https://vercel.com/docs/domains/working-with-domains/add-a-domain"
---

Vercel Functions suit a remote MCP server that does a bounded amount of work per request. You can publish one Node function without creating a Next.js application. Start with this echo server, then add your real tools once the production URL passes a browser test.

The [general deployment guide](/learn/deploy-remote-mcp-server) compares hosting models. This guide focuses on a complete plain-function project and Vercel's limits, reviewed on 24 October 2026.

## Run the complete sample locally

The [complete deployment sample](https://github.com/integry/mcptest/tree/master/src/content/articles/samples/remote-deploy) includes `app.mjs`, `node.mjs`, pinned dependencies, all platform adapters, and a smoke runner. Download just that directory from the repository archive into a fresh folder:

```bash
mkdir echo-mcp
cd echo-mcp
curl -fL https://github.com/integry/mcptest/archive/refs/heads/master.tar.gz \
  | tar -xz --strip-components=6 mcptest-master/src/content/articles/samples/remote-deploy
npm install
npm run smoke
npm start
```

Use Node.js 22.23.4. `npm start` serves `http://localhost:3000/mcp`; stop it before rerunning smoke, which uses ports 3000–3003. Leave `PUBLIC_URL` unset locally. The sample pins `@modelcontextprotocol/server` 2.3.1, `@hono/node-server` 2.1.5 and `zod` 4.6.7. The smoke client is SDK 2.3.1.

The app registers one read-only `echo` tool with a required `text` string and optional `waitMs` from 0 to 1000. It emits progress when the caller requests it, then returns the text. `createMcpHandler` serves **2026-07-28 stateless requests** and uses `legacy: 'stateless'` for 2025 clients. It issues no session ID; `GET /mcp` returns `405`. The same URL handles JSON responses and POST responses that upgrade to SSE when progress is emitted. There is no separate legacy `/sse` endpoint.

This is an unauthenticated echo demonstration. Before attaching private data, add [real bearer authorization and protected resource metadata](/learn/mcp-server-authentication-patterns). The [Hono guide](/learn/remote-mcp-server-with-hono) provides a complete authenticated application if that is your next step.

## The Vercel entry point

The downloaded project already contains the complete function entry:

```javascript
// api/mcp.mjs
import app from '../app.mjs';
export default app;
```

`app.mjs` exports an object with a `fetch(request)` method. [Vercel's Node runtime docs](https://vercel.com/docs/functions/runtimes/node-js) support this web-standard export in the root `api` directory. Keep the project root at the sample directory so both the function and its shared app are included.

Its complete `vercel.json` mounts the friendly URL and sets an explicit duration:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": { "api/mcp.mjs": { "maxDuration": 60 } },
  "rewrites": [{ "source": "/mcp", "destination": "/api/mcp" }]
}
```

The public endpoint is `/mcp`. The rewrite routes that path to the function; no catch-all page rewrite is needed. Do not cache POST responses or put a page redirect on this route.

## Publish the function

1. Import a repository containing the downloaded sample into Vercel, selecting this directory as the root. Use framework **Other**, with no build command or output directory override. The server files are ordinary JavaScript.
2. Choose a production hostname, such as your project's `.vercel.app` domain, and set the production environment variable `PUBLIC_URL=https://YOUR-PROJECT.vercel.app/mcp`.
3. Deploy, then test that exact production URL. Changing environment settings requires a new deployment.
4. If you add a custom hostname in Project Settings → Domains, follow Vercel's DNS instructions, wait for TLS, change `PUBLIC_URL` to `https://YOUR-DOMAIN/mcp`, and redeploy.

[Vercel Deployment Protection](https://vercel.com/docs/deployment-protection) can put a Vercel login in front of previews. A preview URL reaching an authentication page is not the same as the MCP app's OAuth. Use a reachable production domain or an intentionally configured automation bypass. Do not expose a private project just to make a test green.

## Duration, streaming and cold starts

[Vercel's duration table](https://vercel.com/docs/functions/configuring-functions/duration) currently gives Fluid Compute a 300-second default: Hobby's maximum is 300 seconds, Pro and Enterprise have an 800-second generally available maximum, and an extended 1800-second beta exists for eligible configurations. This sample uses 60 seconds so it does not depend on the extended beta. Plans without Fluid Compute have different limits; check the project's settings.

A streaming response still consumes the invocation's duration. SSE progress can make a tool's work visible, but cannot extend `maxDuration`. [Vercel supports streaming function responses](https://vercel.com/docs/functions/streaming-functions); return the response body directly as this wrapper does. Converting the body to text first would buffer it. Set downstream API deadlines shorter than the function deadline and move longer work to a separately managed job.

Fluid Compute can reuse an instance for concurrent invocations. Instances can also start cold or disappear on redeploy. Module-scope SDK setup can be reused, but per-user tokens, tool results and sessions must not live in mutable globals. Our factory creates request-scoped server work and uses no in-memory session map. A stateful 2025 transport would need a different design; “one function file” does not mean “one durable process.”

## CORS and the public URL

Set `PUBLIC_URL` to your exact production endpoint, including `/mcp`. The app validates the incoming `Host` against that hostname and rejects other Origins. It allows browser requests from `https://mcptest.io`, answers `OPTIONS` before the MCP handler, allows the MCP request headers, and exposes `WWW-Authenticate`, `MCP-Protocol-Version`, `Mcp-Session-Id` and `Retry-After`.

To support another browser app, add its exact origin to the `origins` array in `app.mjs`. The SDK Origin check compares hostnames; the CORS response uses the exact origin allowlist. CORS is not user authentication. Non-browser clients can omit Origin, so protect private tools independently. The [CORS reference](/learn/mcp-cors-headers-for-browser-clients) covers the browser checks in detail.

A new custom domain means a new canonical resource URL if you later add OAuth. Update `PUBLIC_URL`, protected resource metadata and the provider's resource/audience configuration together. Test redirects too: an HTML landing page or a login page in front of `/mcp` is not a successful MCP response.

## Test it on mcptest.io

Open the **deployed HTTPS `/mcp` endpoint** in the [mcptest.io playground](/). Check discovery, list tools, and call `echo` with `{"text":"hello","waitMs":500}`. Confirm the result is `hello`, the browser preflight succeeds, the response headers are readable, and there is no session ID. Repeat once after the platform has been idle and once after a new deployment.

The fixture's `npm run smoke` was run locally: pinned 2026 discovery, legacy initialization, tool listing/calling, SSE progress, no-session behavior, allowed-origin preflight, rejected Host/Origin, and GET `405` all passed. Local success does not verify the cloud front door. Deployment CLIs and credentials were unavailable during authoring; cloud deployment, DNS/TLS, platform timeouts and live streaming must be checked in your account. Add the [pre-deployment release gate](/learn/test-mcp-server-before-deploying) once the public URL is stable.
