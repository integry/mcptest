---
title: "Deploy a remote MCP server on Google Cloud Run"
navTitle: "Deploy MCP on Cloud Run"
summary: "Deploy a tested stateless MCP container to Cloud Run, account for scale-to-zero, request timeouts and best-effort session affinity, then check CORS and SSE in mcptest.io."
track: "build"
level: "practitioner"
order: 402
category: "Deployment"
readingTimeMinutes: 7
lastReviewed: "2026-10-24"
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

Cloud Run is a straightforward home for an MCP server you already run as a Node process. Package the process as a container, listen on the provided port, and let Cloud Run handle HTTPS and instance scaling. The tradeoff is that a process can disappear when traffic stops, so your server must tolerate that lifecycle.

This guide uses a stateless sample and focuses on Cloud Run configuration, reviewed on 24 October 2026. For the wider hosting comparison, see [deploying a remote MCP server](/learn/deploy-remote-mcp-server).

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

## Containerize the server

The sample includes this complete `Dockerfile`:

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

`node.mjs` is the complete process entry:

```javascript
import { serve } from '@hono/node-server';
import app from './app.mjs';
serve({ fetch: app.fetch, hostname: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
```

[Cloud Run's container contract](https://docs.cloud.google.com/run/docs/container-contract) requires the ingress container to listen on `0.0.0.0` and the configured `PORT`, not only loopback. TLS terminates before the container, so this process serves HTTP. The public MCP URL still uses HTTPS.

If Docker is installed, build with `docker build -t echo-mcp .` and run with `docker run --rm -p 8080:8080 -e PUBLIC_URL=http://localhost:8080/mcp echo-mcp`. These are complete optional container checks; Docker was unavailable during authoring, so the equivalent Node entry was what ran locally.

## Deploy from the sample directory

With the Google Cloud CLI installed, choose your own project and region:

```bash
export GOOGLE_CLOUD_PROJECT='replace-with-your-project-id'
gcloud config set project "$GOOGLE_CLOUD_PROJECT"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
gcloud run deploy echo-mcp --source . --region us-central1 \
  --port 8080 --timeout 60 --min 0 --concurrency 40 \
  --no-session-affinity --allow-unauthenticated
MCP_SERVICE_URL="$(gcloud run services describe echo-mcp --region us-central1 --format='value(status.url)')"
gcloud run services update echo-mcp --region us-central1 \
  --set-env-vars "PUBLIC_URL=${MCP_SERVICE_URL}/mcp"
```

Replace the project ID before running. [Source deployment](https://docs.cloud.google.com/run/docs/deploying-source-code) builds the included Dockerfile with Cloud Build and stores the image in Artifact Registry; your account needs permissions and billing for those services. The first revision will reject public Host headers until the update sets `PUBLIC_URL`. Wait for the updated revision to be ready.

`--allow-unauthenticated` makes this echo demo reachable by ordinary MCP clients. Cloud Run IAM sign-in and MCP OAuth are different mechanisms. Add application OAuth before serving private tools, or deliberately choose an IAM-aware client and a different access design.

## Scale to zero or keep one warm

With minimum instances at zero, an idle service can scale to zero. The next request waits for capacity and process startup. [Minimum instances](https://docs.cloud.google.com/run/docs/configuring/min-instances) can keep capacity available; for a latency-sensitive endpoint, update the service with `gcloud run services update echo-mcp --region us-central1 --min 1` and account for the cost. Warm instances can still restart or be replaced.

A connection timeout immediately after an idle period may be a startup problem, even if the same URL works on retry. Compare cold and warm requests, trim initialization work, and choose downstream connection pools that survive instance churn. Never store per-user credentials in a global variable that concurrent requests can share.

## Streaming and request deadlines

[Cloud Run's timeout documentation](https://docs.cloud.google.com/run/docs/configuring/request-timeout) gives a five-minute default and a maximum of 60 minutes. This sample explicitly chooses 60 seconds. The deadline includes startup and response completion; emitting SSE does not reset it. A timeout can close the client response while container code continues running, so also enforce deadlines inside expensive tools.

The Node adapter passes the web response stream through to HTTP. Cloud Run supports streamed responses; preserve `text/event-stream` and avoid buffering proxies, compression middleware or CDN caching in front of `/mcp`. Verify a progress notification reaches the deployed client before the final result. The local smoke run validates SSE at the Node entry, not Google's load balancer.

## Session affinity is not durable storage

[Cloud Run session affinity](https://docs.cloud.google.com/run/docs/configuring/session-affinity) is best effort and cookie based. A client may not send the cookie, instances can disappear, and concurrency limits can route requests elsewhere. It cannot make an in-memory MCP session reliable through scale-to-zero or deployment.

Leave affinity disabled for this sample. Each 2026 request and each stateless 2025 exchange can run on any instance. If you add stateful transport or subscription fan-out, design an external state/event layer and its failure behavior first. A database-backed business record is separate from an MCP session and should survive container replacement.

## Add a custom domain

[Cloud Run's domain documentation](https://docs.cloud.google.com/run/docs/mapping-custom-domains) describes supported front doors, including a global external Application Load Balancer and domain mapping with its availability limitations. Choose the route supported in your region, configure DNS and TLS, then set `PUBLIC_URL` to the new HTTPS `/mcp` endpoint.

Check the backend Host behavior if you add a load balancer. Any hostname your application accepts should be explicitly allowlisted. Recheck its timeout and buffering policy too: raising Cloud Run's timeout does not raise a proxy's deadline.

## CORS and the public URL

Set `PUBLIC_URL` to your exact production endpoint, including `/mcp`. The app validates the incoming `Host` against that hostname and rejects other Origins. It allows browser requests from `https://mcptest.io`, answers `OPTIONS` before the MCP handler, allows the MCP request headers, and exposes `WWW-Authenticate`, `MCP-Protocol-Version`, `Mcp-Session-Id` and `Retry-After`.

To support another browser app, add its exact origin to the `origins` array in `app.mjs`. The SDK Origin check compares hostnames; the CORS response uses the exact origin allowlist. CORS is not user authentication. Non-browser clients can omit Origin, so protect private tools independently. The [CORS reference](/learn/mcp-cors-headers-for-browser-clients) covers the browser checks in detail.

A new custom domain means a new canonical resource URL if you later add OAuth. Update `PUBLIC_URL`, protected resource metadata and the provider's resource/audience configuration together. Test redirects too: an HTML landing page or a login page in front of `/mcp` is not a successful MCP response.

## Test it on mcptest.io

Open the **deployed HTTPS `/mcp` endpoint** in the [mcptest.io playground](/). Check discovery, list tools, and call `echo` with `{"text":"hello","waitMs":500}`. Confirm the result is `hello`, the browser preflight succeeds, the response headers are readable, and there is no session ID. Repeat once after the platform has been idle and once after a new deployment.

The fixture's `npm run smoke` was run locally: pinned 2026 discovery, legacy initialization, tool listing/calling, SSE progress, no-session behavior, allowed-origin preflight, rejected Host/Origin, and GET `405` all passed. Local success does not verify the cloud front door. Deployment CLIs and credentials were unavailable during authoring; cloud deployment, DNS/TLS, platform timeouts and live streaming must be checked in your account. Add the [pre-deployment release gate](/learn/test-mcp-server-before-deploying) once the public URL is stable.
