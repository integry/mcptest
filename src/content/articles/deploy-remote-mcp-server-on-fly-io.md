---
title: "Deploy a remote MCP server on Fly.io"
navTitle: "Deploy MCP on Fly.io"
summary: "Run a tested stateless MCP container on Fly Machines, configure autostop, proxy idle timeouts and custom domains, then verify browser CORS and SSE on mcptest.io."
track: "build"
level: "practitioner"
order: 403
category: "Deployment"
readingTimeMinutes: 7
lastReviewed: "2026-10-24"
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

Fly.io runs your MCP server as a process in a Machine. That gives you a familiar container and a streaming HTTP connection, with the option to stop idle Machines. It also means that process restarts, proxy timeouts and routing across Machines are your application's concern.

This guide deploys the same stateless echo sample used by the other platform guides, with Fly-specific settings checked on 24 October 2026. The [general deployment guide](/learn/deploy-remote-mcp-server) covers the wider hosting decision.

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

## Configure the Machine and proxy

The sample contains a Node 22 Dockerfile and a `node.mjs` entry that binds `0.0.0.0` on `PORT`. It uses port 8080 in the container. Here is the complete `fly.toml`:

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

Replace all occurrences of the app name with your globally unique name before deployment. The health check uses `/healthz`, which the shared app implements with `200 ok`; `/mcp` deliberately returns `405` on GET and is a poor health-check target. The explicit check `Host` matches the app's allowlist; Fly's internal health probe would otherwise use a different host. Update that check header when changing `PUBLIC_URL` to a custom domain.

[Fly's configuration reference](https://fly.io/docs/reference/configuration/) documents `internal_port`, the HTTP proxy idle timeout and the autostart controls. Keep the internal port, container `PORT` and actual listener aligned. The public endpoint is HTTPS on port 443; do not give clients the private port 8080.

## Deploy the container

Install `flyctl` and sign in in your environment. From the sample root, after editing `fly.toml`:

```bash
fly apps create YOUR-UNIQUE-MCP-APP
fly deploy
fly status
fly logs
```

Replace `YOUR-UNIQUE-MCP-APP` with the same name used in the file. `fly deploy` reads the included Dockerfile and configuration. Follow the CLI's provisioning instructions for your organization, billing and networking; the guide does not assume an existing app or IP allocation.

The process was run locally through the fixture's Node entry. The Dockerfile and TOML were inspected and syntax checked, but neither a container build nor a Fly deployment was run in the authoring environment.

## Decide whether an idle server should stop

[Autostop/autostart](https://fly.io/docs/launch/autostop-autostart/) lets the proxy stop excess capacity and restart a Machine for a new request. With one Machine, a zero minimum permits stopping when idle. This saves running capacity at the cost of startup latency. A new request can include the time needed to start the process and establish downstream connections.

For a server used throughout the day, set `min_machines_running = 1` and redeploy. That minimum applies in the **primary region** when autostop is enabled; it is not a promise of a warm Machine in every region. Autostop controls existing Machines, not a complete capacity-planning strategy.

Test a cold request after the app has been idle. If it fails while warm requests succeed, inspect startup logs, health-check grace periods and connection timeouts before changing MCP code.

## Preserve SSE without assuming unlimited requests

The sample's tool can emit SSE progress on a POST. Return that stream directly through the Node adapter; do not collect it into a string. Fly Proxy supports streaming HTTP, but a quiet response is still subject to its idle timeout. The sample explicitly configures `idle_timeout = 120` seconds. That is an idle deadline, not a guarantee that clients or upstream APIs will wait two minutes.

Set an application deadline for long tool calls and send meaningful progress when supported by the client. Bytes can prevent an idle timeout; they do not extend a client's total request deadline. Extra CDNs or reverse proxies can introduce buffering and shorter limits, so check the production endpoint with a delayed call.

A long-lived subscription is tied to a live connection. Deployments and Machine stops can end it. Reconnection and any shared notification bus need a deliberate design; keeping one Machine warm does not make a stream permanent.

## Keep sessions out of the Machine's memory

The SDK handler is stateless, including its 2025 compatibility leg. Requests can land on different Machines without a session lookup. If you later introduce an in-memory session table, the next request can reach another Machine or a restarted process and fail. Sticky routing alone cannot restore state lost on restart.

Keep durable application records in an external store. For cross-Machine notifications, use a shared event bus rather than assuming the handler's process-local bus reaches every connection. Avoid coupling a user's authorization state to the last request a warm process happened to serve.

## Put your own domain in front

Follow [Fly's custom-domain instructions](https://fly.io/docs/networking/custom-domain/) to add the hostname, configure the requested DNS records and provision a certificate. Wait for TLS to be ready, change `PUBLIC_URL` in `fly.toml` to `https://YOUR-DOMAIN/mcp`, and deploy again.

The app validates Host. If you intentionally keep both the `.fly.dev` address and a custom domain, extend the host allowlist explicitly and choose one canonical OAuth resource URL for protected tools. Do not disable the check to hide an unexpected proxy Host value.

## CORS and the public URL

Set `PUBLIC_URL` to your exact production endpoint, including `/mcp`. The app validates the incoming `Host` against that hostname and rejects other Origins. It allows browser requests from `https://mcptest.io`, answers `OPTIONS` before the MCP handler, allows the MCP request headers, and exposes `WWW-Authenticate`, `MCP-Protocol-Version`, `Mcp-Session-Id` and `Retry-After`.

To support another browser app, add its exact origin to the `origins` array in `app.mjs`. The SDK Origin check compares hostnames; the CORS response uses the exact origin allowlist. CORS is not user authentication. Non-browser clients can omit Origin, so protect private tools independently. The [CORS reference](/learn/mcp-cors-headers-for-browser-clients) covers the browser checks in detail.

A new custom domain means a new canonical resource URL if you later add OAuth. Update `PUBLIC_URL`, protected resource metadata and the provider's resource/audience configuration together. Test redirects too: an HTML landing page or a login page in front of `/mcp` is not a successful MCP response.

## Test it on mcptest.io

Open the **deployed HTTPS `/mcp` endpoint** in the [mcptest.io playground](/). Check discovery, list tools, and call `echo` with `{"text":"hello","waitMs":500}`. Confirm the result is `hello`, the browser preflight succeeds, the response headers are readable, and there is no session ID. Repeat once after the platform has been idle and once after a new deployment.

The fixture's `npm run smoke` was run locally: pinned 2026 discovery, legacy initialization, tool listing/calling, SSE progress, no-session behavior, allowed-origin preflight, rejected Host/Origin, and GET `405` all passed. Local success does not verify the cloud front door. Deployment CLIs and credentials were unavailable during authoring; cloud deployment, DNS/TLS, platform timeouts and live streaming must be checked in your account. Add the [pre-deployment release gate](/learn/test-mcp-server-before-deploying) once the public URL is stable.
