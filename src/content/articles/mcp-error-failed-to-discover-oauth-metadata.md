---
title: "Failed to discover OAuth metadata: MCP fixes"
navTitle: "OAuth metadata discovery"
summary: "Trace failed MCP OAuth discovery from the challenge to issuer metadata, separating refresh failures, wrong paths and browser CORS."
track: "build"
level: "practitioner"
order: 448
category: "Authorization"
readingTimeMinutes: 5
lastReviewed: "2026-10-26"
metaTitle: "Failed to discover OAuth metadata: MCP fixes | mcptest.io"
metaDescription: "Trace failed MCP OAuth discovery from the challenge to issuer metadata, separating refresh failures, wrong paths and browser CORS."
relatedSlugs:
  - troubleshooting
  - mcp-error-dynamic-client-registration
  - mcp-oauth-protected-resource-mismatch
  - remote-mcp-server-401-unauthorized
sourceLinks:
  - title: "Claude Code token refresh report #19454"
    url: "https://github.com/anthropics/claude-code/issues/19454"
  - title: "Cline discovery failures #14625"
    url: "https://github.com/cline/cline/issues/14625"
  - title: "MCP authorization discovery"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization"
---

## Failed to discover OAuth metadata

```text
Failed to discover OAuth metadata
```

**Where it appears:** [Claude Code #19454](https://github.com/anthropics/claude-code/issues/19454), filed January 20, 2026, names this error during Atlassian token refresh. It does not establish a failure in every current release. Discovery can fail before login or during renewed authorization; a previously successful connection does not prove today's discovery URL is reachable.

## Likely causes, ranked by the report evidence

1. **Unusable discovery URL or response.** [Cline #14625](https://github.com/cline/cline/issues/14625) records authorization metadata returning 404. Check the status, content type and body at each requested URL; HTML from a login gateway is not metadata JSON.
2. **Refresh or cached issuer configuration.** The Claude Code report puts refresh first in its reproduction. Compare a fresh authorization with the failing stored connection. Success only after reconnecting suggests saved configuration or refresh state; it does not prove the server is fixed.
3. **The document exists but cannot be read or validated.** The [authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) requires discovery and issuer validation. Compare the advertised issuer with the JSON `issuer`; for a browser, inspect CORS and whether the challenge header is exposed.

These are qualitative priorities from the linked reports, not measured prevalence across all clients.

## Fix for client users

Use the publisher's full remote endpoint. Capture the failing metadata request's URL, status and redacted response. Reconnect through the client's supported authentication controls and compare the new exchange with the old one. If a fresh login works but refresh fails later, include that distinction in the bug report. Repeating login cannot repair a metadata URL that returns 404.

Do not substitute a random issuer, disable issuer checks or share credentials. If metadata loads and the next error mentions registration, follow [dynamic client registration](/learn/mcp-error-dynamic-client-registration). If the JSON resource differs from the endpoint, use the [resource mismatch guide](/learn/mcp-oauth-protected-resource-mismatch).

## Fix for server authors

Publish protected-resource metadata for the public endpoint and point its `authorization_servers` to the actual issuer. Return a challenge such as this on an unauthenticated request:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"
```

Follow the specification's path-aware discovery rules for issuers mounted below the origin. Ensure well-known routes reach the metadata handler through the public proxy and return JSON without a browser login or cookie. Verify both initial authorization and refresh against the same intended resource. This is identity-provider and routing configuration; changing a TypeScript or Python tool handler will not repair it.

## Check with mcptest

Enter the full endpoint in **Test your server**, then inspect the OAuth discovery requests. The [OAuth pre-login troubleshooting reference](/learn/mcp-oauth-2-1-reference#pre-login-troubleshooting) covers missing discovery and issuer mismatches. There is no transport diagnostic id specifically for this string. A browser-only failure may also expose [missing CORS headers](/learn/mcp-transport-diagnostics-reference#transport-cors-expose-headers-missing); that finding alone does not establish an issuer problem. Verify refresh separately after a successful login.
