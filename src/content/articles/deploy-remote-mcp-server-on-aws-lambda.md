---
title: "Deploy a remote MCP server on AWS Lambda with a streaming function URL"
navTitle: "Deploy MCP on AWS Lambda"
summary: "Run a stateless MCP Lambda adapter locally, deploy a RESPONSE_STREAM function URL, and understand API Gateway streaming, payload limits, timeouts and browser CORS."
track: "build"
level: "practitioner"
order: 401
category: "Deployment"
readingTimeMinutes: 8
lastReviewed: "2026-10-24"
metaTitle: "Deploy MCP on AWS Lambda | mcptest.io"
metaDescription: "Run a stateless MCP Lambda adapter locally, deploy a RESPONSE_STREAM function URL, and understand API Gateway streaming, payload limits, timeouts and browser CORS."
relatedSlugs:
  - deploy-remote-mcp-server
  - remote-mcp-server-with-hono
  - mcp-cors-headers-for-browser-clients
  - test-mcp-server-before-deploying
sourceLinks:
  - title: "MCP TypeScript SDK: stateless web handlers"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/serving/web-standard"
  - title: "AWS: writing streaming Lambda functions"
    url: "https://docs.aws.amazon.com/lambda/latest/dg/config-rs-write-functions.html"
  - title: "AWS: response streaming limits and VPC support"
    url: "https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html"
  - title: "AWS: function URL streaming mode"
    url: "https://docs.aws.amazon.com/lambda/latest/dg/config-rs-invoke-furls.html"
  - title: "AWS: Lambda quotas"
    url: "https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html"
  - title: "AWS: API Gateway response transfer modes"
    url: "https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html"
  - title: "AWS: function URL permissions"
    url: "https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html"
  - title: "AWS: API Gateway custom domains"
    url: "https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-custom-domains.html"
---

Lambda can serve a remote MCP endpoint, including SSE on a POST response, if the response stays streaming all the way to the client. A normal buffered Lambda proxy handler is an easy way to make progress notifications arrive only after the work has finished.

This guide uses a streaming **function URL** and a complete Node adapter. AWS now also supports response streaming for qualifying API Gateway REST API proxy integrations; the old blanket claim that API Gateway cannot stream is no longer accurate. Facts below were reviewed on 24 October 2026.

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

## Translate the function URL event into a web request

The sample contains this complete `lambda/index.mjs`:

```javascript
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import app from '../app.mjs';

export const handler = awslambda.streamifyResponse(async (event, output) => {
  const method = event.requestContext.http.method;
  const headers = new Headers(event.headers);
  const url = new URL(event.rawPath, process.env.PUBLIC_URL);
  url.search = event.rawQueryString ?? '';
  const body = event.body == null ? undefined
    : Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
  const request = new Request(url, {
    method, headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body }),
  });
  const response = await app.fetch(request);
  const stream = awslambda.HttpResponseStream.from(output, {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers),
  });
  if (response.body) await pipeline(Readable.fromWeb(response.body), stream);
  else stream.end();
});
```

