---
title: "Deploy a remote MCP server on Vercel Functions"
navTitle: "Deploy MCP on Vercel"
summary: "Run a tested stateless MCP sample on Vercel Functions, configure duration and browser CORS, and check production domains, cold starts and SSE in mcptest.io."
track: "build"
level: "practitioner"
order: 400
category: "Deployment"
readingTimeMinutes: 7
lastReviewed: "2026-11-11"
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

Vercel Functions suit a remote MCP server that does a bounded amount of work per request. You can publish one Node.js function without creating a Next.js application. This guide deploys a small, tested echo server to that function. Once the production URL passes a browser test, replace the echo tool with your own tools.

For a comparison of hosting models, see the [general deployment guide](/learn/deploy-remote-mcp-server). For an MCP server inside a Next.js app, see [the Next.js guide](/learn/remote-mcp-server-with-nextjs).

## What you will build

- A stateless MCP server at `https://YOUR-PROJECT.vercel.app/mcp`, running as one Vercel Function.
- One read-only `echo` tool. It takes a required `text` string and an optional `waitMs` delay from 0 to 1000, sends a progress notification when the caller asks for one, and returns the text.
- One URL for both protocol eras. `createMcpHandler` answers 2026-07-28 requests directly and 2025 clients through `legacy: 'stateless'`. It issues no `Mcp-Session-Id`, and `GET /mcp` returns `405`. A response upgrades to SSE when the tool sends progress. There is no separate `/sse` endpoint.
- `Host` and `Origin` validation, and CORS for browser clients at `https://mcptest.io`.

The server has no authentication. Before you connect private data, add [bearer authorization and protected resource metadata](/learn/mcp-server-authentication-patterns).

## Prerequisites

- Node.js 22 and npm. The sample was tested with Node.js 22.23.4.
- A Vercel account and a Git repository that Vercel can import.
- `curl`, to check the deployment.

## Step 1: Download and test the sample locally

