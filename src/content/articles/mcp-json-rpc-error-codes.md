---
title: MCP error codes
navTitle: Error codes
summary: JSON-RPC 2.0 reserved codes, MCP-defined codes from -32002 to -32042, the HTTP status each maps to on Streamable HTTP, and isError tool results versus protocol errors.
track: reference
level: practitioner
order: 22
category: Protocol reference
readingTimeMinutes: 7
lastReviewed: "2026-10-20"
metaTitle: MCP error codes and JSON-RPC errors reference | mcptest.io
metaDescription: MCP error codes explained, including -32602, -32601, -32002, -32020, -32021, -32022 and -32042, with HTTP status mapping and isError versus protocol errors.
relatedSlugs:
  - mcp-http-headers-reference
  - mcp-protocol-versions-explained
  - mcp-transport-diagnostics-reference
  - troubleshooting
sourceLinks:
  - title: JSON-RPC 2.0 specification
    url: "https://www.jsonrpc.org/specification"
  - title: "MCP 2026-07-28: Overview (error codes)"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/index"
  - title: "MCP 2026-07-28: Streamable HTTP"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
  - title: "MCP 2026-07-28: Tools (error handling)"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/server/tools"
  - title: "MCP 2026-07-28: Resources"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/server/resources"
  - title: "MCP 2025-11-25: Resources"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/server/resources"
  - title: "MCP 2025-11-25: Elicitation"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation"
  - title: "MCP 2025-11-25: Lifecycle"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle"
  - title: MCP 2026-07-28 changelog
    url: "https://modelcontextprotocol.io/specification/2026-07-28/changelog"
  - title: MCP debugging guide
    url: "https://modelcontextprotocol.io/docs/2026-07-28/tools/debugging"
  - title: "TypeScript SDK: Server errors guide"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/errors.md"
  - title: "TypeScript SDK: Streamable HTTP server transport"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/streamableHttp.ts"
---

MCP errors arrive at two layers: the HTTP status of the transport response and the JSON-RPC `error` object in its body. A tool can also succeed at both layers and still report failure with `isError: true`. Read all three before deciding what broke.

## Error object

