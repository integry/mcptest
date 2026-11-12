---
title: "Deploy a remote MCP server on Fly.io"
navTitle: "Deploy MCP on Fly.io"
summary: "Run a tested stateless MCP container on Fly Machines, configure autostop, proxy idle timeouts and custom domains, then verify browser CORS and SSE on mcptest.io."
track: "build"
level: "practitioner"
order: 403
category: "Deployment"
readingTimeMinutes: 7
lastReviewed: "2026-11-11"
metaTitle: "Deploy MCP on Fly.io | mcptest.io"
metaDescription: "Run a tested stateless MCP container on Fly Machines, configure autostop, proxy idle timeouts and custom domains, then verify browser CORS and SSE on mcptest.io."
relatedSlugs:
  - deploy-remote-mcp-server
  - remote-mcp-server-with-hono
  - mcp-cors-headers-for-browser-clients
  - test-mcp-server-before-deploying
sourceLinks:
  - title: "MCP TypeScript SDK: stateless web handlers"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/serving/web-standard"
  - title: "Fly.io: application configuration"
    url: "https://fly.io/docs/reference/configuration/"
  - title: "Fly.io: autostop and autostart"
    url: "https://fly.io/docs/launch/autostop-autostart/"
  - title: "Fly.io: custom domains"
    url: "https://fly.io/docs/networking/custom-domain/"
  - title: "Fly.io: deploy an app"
    url: "https://fly.io/docs/launch/deploy/"
---

Fly.io runs your MCP server as a process in a Fly Machine. You get an ordinary container and streaming HTTP, and Fly can stop Machines when they are idle. In exchange, process restarts, proxy timeouts and requests spread across Machines are your application's concern.

This guide deploys the same small, tested echo server as the other platform guides. For a comparison of hosting models, see the [general deployment guide](/learn/deploy-remote-mcp-server).

## What you will build

- A stateless MCP server in a container, served at `https://YOUR-APP.fly.dev/mcp`.
- One read-only `echo` tool. It takes a required `text` string and an optional `waitMs` delay from 0 to 1000, sends a progress notification when the caller asks for one, and returns the text.
- One URL for both protocol eras. `createMcpHandler` answers 2026-07-28 requests directly and 2025 clients through `legacy: 'stateless'`. It issues no `Mcp-Session-Id`, and `GET /mcp` returns `405`. A response upgrades to SSE when the tool sends progress. There is no separate `/sse` endpoint.
- `Host` and `Origin` validation, CORS for browser clients at `https://mcptest.io`, and a `/healthz` route for Fly's health check.

The server has no authentication. Before you connect private data, add [bearer authorization and protected resource metadata](/learn/mcp-server-authentication-patterns).

## Prerequisites