The `awslambda` global is supplied by the managed Node runtime. [AWS documents the streaming wrapper and response metadata](https://docs.aws.amazon.com/lambda/latest/dg/config-rs-write-functions.html). `pipeline` handles backpressure and closes the stream. The adapter preserves base64 request bodies, query strings, status and headers. It does not call `response.text()` or return a buffered proxy object.

The local smoke runner supplies an AWS-global shim and invokes this adapter with function-URL-shaped events. That verifies conversion and streamed writes, not AWS's wire framing, IAM or internet streaming behavior.

## Deploy the included SAM template

Install AWS SAM and configure credentials in your own environment. From the downloaded sample root:

```bash
npm install --omit=dev
sam build --template-file lambda/template.yaml
sam deploy --guided
```

The complete `lambda/template.yaml` creates a Node 22 function with handler `lambda/index.handler`, a 60-second timeout, 256 MB memory, a function URL with `AuthType: NONE` and `InvokeMode: RESPONSE_STREAM`, and both required public URL invocation permissions. It grants the function basic logging permissions only. Inspect that template before deploying resources to your account.

For the first deployment, leave its `PublicUrl` placeholder. Read the stack's `Endpoint` output, then redeploy with the **PublicUrl stack parameter** set to that exact HTTPS `/mcp` endpoint, using SAM's guided parameter override. Until then, Host validation intentionally rejects calls. Confirm the environment value in the deployed function before testing.

`NONE` lets ordinary MCP clients reach the endpoint without AWS SigV4. It is appropriate for this public echo tool; private tools still need application OAuth. [AWS's URL permissions documentation](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html) explains the separate `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` permissions. `AWS_IAM` is a separate access model that generic OAuth MCP clients do not automatically satisfy.

## Know which streaming limits apply

| Layer | Current documented behavior |
| --- | --- |
| Function URL in `BUFFERED` mode | Complete response is buffered; maximum response is 6 MB. |
| Function URL in `RESPONSE_STREAM` mode | Up to 200 MB. First 6 MB is uncapped; remaining output is capped at 2 MB/s. |
| Lambda execution | Maximum configurable timeout is 900 seconds; this sample uses 60. Streaming does not remove it. |
| API Gateway REST API | Proxy integration must explicitly use response transfer mode `STREAM`. Supports streaming for up to 15 minutes; idle limits depend on endpoint type. |
| API Gateway HTTP API | The REST API streaming feature does not establish HTTP API streaming support. Do not assume an HTTP API preserves SSE. |

Sources: [function URL invoke modes](https://docs.aws.amazon.com/lambda/latest/dg/config-rs-invoke-furls.html), [Lambda streaming](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html), [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html), and [API Gateway transfer modes](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html).

For API Gateway's streaming REST path, only `HTTP_PROXY` and `AWS_PROXY` qualify. Regional/private endpoints have a five-minute idle timeout; edge-optimized endpoints have 30 seconds. The gateway applies its own bandwidth rules: first 10 MB unrestricted, then 2 MB/s. Lambda's limits still apply behind it. The function URL event adapter above is not a drop-in REST API event adapter; adapt the request shape before choosing that route.

AWS also documents regional availability and VPC restrictions for function URL streaming. A browser disconnect does not necessarily stop Lambda execution or billing. Give expensive downstream work explicit deadlines instead of assuming the MCP client's cancellation terminates the invocation.

## Cold starts, sessions and domains

A cold start adds startup latency; provisioned concurrency can reduce it at additional cost. Neither a warm invocation nor provisioned concurrency makes a process a durable session owner. Parallel invocations can land in different execution environments, and deployment replaces them. The stateless handler avoids that routing dependency. Store application data and any long-running job state outside Lambda.

Function URLs use AWS-assigned domains. For a custom hostname, put a correctly configured front door such as CloudFront in front, or choose an [API Gateway custom domain](https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-custom-domains.html) with an appropriate streaming integration. Forward POST, OPTIONS, authorization and MCP headers, disable response caching, preserve streaming, and ensure the Host that reaches the app matches its allowlist. A proxy's viewer domain and origin Host can differ; configure that deliberately rather than disabling validation.

## CORS and the public URL

Set `PUBLIC_URL` to your exact production endpoint, including `/mcp`. The app validates the incoming `Host` against that hostname and rejects other Origins. It allows browser requests from `https://mcptest.io`, answers `OPTIONS` before the MCP handler, allows the MCP request headers, and exposes `WWW-Authenticate`, `MCP-Protocol-Version`, `Mcp-Session-Id` and `Retry-After`.

To support another browser app, add its exact origin to the `origins` array in `app.mjs`. The SDK Origin check compares hostnames; the CORS response uses the exact origin allowlist. CORS is not user authentication. Non-browser clients can omit Origin, so protect private tools independently. The [CORS reference](/learn/mcp-cors-headers-for-browser-clients) covers the browser checks in detail.

A new custom domain means a new canonical resource URL if you later add OAuth. Update `PUBLIC_URL`, protected resource metadata and the provider's resource/audience configuration together. Test redirects too: an HTML landing page or a login page in front of `/mcp` is not a successful MCP response.

Do not configure a second, conflicting CORS policy on the function URL while the application owns CORS. AWS can add its own headers; duplicate `Access-Control-Allow-Origin` values can make an otherwise healthy response unreadable in a browser.

## Test it on mcptest.io

Open the **deployed HTTPS `/mcp` endpoint** in the [mcptest.io playground](/). Check discovery, list tools, and call `echo` with `{"text":"hello","waitMs":500}`. Confirm the result is `hello`, the browser preflight succeeds, the response headers are readable, and there is no session ID. Repeat once after the platform has been idle and once after a new deployment.

The fixture's `npm run smoke` was run locally: pinned 2026 discovery, legacy initialization, tool listing/calling, SSE progress, no-session behavior, allowed-origin preflight, rejected Host/Origin, and GET `405` all passed. Local success does not verify the cloud front door. Deployment CLIs and credentials were unavailable during authoring; cloud deployment, DNS/TLS, platform timeouts and live streaming must be checked in your account. Add the [pre-deployment release gate](/learn/test-mcp-server-before-deploying) once the public URL is stable.
