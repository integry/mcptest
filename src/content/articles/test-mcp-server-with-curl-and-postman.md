---
title: "How to test an MCP server with curl and Postman"
navTitle: Testing with curl and Postman
summary: "Send raw JSON-RPC to a Streamable HTTP MCP server with curl, for stateless 2026 and stateful 2025 servers: headers, sessions, tools/list, tools/call, SSE responses and bearer auth, then the same checks in Postman's MCP request type."
track: build
level: practitioner
order: 409
category: Testing
readingTimeMinutes: 9
lastReviewed: "2026-11-11"
metaTitle: "Test an MCP server with curl and Postman: JSON-RPC, sessions, SSE | mcptest.io"
metaDescription: "Test an MCP server with curl: server/discover, initialize, session and protocol headers, tools/list, tools/call, SSE responses and bearer auth. Plus Postman MCP requests and common 406, 415 and 404 mistakes."
relatedSlugs:
  - testing-guide
  - mcp-http-headers-reference
  - mcp-406-not-acceptable-415-and-405
  - mcp-session-not-found-after-deploy
  - mcp-inspector-alternatives
  - mcp-json-rpc-error-codes
sourceLinks:
  - title: "MCP 2026-07-28 Streamable HTTP transport"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
  - title: "MCP 2025-11-25 transports"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports"
  - title: "MCP 2026-07-28 authorization"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
  - title: "Postman: MCP requests overview"
    url: "https://learning.postman.com/docs/use/send-requests/protocols/mcp-requests/overview/"
  - title: "Postman: Create an MCP request"
    url: "https://learning.postman.com/docs/use/send-requests/protocols/mcp-requests/create/"
  - title: "Postman: Debug OAuth 2.1 authentication"
    url: "https://learning.postman.com/docs/use/send-requests/protocols/mcp-requests/oauth-debugger/"
  - title: "Postman CLI: Run a collection"
    url: "https://learning.postman.com/docs/postman-cli/postman-cli-run-collection/"
  - title: "curl manual"
    url: "https://curl.se/docs/manpage.html"
---

A remote MCP server is an HTTP endpoint that accepts JSON-RPC in `POST` requests, so you can test it with nothing more than `curl`. That is the quickest way to see what a server really answers: the status code, every response header and the raw body, with no client library deciding what to retry or hide. This guide shows the exact requests for both protocol eras, how to read streamed responses, how to send credentials, and how to do the same checks in Postman. Every command was run on November 11, 2026, against the servers named below and against local TypeScript and Python SDK servers.

## Before you start: which era does the server speak?

Two kinds of Streamable HTTP server are in use:

- **Stateless 2026-07-28.** There is no handshake and no session. Each request carries its version in an `MCP-Protocol-Version` header and in `params._meta`, plus an `Mcp-Method` header naming the method. `server/discover` is the optional probe.
- **Stateful 2025.** The client sends `initialize`, then `notifications/initialized`, and repeats the negotiated version in `MCP-Protocol-Version` afterwards. The server may issue an `Mcp-Session-Id` that every later request must carry.

Send `server/discover` first. A 2026 server answers it; a 2025-only server rejects it, and you continue with `initialize`. The [protocol versions guide](/learn/mcp-protocol-versions-explained) explains the differences, and the [HTTP headers reference](/learn/mcp-http-headers-reference) describes each header.

Every `POST` needs two headers, whatever the era:

- `Content-Type: application/json`
- `Accept: application/json, text/event-stream`

Add `-i` to every `curl` command while you test. The headers are half of the answer.

## Stateless 2026 servers with curl

The examples use [Context7](/server/mcp.context7.com/mcp/mcp), a public server that needs no sign-in and served 2026-07-28 on the review date. Substitute your own URL.

```bash
curl -i https://mcp.context7.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: server/discover" \
  -d '{
    "jsonrpc": "2.0",
    "id": "discover-1",
    "method": "server/discover",
    "params": {
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { "name": "curl-check", "version": "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }'
```

The result lists `supportedVersions` and `capabilities`. Nothing needs to be kept for the next request. List the tools:

```bash
curl -i https://mcp.context7.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: tools/list" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
```

To call a tool, add `Mcp-Name` with the same value as `params.name`:

