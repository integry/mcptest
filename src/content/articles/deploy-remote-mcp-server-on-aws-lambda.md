---
title: "Deploy a remote MCP server on AWS Lambda with a streaming function URL"
navTitle: "Deploy MCP on AWS Lambda"
summary: "Run a stateless MCP Lambda adapter locally, deploy a RESPONSE_STREAM function URL, and understand API Gateway streaming, payload limits, timeouts and browser CORS."
track: "build"
level: "practitioner"
order: 401
category: "Deployment"
readingTimeMinutes: 8
lastReviewed: "2026-11-11"
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

Lambda can serve a remote MCP endpoint, including SSE on a `POST` response, if the response streams all the way to the client. A normal buffered Lambda proxy handler holds the whole response until the work is done, so progress notifications arrive only at the end.

This guide deploys a small, tested echo server behind a streaming Lambda **function URL**, using a complete Node.js adapter. For a comparison of hosting models, see the [general deployment guide](/learn/deploy-remote-mcp-server).

## What you will build

- A stateless MCP server on a Lambda function URL in `RESPONSE_STREAM` mode, served at `https://URL-ID.lambda-url.REGION.on.aws/mcp`.
- One read-only `echo` tool. It takes a required `text` string and an optional `waitMs` delay from 0 to 1000, sends a progress notification when the caller asks for one, and returns the text.
- One URL for both protocol eras. `createMcpHandler` answers 2026-07-28 requests directly and 2025 clients through `legacy: 'stateless'`. It issues no `Mcp-Session-Id`, and `GET /mcp` returns `405`. A response upgrades to SSE when the tool sends progress. There is no separate `/sse` endpoint.
- `Host` and `Origin` validation, and CORS for browser clients at `https://mcptest.io`.

The server has no authentication. Before you connect private data, add [bearer authorization and protected resource metadata](/learn/mcp-server-authentication-patterns).

## Prerequisites

- Node.js 22 and npm. The sample was tested with Node.js 22.23.4.
- An AWS account, with credentials that can create Lambda functions, IAM roles and CloudFormation stacks.
- The [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html).
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

For the Lambda entry, the smoke test supplies a small stand-in for the `awslambda` global and sends function-URL-shaped events to the adapter. That checks the event conversion and the streamed writes. It does not check AWS's wire framing, IAM, or streaming over the internet.

To try the server by hand, run `npm start` and open `http://localhost:3000/mcp` in the [mcptest.io playground](/). Leave `PUBLIC_URL` unset locally. Stop the server before you run the smoke test again.

The sample pins `@modelcontextprotocol/server` 2.3.1, `@hono/node-server` 2.1.5 and `zod` 4.6.7, and the smoke client is `@modelcontextprotocol/client` 2.3.1.

## Step 2: Review the function URL adapter

`lambda/index.mjs` turns a function URL event into a web `Request`, calls the shared app, and streams the `Response` back:

