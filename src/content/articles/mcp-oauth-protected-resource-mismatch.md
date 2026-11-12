---
title: "MCP OAuth protected resource does not match expected: cause and fix"
navTitle: OAuth resource mismatch
summary: Diagnose an OAuth resource identity mismatch, compare the endpoint path with protected-resource metadata, and decide whether the client configuration or server must change.
track: build
level: practitioner
order: 446
category: Authorization
readingTimeMinutes: 5
lastReviewed: "2026-10-25"
metaTitle: "MCP OAuth Protected Resource Mismatch: Fix | mcptest.io"
metaDescription: "Fix SDK auth failed: protected resource does not match expected. Compare the MCP endpoint, RFC 9728 metadata resource and OAuth resource indicator."
relatedSlugs:
  - troubleshooting
  - vscode-mcp-oauth-redirect-uris
  - remote-mcp-server-401-unauthorized
  - mcp-oauth-2-1-reference
sourceLinks:
  - title: "RFC 9728: protected resource metadata validation"
    url: "https://www.rfc-editor.org/rfc/rfc9728.html#section-3.3"
  - title: "RFC 8707: resource indicators"
    url: "https://www.rfc-editor.org/rfc/rfc8707.html"
  - title: "MCP authorization: canonical server URI"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#canonical-server-uri"
---

## sdk auth failed: protected resource https://mcp.linear.app/mcp does not match expected https://mcp.linear.app

```text
sdk auth failed: protected resource https://mcp.linear.app/mcp does not match expected https://mcp.linear.app
```

The client expected the origin, but the metadata identifies a resource with the `/mcp` path. This output is evidence of two different identifiers, not proof that Linear's current endpoint is broken. Copying only the host from a setup guide can produce this mismatch.

## Why authentication stops before login

The MCP endpoint is the URL your client calls. A protected-resource metadata document describes that resource; its `resource` field is an identifier, not the metadata document's own URL. Under [RFC 9728 validation](https://www.rfc-editor.org/rfc/rfc9728.html#section-3.3), the returned resource must match the identifier used to derive the metadata request. Clients reject a mismatch to avoid accepting metadata for another resource.

An origin, `/mcp` and `/mcp/` can identify different resources. A redirect or an application serving all three does not make their resource identifiers interchangeable. Do not fix this by disabling validation or blindly stripping paths.

## Fix for client users

1. Get the full endpoint from the publisher's official documentation. If it specifies `https://mcp.linear.app/mcp`, configure that complete URL rather than `https://mcp.linear.app`.
2. Remove the stale connection or clear its cached discovery through your client's supported controls, reconnect, and inspect the new request.
3. If the published URL still produces different resource identities, report the endpoint and metadata `resource` value to the server author. Redact tokens and authorization codes.

## Fix for server authors

Choose a canonical public MCP URI and align the documented endpoint, protected-resource metadata and authorization server configuration with it. For an example server whose canonical URI is `https://mcp.example.com/mcp`, metadata would identify:

```json
{
  "resource": "https://mcp.example.com/mcp",
  "authorization_servers": ["https://auth.example.com"]
}
```

Serve path-aware discovery, such as `/.well-known/oauth-protected-resource/mcp`, and point the `401` challenge's `resource_metadata` parameter at the correct document. Check reverse-proxy rewrites: internal application URLs must not leak into public metadata.

The [MCP canonical URI rules](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#canonical-server-uri) and [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html) govern the `resource` parameter in authorization and token requests. Send the intended resource consistently and issue a token with the appropriate audience; the resource server must validate that audience. An API's OAuth issuer URL is not automatically its resource identifier.

Change the client when it uses an incomplete or obsolete URL; change the server when the documented canonical URL receives inconsistent metadata. If both are correct, investigate the client's metadata derivation and cache rather than weakening the identity check.

## Check the fix

Run the full endpoint through the [discovery checker](/tools/discovery). Its **OAuth metadata** result warns when `resource` does not identify the tested endpoint. Then [connect in the inspector](/) and inspect OAuth discovery and a fresh tools listing. A successful metadata check alone does not prove a token exchange or audience check will succeed. If the browser opens but connection still fails, continue with [OAuth redirect troubleshooting](/learn/vscode-mcp-oauth-redirect-uris).
