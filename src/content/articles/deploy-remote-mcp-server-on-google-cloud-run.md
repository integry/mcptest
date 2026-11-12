---
title: "Deploy a remote MCP server on Google Cloud Run"
navTitle: "Deploy MCP on Cloud Run"
summary: "Deploy a tested stateless MCP container to Cloud Run, account for scale-to-zero, request timeouts and best-effort session affinity, then check CORS and SSE in mcptest.io."
track: "build"
level: "practitioner"
order: 402
category: "Deployment"
readingTimeMinutes: 7
lastReviewed: "2026-11-11"
metaTitle: "Deploy MCP on Cloud Run | mcptest.io"
metaDescription: "Deploy a tested stateless MCP container to Cloud Run, account for scale-to-zero, request timeouts and best-effort session affinity, then check CORS and SSE in mcptest.io."
relatedSlugs:
  - deploy-remote-mcp-server
  - remote-mcp-server-with-hono
  - mcp-cors-headers-for-browser-clients
  - test-mcp-server-before-deploying
sourceLinks:
  - title: "MCP TypeScript SDK: stateless web handlers"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/serving/web-standard"
  - title: "Cloud Run: container runtime contract"
    url: "https://docs.cloud.google.com/run/docs/container-contract"
  - title: "Cloud Run: deploy source code"
    url: "https://docs.cloud.google.com/run/docs/deploying-source-code"
  - title: "Cloud Run: request timeout"
    url: "https://docs.cloud.google.com/run/docs/configuring/request-timeout"
  - title: "Cloud Run: minimum instances"
    url: "https://docs.cloud.google.com/run/docs/configuring/min-instances"
  - title: "Cloud Run: session affinity"
    url: "https://docs.cloud.google.com/run/docs/configuring/session-affinity"
  - title: "Cloud Run: mapping custom domains"
    url: "https://docs.cloud.google.com/run/docs/mapping-custom-domains"
---

Cloud Run is a straightforward home for an MCP server that already runs as a Node.js process. You package the process as a container and listen on the port Cloud Run provides. Cloud Run terminates HTTPS and scales instances for you. In exchange, an instance can stop when traffic stops, so the server must not depend on process memory between requests.

This guide deploys a small, tested echo server. For a comparison of hosting models, see [deploying a remote MCP server](/learn/deploy-remote-mcp-server).

## What you will build

- A stateless MCP server in a container, served at `https://SERVICE-URL/mcp`.
- One read-only `echo` tool. It takes a required `text` string and an optional `waitMs` delay from 0 to 1000, sends a progress notification when the caller asks for one, and returns the text.
- One URL for both protocol eras. `createMcpHandler` answers 2026-07-28 requests directly and 2025 clients through `legacy: 'stateless'`. It issues no `Mcp-Session-Id`, and `GET /mcp` returns `405`. A response upgrades to SSE when the tool sends progress. There is no separate `/sse` endpoint.
- `Host` and `Origin` validation, and CORS for browser clients at `https://mcptest.io`.

The server has no authentication. Before you connect private data, add [bearer authorization and protected resource metadata](/learn/mcp-server-authentication-patterns).

## Prerequisites