```javascript
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import app from '../app.mjs';

export const handler = awslambda.streamifyResponse(async (event, output) => {
  const method = event.requestContext.http.method;
  const headers = new Headers(event.headers);
  if (event.cookies?.length) headers.set('cookie', event.cookies.join('; '));
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

The managed Node.js runtime provides the `awslambda` global. AWS documents [`streamifyResponse`](https://docs.aws.amazon.com/lambda/latest/dg/config-rs-write-functions.html) and, in its [streaming tutorial](https://docs.aws.amazon.com/lambda/latest/dg/response-streaming-tutorial.html), `HttpResponseStream.from` with a status code and headers. The adapter keeps base64 request bodies, query strings, status codes and headers. Function URL events carry cookies in a separate `cookies` array, so the adapter rebuilds the `Cookie` header from it. `pipeline` handles backpressure and closes the stream. The adapter never calls `response.text()` or returns a buffered proxy object, either of which would hold back SSE.

## Step 3: Deploy the SAM template

From the sample directory:

```bash
npm install --omit=dev
sam build --template-file lambda/template.yaml
sam deploy --guided
```

`lambda/template.yaml` creates:

- a Node.js 22 function with handler `lambda/index.handler`, a 60-second timeout and 256 MB of memory;
- a function URL with `AuthType: NONE` and `InvokeMode: RESPONSE_STREAM`;
- the two resource-based permissions a public function URL needs, `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction`;
- an execution role with basic logging permissions only.

Read the template before you deploy it to your account.

`AuthType: NONE` lets ordinary MCP clients call the endpoint without AWS SigV4 signing. That suits this public echo tool; private tools still need application OAuth. `AWS_IAM` is a different access model that MCP OAuth clients do not satisfy. [AWS's function URL permissions page](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html) explains both permissions.

## Step 4: Set the public URL

The first deployment uses the template's placeholder `PublicUrl`, so the app rejects every request with `403 Invalid Host`. Copy the stack's `Endpoint` output, then deploy again with the parameter set to that exact URL:

```bash
sam deploy --parameter-overrides PublicUrl=https://URL-ID.lambda-url.REGION.on.aws/mcp
```

Check the `PUBLIC_URL` environment variable on the deployed function before you test.

## Step 5: Verify the deployment

Set `MCP_URL` to the `Endpoint` output.

```bash
MCP_URL='https://URL-ID.lambda-url.REGION.on.aws/mcp'

# The endpoint offers no GET stream: expect 405.
curl -s -o /dev/null -w '%{http_code}\n' "$MCP_URL"

# A 2026 discovery request: expect 200 and "supportedVersions":["2026-07-28"].
curl -s "$MCP_URL" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: server/discover' \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"curl-check","version":"1.0.0"},"io.modelcontextprotocol/clientCapabilities":{}}}}'

# A browser preflight: expect 204 and access-control-allow-origin: https://mcptest.io.
curl -s -i -X OPTIONS "$MCP_URL" \
  -H 'Origin: https://mcptest.io' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,mcp-method,mcp-protocol-version'
```

Then test it on mcptest.io:

1. Open the endpoint in the playground: `https://mcptest.io/server/` followed by the endpoint without the scheme and a final `/mcp`, for example `mcptest.io/server/URL-ID.lambda-url.REGION.on.aws/mcp/mcp`.
2. Confirm that discovery succeeds, that `tools/list` shows `echo`, and that no session ID is issued.
3. Call `echo` with `{"text":"hello","waitMs":500}` and confirm the result is `hello`, with a progress notification first. If the progress arrives only together with the result, something buffers the response.
4. Repeat once after the function has been idle and once after a new deployment, to catch cold-start and redeploy problems.

When the URL is stable, add the [pre-deployment release gate](/learn/test-mcp-server-before-deploying) to your pipeline.

The smoke test above passed locally with the pinned versions. No SAM build or AWS deployment was run for this guide, so check IAM, timeouts and live streaming in your own account.

## Know which streaming limits apply

| Layer | Current documented behavior |
| --- | --- |
| Function URL in `BUFFERED` mode | Complete response is buffered; maximum response is 6 MB. |
| Function URL in `RESPONSE_STREAM` mode | Up to 200 MB. First 6 MB is uncapped; remaining output is capped at 2 MB/s. |
| Lambda execution | Maximum configurable timeout is 900 seconds; this sample uses 60. Streaming does not remove it. |
| API Gateway REST API | Proxy integration must explicitly use response transfer mode `STREAM`. Supports streaming for up to 15 minutes; idle limits depend on endpoint type. |
| API Gateway HTTP API | Not supported. AWS states that response streaming is only supported for REST APIs. |