```bash
curl -i https://mcp.context7.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: tools/call" \
  -H "Mcp-Name: resolve-library-id" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"resolve-library-id","arguments":{"libraryName":"Express","query":"routing"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
```

Leave out `Mcp-Method`, or let it disagree with the body, and a 2026 server should answer `400` with JSON-RPC error `-32020`. A local TypeScript SDK server returned exactly that, with a message naming the missing header. That is a useful negative test for your own server.

## Stateful 2025 servers with curl

A 2025 server starts with `initialize`. This example saves the response headers and body, then reads the session ID and the negotiated version into shell variables. On a server that issues no session ID, `SESSION_ID` stays empty:

```bash
URL=https://your-server.example.com/mcp

curl -s -D init-headers.txt -o init-body.txt "$URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl-check","version":"1.0.0"}}}'

SESSION_ID=$(awk 'tolower($1) == "mcp-session-id:" { print $2 }' init-headers.txt | tr -d '\r')
PROTOCOL_VERSION=$( (grep -q '^data: ' init-body.txt && sed -n 's/^data: //p' init-body.txt || cat init-body.txt) \
  | jq -r 'select(.id == 1) | .result.protocolVersion // empty')
echo "session: ${SESSION_ID:-none}, version: ${PROTOCOL_VERSION:-none}"
```

The client proposes `2025-11-25`, but the server may answer with an older version it supports, such as `2025-03-26`. Later requests must send the version the server returned, so they use `$PROTOCOL_VERSION` rather than a fixed string. If it prints `none`, read `init-body.txt`: the server returned an error instead of a result. Check `capabilities` there too. Then finish the handshake and make requests, carrying the version and the session:

```bash
curl -i "$URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: $PROTOCOL_VERSION" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

curl -i "$URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: $PROTOCOL_VERSION" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

curl -i "$URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: $PROTOCOL_VERSION" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"text":"hello"}}}'
```