- Node.js 22 and npm. The sample was tested with Node.js 22.23.4.
- A Google Cloud project with billing enabled, and permission to enable APIs and deploy Cloud Run services.
- The [Google Cloud CLI](https://cloud.google.com/sdk/docs/install), signed in with `gcloud auth login`.
- `curl`, to check the deployment. Docker is optional.

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

## Step 2: Review the container

The sample includes this `Dockerfile`:

```dockerfile
FROM node:22.23.4-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY app.mjs node.mjs ./
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "node.mjs"]
```

`node.mjs` is the process entry:

```javascript
import { serve } from '@hono/node-server';
import app from './app.mjs';
serve({ fetch: app.fetch, hostname: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
```

[Cloud Run's container contract](https://docs.cloud.google.com/run/docs/container-contract) requires the container to listen on `0.0.0.0` at the port in the `PORT` environment variable, not only on loopback. TLS ends before the container, so the process serves plain HTTP while clients use HTTPS.

If Docker is installed, you can check the image locally:

```bash
docker build -t echo-mcp .
docker run --rm -p 8080:8080 -e PUBLIC_URL=http://localhost:8080/mcp echo-mcp
```

## Step 3: Deploy from the sample directory

Replace the project ID, and change the region if you need to:

```bash
export GOOGLE_CLOUD_PROJECT='replace-with-your-project-id'
gcloud config set project "$GOOGLE_CLOUD_PROJECT"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
gcloud run deploy echo-mcp --source . --region us-central1 \
  --port 8080 --timeout 60 --min 0 --concurrency 40 \
  --no-session-affinity --allow-unauthenticated
```

[Source deployment](https://docs.cloud.google.com/run/docs/deploying-source-code) builds the included Dockerfile with Cloud Build and stores the image in Artifact Registry. The flags set the container port, a 60-second request timeout, no minimum instances, up to 40 concurrent requests per instance, and no session affinity. `--allow-unauthenticated` lets ordinary MCP clients reach this echo demo. Cloud Run IAM sign-in and MCP OAuth are different mechanisms: add application OAuth before you serve private tools.

## Step 4: Set the public URL

The first revision rejects requests, because the app accepts only the `PUBLIC_URL` hostname in `Host` and the default is `localhost`. Read the service URL and set `PUBLIC_URL`:

```bash
MCP_SERVICE_URL="$(gcloud run services describe echo-mcp --region us-central1 --format='value(status.url)')"
gcloud run services update echo-mcp --region us-central1 \
  --set-env-vars "PUBLIC_URL=${MCP_SERVICE_URL}/mcp"
```

The update creates a new revision. Wait until it is ready before you test.

## Step 5: Verify the deployment

```bash
# The endpoint offers no GET stream: expect 405.
curl -s -o /dev/null -w '%{http_code}\n' "${MCP_SERVICE_URL}/mcp"

# A 2026 discovery request: expect 200 and "supportedVersions":["2026-07-28"].
curl -s "${MCP_SERVICE_URL}/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: server/discover' \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"curl-check","version":"1.0.0"},"io.modelcontextprotocol/clientCapabilities":{}}}}'

# A browser preflight: expect 204 and access-control-allow-origin: https://mcptest.io.
curl -s -i -X OPTIONS "${MCP_SERVICE_URL}/mcp" \
  -H 'Origin: https://mcptest.io' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,mcp-method,mcp-protocol-version'
```

Then test it on mcptest.io:

1. Open the endpoint in the playground: `https://mcptest.io/server/` followed by the endpoint without the scheme and a final `/mcp`, for example `mcptest.io/server/YOUR-SERVICE-HOSTNAME/mcp/mcp`.
2. Confirm that discovery succeeds, that `tools/list` shows `echo`, and that no session ID is issued.
3. Call `echo` with `{"text":"hello","waitMs":500}` and confirm the result is `hello`, with a progress notification first.
4. Repeat once after the service has been idle and once after a new deployment, to catch cold-start and redeploy problems.

When the URL is stable, add the [pre-deployment release gate](/learn/test-mcp-server-before-deploying) to your pipeline.

The smoke test above passed locally with the pinned versions, through the same Node entry the container runs. It does not exercise Google's front end. No container build or Cloud Run deployment was run for this guide, so check IAM, DNS, TLS, timeouts and live streaming in your own project.

## Scale to zero or keep one instance warm

With minimum instances at zero, an idle service scales to zero. The next request waits for an instance to start. [Minimum instances](https://docs.cloud.google.com/run/docs/configuring/min-instances) keep capacity ready, at a cost. For a latency-sensitive endpoint, run:

```bash
gcloud run services update echo-mcp --region us-central1 --min 1
```

`--min` sets a service-level minimum that applies without a new revision. The older `--min-instances` flag sets it per revision.

Warm instances can still restart or be replaced. A timeout right after an idle period, on a URL that works when retried, often points to startup time. Compare cold and warm requests, and keep startup work small. Never store per-user credentials in a global variable that concurrent requests share.

## Streaming and request deadlines

[Cloud Run's request timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout) defaults to 5 minutes and can be raised to 60 minutes. The sample sets 60 seconds. Per the [container runtime contract](https://docs.cloud.google.com/run/docs/container-contract), the response must finish within the timeout, counted from when the request arrives and including container startup. SSE progress does not reset the timeout. When the timeout ends a request, the code in the container may keep running, so enforce deadlines inside expensive tools too.

Cloud Run streams responses. The Node adapter passes the response stream straight to HTTP. Keep `text/event-stream` intact, and avoid buffering proxies, compression middleware or CDN caching in front of `/mcp`. Check that a progress notification reaches the deployed client before the final result.

## Session affinity is not durable storage

[Cloud Run session affinity](https://docs.cloud.google.com/run/docs/configuring/session-affinity) is best effort and based on a cookie. A client may not send the cookie, instances can stop, and a busy instance can be skipped. Affinity cannot keep an in-memory MCP session alive through scale-to-zero or a new deployment.

Leave affinity off for this sample. Every 2026 request and every stateless 2025 exchange can run on any instance. If you add a stateful transport or cross-instance notifications, put that state in an external store first. If a 2025 client reports `Session not found` after a deploy, read [Session not found after deploy](/learn/mcp-session-not-found-after-deploy).

## Add a custom domain

[Cloud Run's domain documentation](https://docs.cloud.google.com/run/docs/mapping-custom-domains) lists three options: a global external Application Load Balancer (recommended), Firebase Hosting, and Cloud Run domain mapping, which is in Preview with limited availability. Choose an option your region supports, configure DNS and TLS, then set `PUBLIC_URL` to the new `https://YOUR-DOMAIN/mcp` endpoint.

If you add a load balancer, check which `Host` reaches the container, and allowlist every hostname the app should accept. Check its timeout and buffering too: raising Cloud Run's timeout does not raise a load balancer's.

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
| `403` with `Invalid Host: …` | `PUBLIC_URL` is unset or names another hostname, such as before step 4 or after adding a domain | Set it to the exact public URL and wait for the new revision. See [Invalid Host header](/learn/mcp-error-invalid-host-header). |
| `403` from Google with an HTML page | The service requires IAM authentication | Deploy with `--allow-unauthenticated`, or use an IAM-aware client. See [401 Unauthorized](/learn/remote-mcp-server-401-unauthorized) for MCP's own auth errors. |
| The first request after idle times out; a retry works | Cold start | Keep startup small, or set `--min 1`. See [Request timed out](/learn/mcp-error-request-timed-out). |
| A long call stops before its result, or the stream is cut | The request timeout was reached | Raise `--timeout` up to 60 minutes, or shorten the work. See [SSE stream disconnected](/learn/mcp-error-sse-stream-disconnected). |
| The browser reports a network error; `curl` works | The browser's origin is not in `origins`, or a header is missing from the preflight | Add the origin and check the preflight. See the [CORS reference](/learn/mcp-cors-headers-for-browser-clients). |
| `GET /mcp` returns `405` | Expected: the server offers no GET stream | Nothing to fix. See [406, 415 and 405](/learn/mcp-406-not-acceptable-415-and-405). |