JSON-RPC 2.0 defines the shape:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32602,
    "message": "Unknown tool: invalid_tool_name",
    "data": { "optional": "server-defined detail" }
  }
}
```

- `code` MUST be an integer.
- `message` SHOULD be one concise sentence.
- `data` is optional and server-defined.
- `id` echoes the request. When the request ID could not be read (parse error, invalid request), it MUST be `null`.

## Code ranges

| Range | Owner |
| --- | --- |
| `-32768` to `-32000` | Reserved by JSON-RPC 2.0 |
| `-32700`, `-32600` to `-32603` | JSON-RPC predefined errors |
| `-32000` to `-32019` | Legacy range in MCP 2026-07-28. No new allocations; receivers MUST NOT assume a meaning, except `-32002` |
| `-32020` to `-32099` | Reserved for the MCP specification |
| Outside `-32768` to `-32000` | Application-defined codes SHOULD go here |

The 2026-07-28 changelog describes `-32000` to `-32019` as implementation-defined, with existing SDK usage grandfathered. The [overview](https://modelcontextprotocol.io/specification/2026-07-28/basic/index) labels the same range legacy.

## JSON-RPC 2.0 codes

### -32700 Parse error

Invalid JSON was received. On Streamable HTTP the TypeScript SDK server answers HTTP `400` with "Parse error: Invalid JSON". Check the body encoding and anything that rewrites bodies in transit.

### -32600 Invalid Request

The JSON is not a valid request object. In the TypeScript SDK this also covers a second `initialize` on a session, and on a 2026-07-28 endpoint a POSTed JSON-RPC response, which 2026 clients MUST NOT send. The SDK answers HTTP `400`. JSON-RPC batching was removed in 2025-06-18, so a batch array is also suspect.

### -32601 Method not found

The method does not exist or no handler is installed. In 2026-07-28 Streamable HTTP, the server MUST answer HTTP `404` with this code. A common cause is a server that advertises a capability (tools, resources, prompts) without implementing its list method.

### -32602 Invalid params

The most overloaded code in MCP:

- Unknown tool name (the spec's own example).
- Params that fail the method's schema.
- Resource not found in 2026-07-28 (see `-32002` below).
- A missing required `_meta` field in 2026-07-28, with HTTP `400`. The [debugging guide](https://modelcontextprotocol.io/docs/2026-07-28/tools/debugging) notes this is "the same code returned for many other malformed inputs".
- Unsupported protocol version during 2025 `initialize`: the lifecycle example returns `-32602` with `data.supported` and `data.requested`.

Tool argument validation failures that a model can correct should be returned as tool results with `isError: true`, not `-32602` (2025-11-25 and later).

### -32603 Internal error

An unexpected server failure. Resource pages say servers SHOULD use it for internal errors. In the TypeScript SDK, handler errors stay inside an HTTP `200` response; `-32603` never becomes a blanket HTTP `500`.

## MCP-defined codes

### -32002 Resource not found

- **2025-11-25 and earlier:** servers SHOULD return `-32002` for an unknown resource URI; the example puts the URI in `data.uri`.
- **2026-07-28:** servers MUST return `-32602` instead, and clients SHOULD still accept `-32002`. A server MUST NOT return an empty `contents` array for a resource that does not exist.
- **TypeScript SDK 2.x:** never emits `-32002`. A handler that throws it is re-encoded as `-32602` with `data: { uri }`, and a received `-32002` or `-32602` with only `data.uri` is recognized as `ResourceNotFoundError`.

```json
{"jsonrpc":"2.0","id":5,"error":{"code":-32602,"message":"Resource not found","data":{"uri":"file:///missing.txt"}}}
```

### -32020 HeaderMismatch

2026-07-28. An HTTP header disagrees with the body or a required header is missing: `MCP-Protocol-Version` versus `_meta`, `Mcp-Method` versus `method`, `Mcp-Name` versus `params.name` or `params.uri`, or an `Mcp-Param-*` value versus the tool argument. HTTP `400`. After a mismatch on a custom parameter header, the client SHOULD refresh `tools/list` and retry. Earlier drafts numbered it `-32001`. See the [HTTP headers reference](/learn/mcp-http-headers-reference).

### -32021 MissingRequiredClientCapability

2026-07-28. Serving the request needs a client capability that the request's `io.modelcontextprotocol/clientCapabilities` did not declare. `data.requiredCapabilities` lists what is missing, in `ClientCapabilities` shape. HTTP `400`. Earlier drafts numbered it `-32003`.

```json
{"jsonrpc":"2.0","id":9,"error":{"code":-32021,"message":"Missing required client capabilities: elicitation","data":{"requiredCapabilities":{"elicitation":{}}}}}
```

### -32022 UnsupportedProtocolVersion

2026-07-28. The request's protocol version is unknown to the server. `data.supported` lists the server's versions and `data.requested` echoes the client's. HTTP `400`. The client SHOULD pick a mutual version and retry. Earlier drafts numbered it `-32004`.

```json
{"jsonrpc":"2.0","id":1,"error":{"code":-32022,"message":"Unsupported protocol version","data":{"supported":["2026-07-28","2025-11-25"],"requested":"1900-01-01"}}}
```

mcptest relies on this code during negotiation. A `-32022` that names a mutual 2026 version triggers one corrective retry. One without a mutual 2026 version falls back to `initialize`. See [MCP protocol versions explained](/learn/mcp-protocol-versions-explained).

### -32042 URLElicitationRequired

2025-11-25 only. A server MAY return it when an operation needs URL-mode elicitation; `data.elicitations` lists the elicitations, each with an `elicitationId`. Retired in 2026-07-28, where multi round-trip results (`resultType: "input_required"`) replace it.

## SDK-conventional codes

These are in the legacy range and are not defined by the specification. Read the HTTP status and message, not the code alone.

| Code | HTTP | TypeScript SDK server message |
| --- | --- | --- |
| `-32000` | `400` | "Bad Request: Mcp-Session-Id header is required" |
| `-32000` | `400` | "Bad Request: Server not initialized" |
| `-32000` | `405` | "Method not allowed." |
| `-32000` | `406` | "Not Acceptable: Client must accept both application/json and text/event-stream" |
| `-32000` | `409` | "Conflict: Only one SSE stream is allowed per session" |
| `-32000` | `415` | "Unsupported Media Type: Content-Type must be application/json" |
| `-32001` | `404` | "Session not found" |

The client SDK deliberately does not treat `-32001` as evidence of a protocol era, because deployed 2025 servers use it for expired sessions.

## HTTP status mapping

| HTTP status | Meaning on Streamable HTTP |
| --- | --- |
| `200` | JSON or SSE response; JSON-RPC errors produced by request handlers travel here |
| `202` | Accepted notification or client response; no body |
| `400` | `-32700`, `-32600`; missing session ID (2025); invalid `MCP-Protocol-Version`; in 2026, `-32020`, `-32021`, `-32022`, and `-32602` for missing `_meta` |
| `401` | Missing, invalid or expired token; read `WWW-Authenticate` |
| `403` | Invalid `Origin` (2025-11-25 and later), insufficient scope, or policy denial |
| `404` | Expired or unknown session (2025); `-32601` unknown method (2026); or wrong URL |
| `405` | GET or DELETE not offered |
| `406` | `Accept` rejected |
| `415` | Request `Content-Type` rejected |
| `429` | Rate limited; read `Retry-After` |

The status rows for `-32601`, `-32020`, `-32021`, `-32022` and the `_meta` `-32602` come from the 2026-07-28 specification. The rule that handler-produced errors stay in an HTTP `200` is the TypeScript SDK's mapping (`LADDER_ERROR_HTTP_STATUS` in `@modelcontextprotocol/client`). For transport statuses, see the [transport diagnostics reference](/learn/mcp-transport-diagnostics-reference).

## isError versus protocol errors

| | Protocol error | Tool execution error |
| --- | --- | --- |
| Shape | JSON-RPC `error` object | `result` with `isError: true` |
| Used for | Unknown tool, request that fails the `CallToolRequest` schema, server errors | API failures, input validation (wrong date format, value out of range), business-logic errors |
| Sent to the model | Clients MAY | Clients SHOULD, so the model can self-correct |

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "resultType": "complete",
    "content": [{ "type": "text", "text": "Invalid departure date: must be in the future." }],
    "isError": true
  }
}
```