The notification gets `202 Accepted` with an empty body. If the server issued no session ID, delete the `Mcp-Session-Id` lines entirely; do not send an empty value. [DeepWiki](/server/https://mcp.deepwiki.com/mcp/mcp) is a public 2025-11-25 server without sessions if you want to try the flow on a real endpoint.

To end a session, send `DELETE` with the session header. On the Python SDK's stateful server it returned `200`, and the next request with the same ID got `404`.

## Reading SSE responses

A server may answer any `POST` with `Content-Type: text/event-stream` instead of JSON. DeepWiki does this for every request. The body then looks like this:

```text
event: message
data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25","capabilities":{...}}}
```

Progress notifications or server requests may arrive as earlier `data:` lines before the final response with your `id`. Add `-N` so `curl` prints events as they arrive, and strip the prefix to pipe the JSON into `jq`:

```bash
curl -sN "$URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: $PROTOCOL_VERSION" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | sed -n 's/^data: //p' | jq '.result.tools[].name'
```

Context7 answered the same requests with plain `application/json`. Both are valid, so a client and your scripts must handle both.

## Bearer tokens and OAuth

Send a credential in the `Authorization` header, never in the URL:

```bash
curl -i "$URL" \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl-check","version":"1.0.0"}}}'
```

Then repeat without the header and with a wrong token. Each should get `401`, not a `200` with an empty tool list. For an OAuth server, the `401` should carry `WWW-Authenticate` with a `resource_metadata` URL; `curl` that URL to read the protected-resource metadata. `curl` cannot complete the browser login, so get a real token from your identity provider or a tool that runs the flow, such as Postman's OAuth debugger or the [mcptest.io OAuth checker](/tools/oauth-check). [401 Unauthorized](/learn/remote-mcp-server-401-unauthorized) covers the failures.

## Testing in Postman

Postman has a dedicated MCP request type, separate from its HTTP requests. In a workspace, select **MCP** in the left sidebar, choose **HTTP** (Streamable HTTP) or **STDIO**, enter the URL or command, and select **Load Capabilities**. Postman negotiates the protocol version for you and shows the result in its console; a **Legacy** option forces the older protocol when you want to confirm a server still serves older clients.

The **Tools**, **Prompts** and **Resources** tabs list what the server offers. Pick a tool, fill in its arguments, and Postman builds the JSON message; select **Run** to see the result in **Response** and server notifications in **Notifications**. Credentials go in the **Authorization** tab for HTTP servers and in **Environment** for stdio servers. If OAuth fails, the OAuth Debugger steps through each phase of the OAuth 2.1 flow and shows where it stops.

Two limits are worth knowing. The Postman MCP request handles the handshake, sessions and headers itself, so it cannot show you a missing `Accept` header or a bad session the way raw `curl` can; use an ordinary HTTP request with the bodies above for those. And the Postman CLI skips MCP requests when it runs a collection, so MCP requests are not a CI path.

## Common mistakes and what they look like

| Mistake | Typical response | Fix |
| --- | --- | --- |
| `Accept` lists only one of `application/json` and `text/event-stream` | `406 Not Acceptable` | Send both. See [406, 415 and 405 errors](/learn/mcp-406-not-acceptable-415-and-405). |
| `Content-Type` is not `application/json` (`curl -d` defaults to form encoding without `-H`) | `415 Unsupported Media Type`, or `400 Invalid Content-Type header` from the Python SDK | Add `-H "Content-Type: application/json"`. |
| 2025 request without `Mcp-Session-Id` on a stateful server | `400` "Missing session ID" | Capture the header from `initialize` and send it. |
| Unknown or expired session ID | `404` "Session not found" | Start again with `initialize`. See [session not found after deploy](/learn/mcp-session-not-found-after-deploy). |
| 2026 request without `Mcp-Method`, or `Mcp-Name` missing on `tools/call` | `400` with `-32020` | Match the headers to the body. |
| Token in a query string | `401`, and a token in your logs | Use the `Authorization` header. |

One trap with no error at all: `curl` sends `Accept: */*` when you set no `Accept` header. A Python SDK server accepted that and a TypeScript SDK server answered a 2025 request with `406`, so "works with curl" may not mean what you think. Always send the full header. JSON-RPC codes in the bodies are listed in the [error codes reference](/learn/mcp-json-rpc-error-codes).

## When a browser tester or a CLI is quicker

Raw `curl` is right for one exact request or a byte-for-byte bug reproduction. For anything broader it is slow: you write JSON by hand, track sessions yourself and cannot run an OAuth login.

- **To explore a remote server**, paste its URL into [mcptest.io](/). It negotiates either era, runs OAuth, lists and calls every capability, checks output schemas and shows whether a browser could reach the server, which `curl` never tests.
- **For a local stdio server**, use the MCP Inspector or Postman; `curl` cannot reach stdio at all.
- **For scripts and CI**, the Inspector CLI (`npx @modelcontextprotocol/inspector --cli <url> --method tools/list`) prints JSON with stable exit codes, and the mcptest headless CLI and GitHub Action make a release decision. [Test a remote MCP server in CI](/learn/test-remote-mcp-server-in-ci) has the setup.

[MCP Inspector alternatives](/learn/mcp-inspector-alternatives) compares the interactive options, and the [testing guide](/docs/testing-guide) puts all of this in order.

## FAQ

### Why does my MCP server return 406 to curl?

The `Accept` header is missing or lists only one type. Send `Accept: application/json, text/event-stream` on every `POST`. Without the header, `curl` sends `*/*`, which some SDKs reject for 2025 requests.

### Do I need to send `initialize` before every request?

Only to a 2025 server, and only once per session: send `initialize`, then `notifications/initialized`, then reuse the session ID and the version the server returned in `initialize`. A 2026 server has no handshake; every request carries its version and method headers on its own.

### How do I read an SSE response from curl?

Add `-N` and read the `data:` lines; each holds one JSON-RPC message. Pipe through `sed -n 's/^data: //p'` to get plain JSON. The message with your request `id` is the response.

### Can Postman test a local stdio MCP server?

Yes. Choose **STDIO** in the MCP request and enter the command that starts the server. Postman may ask for permission to run it on your computer.

### How do I test an OAuth-protected MCP server with curl?

Check the unauthenticated `401` and its `WWW-Authenticate` header with `curl`, then fetch the `resource_metadata` URL. For the login itself, get a token from a tool that runs the flow and send it as `Authorization: Bearer <token>`.
