---
title: "Streamable HTTP error: Error POSTing to endpoint"
navTitle: "HTTP POST rejected"
summary: "Decode the HTTP status and response behind a Streamable HTTP POST error to distinguish routing, authentication, media types and gateway failures."
track: "build"
level: "practitioner"
order: 452
category: "Transports"
readingTimeMinutes: 5
lastReviewed: "2026-10-26"
metaTitle: "Streamable HTTP error: Error POSTing to endpoint | mcptest.io"
metaDescription: "Decode the HTTP status and response behind a Streamable HTTP POST error to distinguish routing, authentication, media types and gateway failures."
relatedSlugs:
  - troubleshooting
  - remote-mcp-server-401-unauthorized
  - mcp-error-sse-non-200-404
  - mcp-406-not-acceptable-415-and-405
  - mcp-error-request-timed-out
sourceLinks:
  - title: "Claude Code wrong endpoint HTML #79951"
    url: "https://github.com/anthropics/claude-code/issues/79951"
  - title: "Claude Code HTTP preflight headers #82534"
    url: "https://github.com/anthropics/claude-code/issues/82534"
  - title: "Claude Code gateway timeout report #44415"
    url: "https://github.com/anthropics/claude-code/issues/44415"
  - title: "MCP HTTP transport rules"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports"
---

## Streamable HTTP error: Error POSTing to endpoint

```text
Streamable HTTP error: Error POSTing to endpoint
```

The actual output appends a response body or status explanation. **Claude Code** reports this prefix with HTML in [#79951](https://github.com/anthropics/claude-code/issues/79951), an unauthorized response in [#82534](https://github.com/anthropics/claude-code/issues/82534), and a gateway timeout in [#44415](https://github.com/anthropics/claude-code/issues/44415), all reported in 2026. It is a wrapper around an HTTP failure, not a diagnosis or a JSON-RPC error code.

## Likely causes, ranked for investigation

1. **Wrong route or authorization at the HTTP boundary.** The HTML and preflight reports show different failures before a usable MCP reply. Capture the status and content type: HTML suggests a website, gateway or policy page; 401 requires checking the actual request credentials and challenge.
2. **Gateway failure.** The timeout report contains `Gateway Timeout`, but does not establish which hop generated it. Compare public-ingress and origin logs at the same timestamp before changing client deadlines.
3. **Protocol or header rejection.** A 400, 405, 406 or 415 needs the request method, protocol metadata and body. This is a specification-based diagnostic branch, not proof of a particular cause in the reports above.

The ranking is qualitative; the prefix alone cannot establish which cause is most frequent for your server.

## Fix for client users

Keep the full error suffix, status and request URL. Check the publisher's endpoint rather than guessing a website's API path. For authenticated requests, compare a direct test with the failing host, including whether the failed request actually carried the configured header. #82534 reports a preflight omitting credentials in a particular version; do not assume your token is invalid based only on the summary.

Follow [401 troubleshooting](/learn/remote-mcp-server-401-unauthorized) for authorization, the [406/415/405 guide](/learn/mcp-406-not-acceptable-415-and-405) for negotiation, and [session recovery](/learn/mcp-session-not-found-after-deploy) when a 404 body identifies an expired session. Redact headers and tokens before sharing evidence. Stop repeated retries of a tool with side effects until its execution outcome is known.

## Fix for server authors

Log a safe request correlation id at the ingress and MCP handler. Return the real error status and preserve useful challenge and retry headers. A proxy must not rewrite failures into 200 HTML responses. Under the [2025 HTTP transport rules](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), accept POST JSON with both JSON and SSE response types advertised:

```http
Content-Type: application/json
Accept: application/json, text/event-stream
```

Delegate parsing and protocol responses to the SDK. If only your public route fails, compare ingress body limits, method rules and timeout settings with direct-origin behavior. A TypeScript/Python handler change is relevant only after the request reaches it; fix incorrect gateway routing or authorization first. If the HTTP response succeeds but replies never complete, continue with [request timeouts](/learn/mcp-error-request-timed-out).

## Check with mcptest

Use **Test your server** and inspect each failed POST. Depending on the observed status, the inspector reports [transport.accept-header-406](/learn/mcp-transport-diagnostics-reference#transport-accept-header-406), [transport.unsupported-media-type-415](/learn/mcp-transport-diagnostics-reference#transport-unsupported-media-type-415), or [transport.target-rate-limited-429](/learn/mcp-transport-diagnostics-reference#transport-target-rate-limited-429). There is no single finding for this whole wrapper string. A successful response with a wrong media type can instead trigger [transport.sse-content-type-mismatch](/learn/mcp-transport-diagnostics-reference#transport-sse-content-type-mismatch). Compare with [SSE fallback 404s](/learn/mcp-error-sse-non-200-404) if a later attempt masks the original error.