Since 2025-11-25, input validation errors belong in `isError` results. What a thrown exception becomes depends on the SDK. The TypeScript SDK catches anything a tool handler throws and returns it as an `isError: true` result with the message as text. Resource and prompt handlers have no `isError` channel and throw `ProtocolError` instead.

Neither the TypeScript SDK nor mcptest checks an `isError: true` result against the tool's `outputSchema` (`checkToolOutputContract` in `src/utils/outputContract.ts` returns `not-checked`).

## Reading errors in the playground

- **Tool result with `isError: true`:** shown as a normal tool result with the notice "The tool reported an error (isError: true)." The Content view shows the text; the JSON-RPC view shows the full `result`.
- **Protocol error from a handler:** the log gets an error entry, `Failed to execute tool <name>: <message>`, with the server's `message`. The numeric `code` and `data` are not in that line; read them from the response body in the browser's network panel.
- **Transport-level rejection:** the SDK reports the HTTP body as `Error POSTing to endpoint: <body>`, so the JSON-RPC `code` and `message` are visible in the log line. In 2026, a `400` whose body is a JSON-RPC error for the same request ID is passed through as a protocol error.
- **Connection failures:** the connection error card shows the classified failure, any [transport diagnostic](/learn/mcp-transport-diagnostics-reference) and "Raw technical details". For more triage steps, see [troubleshooting](/docs/troubleshooting).

## Try it

Open [DeepWiki in the playground](/server/https://mcp.deepwiki.com/mcp/mcp), a public 2025-11-25 catalog server. Call a tool with a deliberately wrong argument to see whether the server returns a protocol error or an `isError` result.