Sources: [function URL invoke modes](https://docs.aws.amazon.com/lambda/latest/dg/config-rs-invoke-furls.html), [Lambda response streaming](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html), [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html), and [API Gateway response transfer modes](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html).

For API Gateway's streaming REST path, only `HTTP_PROXY` and `AWS_PROXY` integrations qualify. Regional and private endpoints have a 5-minute idle timeout, and edge-optimized endpoints 30 seconds. The gateway sends the first 10 MB unrestricted, then up to 2 MB/s, and Lambda's own limits still apply behind it. The adapter above reads function URL events, not REST API events, so adapt the request shape before you choose that route.

Function URL streaming is not available in every AWS Region, and function URLs do not support response streaming inside a VPC. Check both in the [Lambda response streaming documentation](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html).

A client disconnect does not necessarily stop the Lambda invocation or its billing. Give expensive downstream work its own deadlines instead of relying on the MCP client's cancellation.

## Cold starts and sessions

A cold start adds startup latency. Provisioned concurrency can reduce it, at extra cost. Neither makes an execution environment a durable session owner: parallel invocations run in different environments, and a deployment replaces them all. The stateless handler needs no routing between requests. Keep application data and long-running job state outside Lambda.

## Add a custom domain

Function URLs use AWS-assigned domains. For your own hostname, put a front door such as CloudFront in front of the function URL, or use an [API Gateway custom domain](https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-custom-domains.html) with a streaming integration. Either way:

- forward `POST` and `OPTIONS`, the `Authorization` header and the MCP headers;
- turn off response caching and keep the response streaming;
- make sure the `Host` that reaches the app matches its allowlist. The viewer's hostname and the origin's `Host` can differ, so configure that deliberately instead of turning off validation.

## CORS and the public URL

`PUBLIC_URL` must be the exact production endpoint, including `/mcp`. The app:

- rejects a `Host` other than the `PUBLIC_URL` hostname with `403`;
- rejects an `Origin` that is not on its allowlist with `403`, and lets requests without an `Origin` through;
- answers the `OPTIONS` preflight itself, before the MCP handler, for `https://mcptest.io`;
- allows the MCP request headers, and exposes `WWW-Authenticate`, `MCP-Protocol-Version`, `Mcp-Session-Id` and `Retry-After`.

To allow another browser app, add its exact origin to the `origins` array in `app.mjs`. The SDK's `Origin` check compares hostnames, and the CORS headers echo only exact origins on the list. CORS is not authentication: non-browser clients can omit `Origin`, so protect private tools separately. The [CORS reference](/learn/mcp-cors-headers-for-browser-clients) explains each header.

Do not also configure CORS on the function URL while the app sets its own CORS headers. Two policies can produce duplicate `Access-Control-Allow-Origin` values, which browsers reject.

A new domain is also a new resource URL if you add OAuth later. Change `PUBLIC_URL`, the protected resource metadata, and the identity provider's resource or audience setting together.

## Common failures

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `403` with `Invalid Host: …` | `PublicUrl` is still the placeholder, or names another hostname | Deploy again with `PublicUrl` set to the exact endpoint. See [Invalid Host header](/learn/mcp-error-invalid-host-header). |
| `403` with `Forbidden` from AWS, before the app runs | A missing invoke permission, or `AuthType: AWS_IAM` | Keep both permissions from the template and `AuthType: NONE`. |
| Progress arrives only with the final result | The function URL is in `BUFFERED` mode, or a proxy in front buffers | Use `InvokeMode: RESPONSE_STREAM` and a streaming front door. See [SSE stream disconnected](/learn/mcp-error-sse-stream-disconnected). |
| A long call stops before its result | The function timeout was reached | Raise `Timeout` up to 900 seconds, or shorten the work. See [Request timed out](/learn/mcp-error-request-timed-out). |
| The browser reports a network error; `curl` works | The browser's origin is not in `origins`, a header is missing from the preflight, or the function URL adds a second CORS policy | Add the origin, check the preflight, and remove function URL CORS. See the [CORS reference](/learn/mcp-cors-headers-for-browser-clients). |
| `GET /mcp` returns `405` | Expected: the server offers no GET stream | Nothing to fix. See [406, 415 and 405](/learn/mcp-406-not-acceptable-415-and-405). |