- Node.js 22 and npm. The sample was tested with Node.js 22.23.4.
- A Fly.io account, and [`flyctl`](https://fly.io/docs/flyctl/install/) signed in with `fly auth login`.
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

## Step 2: Edit `fly.toml`

The sample has a Node.js 22 Dockerfile and a `node.mjs` entry that listens on `0.0.0.0` at `PORT`, which is 8080 in the container. This is the complete `fly.toml`:

```toml
app = "replace-with-your-unique-mcp-app"
primary_region = "iad"
[build]
  dockerfile = "Dockerfile"
[env]
  PORT = "8080"
  PUBLIC_URL = "https://replace-with-your-unique-mcp-app.fly.dev/mcp"
[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0
  [http_service.http_options]
    idle_timeout = 120
  [[http_service.checks]]
    interval = "30s"
    timeout = "5s"
    grace_period = "10s"
    method = "GET"
    path = "/healthz"
    [http_service.checks.headers]
      Host = "replace-with-your-unique-mcp-app.fly.dev"
```

Replace all three occurrences of `replace-with-your-unique-mcp-app` with an app name that is unique on Fly.io. Then check these settings:

- **`internal_port`, `PORT` and the listener must match.** Clients use HTTPS on port 443. Never give them the internal port 8080.
- **The health check uses `/healthz`.** The app answers it with `200 ok`. `/mcp` returns `405` on `GET`, so it is a poor health-check target.
- **The health check sets `Host`.** Fly runs checks against the Machine over the private network, not through the public `.fly.dev` hostname. The app rejects any `Host` other than the `PUBLIC_URL` hostname, so the check sends that hostname explicitly. Update this header whenever you change `PUBLIC_URL`.

[Fly's configuration reference](https://fly.io/docs/reference/configuration/) documents every key in this file.

## Step 3: Create the app and deploy

From the sample directory, using the app name from `fly.toml`:

```bash
fly apps create YOUR-UNIQUE-MCP-APP
fly deploy
fly status
fly logs
```

`fly deploy` builds the included Dockerfile and starts Machines with the settings in `fly.toml`. Follow the CLI's prompts for your organization and billing.

## Step 4: Verify the deployment

Replace `YOUR-APP.fly.dev` with your app's hostname.

```bash
# The endpoint offers no GET stream: expect 405.
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-APP.fly.dev/mcp

# A 2026 discovery request: expect 200 and "supportedVersions":["2026-07-28"].
curl -s https://YOUR-APP.fly.dev/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: server/discover' \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"curl-check","version":"1.0.0"},"io.modelcontextprotocol/clientCapabilities":{}}}}'

# A browser preflight: expect 204 and access-control-allow-origin: https://mcptest.io.
curl -s -i -X OPTIONS https://YOUR-APP.fly.dev/mcp \
  -H 'Origin: https://mcptest.io' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,mcp-method,mcp-protocol-version'
```

Then test it on mcptest.io:

1. Open the endpoint in the playground: `https://mcptest.io/server/` followed by the endpoint without the scheme and a final `/mcp`, for example `mcptest.io/server/YOUR-APP.fly.dev/mcp/mcp`.
2. Confirm that discovery succeeds, that `tools/list` shows `echo`, and that no session ID is issued.
3. Call `echo` with `{"text":"hello","waitMs":500}` and confirm the result is `hello`, with a progress notification first.
4. Repeat once after the app has been idle and once after a new deployment, to catch cold-start and redeploy problems.

When the URL is stable, add the [pre-deployment release gate](/learn/test-mcp-server-before-deploying) to your pipeline.

The smoke test above passed locally with the pinned versions, through the same Node entry the container runs. It does not exercise Fly's proxy. No container build or Fly deployment was run for this guide, so check DNS, TLS, timeouts and live streaming in your own account.

## Decide whether an idle server should stop

With [autostop and autostart](https://fly.io/docs/launch/autostop-autostart/), Fly's proxy stops Machines that have no traffic and starts one again when a request arrives. With `min_machines_running = 0`, every Machine can stop. That saves cost, but the next request waits for the Machine and the process to start.

For a server used throughout the day, set `min_machines_running = 1` and deploy again. That minimum applies to the primary region only. It does not keep a Machine warm in every region.

If a request after an idle period fails while warm requests succeed, check the startup logs, the health-check grace period and connection timeouts before you change MCP code.

## Keep SSE streams within the proxy timeout

The `echo` tool can stream SSE progress on a `POST`. The Node adapter passes that stream through; do not collect it into a string first. Fly's proxy streams HTTP responses, but can close a connection that stays quiet for longer than its idle timeout. The sample sets `idle_timeout = 120` under `http_options`. Fly's reference shows the key but does not state its unit or default, so check a deliberately quiet call against your deployed app. Bytes on the stream reset an idle timer. They do not extend a client's own total deadline.

Set an application deadline for long tool calls, and send progress notifications while they run. A CDN or reverse proxy in front of Fly can buffer responses or have shorter limits, so test the production endpoint with a delayed call.

Deployments and Machine stops end open streams. A long-lived subscription needs reconnection logic in the client, and cross-Machine notifications need a shared event bus. Keeping one Machine warm does not make a stream permanent.

## Keep sessions out of the Machine's memory

The SDK handler is stateless, including its 2025 compatibility path, so any Machine can answer any request. If you later add an in-memory session table, the next request can reach another Machine or a restarted process and fail with `Session not found`. Sticky routing cannot bring back state lost in a restart. [Session not found after deploy](/learn/mcp-session-not-found-after-deploy) covers the alternatives.

Keep application data in an external store, and do not tie a user's authorization state to whichever warm process served their last request.

## Add a custom domain

Follow [Fly's custom-domain instructions](https://fly.io/docs/networking/custom-domain/): add the hostname with `fly certs add YOUR-DOMAIN`, create the DNS records it asks for, and wait for the certificate. Then change `PUBLIC_URL` and the health-check `Host` in `fly.toml` to the new hostname, and deploy again.

The app accepts one hostname. To keep both the `.fly.dev` address and a custom domain, extend the host allowlist in `app.mjs` explicitly, and pick one canonical OAuth resource URL for protected tools. Do not turn the check off to hide an unexpected `Host`.

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
| `403` with `Invalid Host: …` | `PUBLIC_URL` names another hostname, for example after adding a custom domain | Set it to the exact public URL and deploy again. See [Invalid Host header](/learn/mcp-error-invalid-host-header). |
| The health check fails and Machines restart | The check's `Host` header does not match `PUBLIC_URL`, or it targets `/mcp` | Point the check at `/healthz` and set its `Host` to the public hostname. |
| The first request after idle times out; a retry works | The Machine was stopped and is starting | Set `min_machines_running = 1`, or keep startup small. See [Request timed out](/learn/mcp-error-request-timed-out). |
| A quiet, long call is cut off | The proxy's idle timeout closed the connection | Send progress while the tool runs, or raise `idle_timeout`. See [SSE stream disconnected](/learn/mcp-error-sse-stream-disconnected). |
| The browser reports a network error; `curl` works | The browser's origin is not in `origins`, or a header is missing from the preflight | Add the origin and check the preflight. See the [CORS reference](/learn/mcp-cors-headers-for-browser-clients). |
| `GET /mcp` returns `405` | Expected: the server offers no GET stream | Nothing to fix. See [406, 415 and 405](/learn/mcp-406-not-acceptable-415-and-405). |