The [deployment sample](https://github.com/integry/mcptest/tree/master/src/content/articles/samples/remote-deploy) holds the shared app, the entry points for Vercel, AWS Lambda, Cloud Run and Fly.io, pinned dependencies, and a smoke test. Download only that directory into a new folder:

```bash
mkdir echo-mcp
cd echo-mcp
curl -fL https://github.com/integry/mcptest/archive/refs/heads/master.tar.gz \
  | tar -xz --strip-components=6 mcptest-master/src/content/articles/samples/remote-deploy
npm install
npm run smoke
```

The smoke test starts every entry point on ports 3000 to 3003. For each one it connects with the 2026-07-28 protocol and with the 2025 handshake, lists and calls `echo`, receives SSE progress, and checks that no session ID is issued. It also checks the CORS preflight, the `405` on `GET`, and the `403` for a foreign `Host` or `Origin`. Each entry point prints one `passed` line.

To try the server by hand, run `npm start` and open `http://localhost:3000/mcp` in the [mcptest.io playground](/). Leave `PUBLIC_URL` unset locally. Stop the server before you run the smoke test again.

The sample pins `@modelcontextprotocol/server` 2.3.1, `@hono/node-server` 2.1.5 and `zod` 4.6.7, and the smoke client is `@modelcontextprotocol/client` 2.3.1.

## Step 2: Review the Vercel entry point

The function entry imports the shared app and exports it:

```javascript
// api/mcp.mjs
import app from '../app.mjs';
export default app;
```

`app.mjs` exports an object with a `fetch(request)` method. [Vercel's Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js) accepts that web-standard export from a file in the `api` directory. Keep the sample directory as the project root, so the function and the shared app deploy together.

`vercel.json` maps the public `/mcp` path to the function and sets its maximum duration:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": { "api/mcp.mjs": { "maxDuration": 60 } },
  "rewrites": [{ "source": "/mcp", "destination": "/api/mcp" }]
}
```

Do not add a catch-all rewrite to a page, a redirect, or response caching on `/mcp`.

## Step 3: Deploy to Vercel

1. Push the downloaded sample to a Git repository and import it into Vercel. Set the root directory to the sample directory, the framework preset to **Other**, and leave the build command and output directory empty. The server files are plain JavaScript.
2. In the project's environment variables, set `PUBLIC_URL` for Production to your production endpoint, for example `https://YOUR-PROJECT.vercel.app/mcp`. The app accepts only that hostname in `Host`.
3. Redeploy. A change to environment variables applies only to new deployments.
4. Optional: to use your own domain, add it in **Project Settings → Domains** and follow [Vercel's DNS instructions](https://vercel.com/docs/domains/working-with-domains/add-a-domain). When the certificate is ready, change `PUBLIC_URL` to `https://YOUR-DOMAIN/mcp` and redeploy.

Test the production domain. [Deployment Protection](https://vercel.com/docs/deployment-protection) can put a Vercel login in front of preview URLs. That login is not the MCP server's OAuth, and an MCP client cannot complete it. Use the production domain or a deliberately configured automation bypass. Do not make a private project public just to pass a test.

## Step 4: Verify the deployment

Replace `YOUR-PROJECT.vercel.app` with your production hostname.

```bash
# The endpoint offers no GET stream: expect 405.
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-PROJECT.vercel.app/mcp

# A 2026 discovery request: expect 200 and "supportedVersions":["2026-07-28"].
curl -s https://YOUR-PROJECT.vercel.app/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: server/discover' \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"curl-check","version":"1.0.0"},"io.modelcontextprotocol/clientCapabilities":{}}}}'

# A browser preflight: expect 204 and access-control-allow-origin: https://mcptest.io.
curl -s -i -X OPTIONS https://YOUR-PROJECT.vercel.app/mcp \
  -H 'Origin: https://mcptest.io' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,mcp-method,mcp-protocol-version'
```

Then test it on mcptest.io:

1. Open the production endpoint in the playground: `https://mcptest.io/server/` followed by the endpoint without the scheme and a final `/mcp`, for example `mcptest.io/server/YOUR-PROJECT.vercel.app/mcp/mcp`.
2. Confirm that discovery succeeds, that `tools/list` shows `echo`, and that no session ID is issued.
3. Call `echo` with `{"text":"hello","waitMs":500}` and confirm the result is `hello`.
4. Repeat once after the function has been idle and once after a new deployment, to catch cold-start and redeploy problems.

When the URL is stable, add the [pre-deployment release gate](/learn/test-mcp-server-before-deploying) to your pipeline.

The smoke test above passed locally with the pinned versions. It does not exercise Vercel's front door. No Vercel deployment was run for this guide, so check DNS, TLS, duration limits and live streaming in your own account.

## Duration and streaming

[Vercel's duration documentation](https://vercel.com/docs/functions/configuring-functions/duration) lists the default and maximum duration per plan. With Fluid Compute, the default is 300 seconds on every plan. Hobby can be configured up to 300 seconds, and Pro and Enterprise up to 800 seconds. Pro and Enterprise also have a 1800-second maximum in beta. The sample sets 60 seconds, so it does not depend on the beta. Raise `maxDuration` to the longest tool call you support, within your plan's limit.

[Vercel streams function responses](https://vercel.com/docs/functions/streaming-functions). The app returns the response body directly, so SSE progress reaches the client as it is sent. Converting the body to text first would buffer it. A streaming response still counts against `maxDuration`: progress makes long work visible but does not extend the deadline. Give downstream API calls shorter deadlines than the function, and move longer work to a separate job.

## Cold starts and shared instances

With Fluid Compute, one instance can serve several invocations at the same time. Instances can also start cold, or be replaced on redeploy. Module-scope setup, such as the handler, can be reused. Per-user tokens, tool results and sessions must not live in mutable globals.

The sample keeps no state between requests and no in-memory session map, so any instance can answer any request. A stateful 2025 transport would need shared storage. One function file does not mean one long-lived process.

## CORS and the public URL

`PUBLIC_URL` must be the exact production endpoint, including `/mcp`. The app:

- rejects a `Host` other than the `PUBLIC_URL` hostname with `403`;
- rejects an `Origin` that is not on its allowlist with `403`, and lets requests without an `Origin` through;
- answers the `OPTIONS` preflight itself, before the MCP handler, for `https://mcptest.io`;
- allows the MCP request headers, and exposes `WWW-Authenticate`, `MCP-Protocol-Version`, `Mcp-Session-Id` and `Retry-After`.

To allow another browser app, add its exact origin to the `origins` array in `app.mjs`. The SDK's `Origin` check compares hostnames, and the CORS headers echo only exact origins on the list. CORS is not authentication: non-browser clients can omit `Origin`, so protect private tools separately. The [CORS reference](/learn/mcp-cors-headers-for-browser-clients) explains each header.

A new domain is also a new resource URL if you add OAuth later. Change `PUBLIC_URL`, the protected resource metadata, and the identity provider's resource or audience setting together.

## Common failures

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `403` with `Invalid Host: …` | `PUBLIC_URL` is unset, has another hostname, or was changed without a redeploy | Set it to the exact production URL and redeploy. See [Invalid Host header](/learn/mcp-error-invalid-host-header). |
| A Vercel login page or `401` from Vercel instead of MCP | Deployment Protection on a preview URL | Test the production domain, or configure a protection bypass for automation. |
| `GET /mcp` returns `200 text/html` | A catch-all rewrite or page answers the MCP path | Keep the `/mcp` rewrite to `/api/mcp` and remove the catch-all for that path. See [`transport.sse-content-type-mismatch`](/learn/mcp-transport-diagnostics-reference#transport-sse-content-type-mismatch). |
| The browser reports a network error; `curl` works | The browser's origin is not in `origins`, or a header is missing from the preflight | Add the origin and check the preflight. See the [CORS reference](/learn/mcp-cors-headers-for-browser-clients). |
| A long call stops before its result, or the stream is cut | The function reached `maxDuration` | Raise `maxDuration` within your plan, or shorten the work. See [SSE stream disconnected](/learn/mcp-error-sse-stream-disconnected) and [Request timed out](/learn/mcp-error-request-timed-out). |
| `GET /mcp` returns `405` | Expected: the server offers no GET stream | Nothing to fix. See [406, 415 and 405](/learn/mcp-406-not-acceptable-415-and-405). |
