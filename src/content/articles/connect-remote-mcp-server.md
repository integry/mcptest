---
title: How to connect to a remote MCP server
summary: A client-oriented walkthrough for testing an authless or OAuth-protected Streamable HTTP endpoint and diagnosing the first connection.
track: use
level: newcomer
order: 1
category: Getting started
readingTimeMinutes: 8
lastReviewed: 2026-08-17
relatedSlugs:
  - oauth-for-mcp-explained
  - mcp-clients-compared
sourceLinks:
  - title: "MCP specification: Transports"
    url: "https://modelcontextprotocol.io/specification/2025-06-18/basic/transports"
  - title: "MCP specification: Authorization"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization"
  - title: Claude Code MCP setup
    url: "https://code.claude.com/docs/en/mcp"
  - title: VS Code MCP server setup
    url: "https://code.visualstudio.com/docs/agent-customization/mcp-servers"
  - title: Cursor MCP setup
    url: "https://docs.cursor.com/context/model-context-protocol"
  - title: MCP Inspector
    url: "https://github.com/modelcontextprotocol/inspector"
---
## Before you connect

Obtain the exact MCP endpoint from the publisher, for example `https://mcp.example.com/mcp`. A marketing homepage, REST API base URL, SSE event URL, and MCP endpoint are not interchangeable. Also record the publisher, expected tools, authentication method, and scopes before giving the server access to data.

For a new remote deployment, prefer **Streamable HTTP**. In the 2025 protocol family it uses one endpoint for HTTP POST and optional GET/SSE streaming. Current clients often label it `http`, `streamable-http`, or simply “remote.” An explicit `sse` option normally means the older two-endpoint HTTP+SSE transport.

## Path A: an authless endpoint

Start in the [MCP Playground](/). Paste the endpoint, leave OAuth or custom credentials unset, and connect with the Streamable HTTP/MCP transport. Inspect the connection trace before calling anything:

1. Confirm the browser or client reached the intended hostname and path.
2. Confirm the response is MCP JSON or an MCP event stream—not an HTML login page or generic API response.
3. Inspect the discovered tool, resource, and prompt lists. An empty list can be legitimate, but it should agree with the server's published purpose.
4. Call a read-only tool with the smallest valid input. Review both the structured result and any text content.
5. Disconnect and reconnect to catch hidden session assumptions.

A generic remote configuration looks like this, but use the field names documented by your client:

```json
{
  "servers": {
    "example": {
      "type": "http",
      "url": "https://mcp.example.com/mcp"
    }
  }
}
```

Claude Code's documented equivalent is:

```bash
claude mcp add --transport http example https://mcp.example.com/mcp
```

In VS Code, run **MCP: Add Server** or add an HTTP entry to workspace or user `mcp.json`. In Cursor, add a remote entry through its MCP settings or `.cursor/mcp.json`. Client schemas differ, so do not silently translate unrecognized fields.

## Path B: OAuth-protected access

Add the same endpoint without copying an access token into the URL. On the first protocol request, a protected server should return `401 Unauthorized` with a Bearer challenge. Current MCP authorization uses protected-resource metadata to tell the client which authorization server can issue a token for this MCP resource.

A conforming client then opens a browser. Check the address bar before signing in, review the requested scopes, authorize, and return to the client. After the code exchange, the client retries the MCP request with a bearer access token. The server must validate that the token was issued for this resource—not merely that the token has a valid signature.

When a client offers manual OAuth fields, do not assume they are required. Automatic discovery plus Client ID Metadata Documents or Dynamic Client Registration may supply client identity. A manual client ID (and, for confidential clients, a secret) is needed only when the authorization server requires pre-registration or its published registration mechanisms cannot serve the client. See [OAuth for MCP explained](/learn/oauth-for-mcp-explained) for the full sequence.

## Fixed API keys and headers

Some publishers document a fixed bearer token or API-key header instead of OAuth. Use the client's secret input facility when available rather than committing a credential to a workspace file. A conceptual configuration is:

```json
{
  "type": "http",
  "url": "https://mcp.example.com/mcp",
  "headers": {
    "Authorization": "Bearer ${input:example-token}"
  }
}
```

The `${input:...}` syntax is client-specific. Verify it in that client's documentation. Never place credentials in query strings: URLs leak through history, logs, screenshots, referrers, and monitoring systems.

## Diagnose the first failure

| Symptom | Likely layer | What to inspect |
| --- | --- | --- |
| DNS, TLS, or timeout | Network/hosting | Hostname, certificate chain, firewall, private-network reachability |
| `404` or HTML response | Endpoint | Exact path, reverse-proxy routing, whether you copied a homepage |
| Browser-only CORS failure | Browser access policy | `Origin`, preflight response, allowed headers; compare a trusted non-browser client |
| `401` without useful discovery | OAuth resource server | `WWW-Authenticate`, `resource_metadata`, protected-resource metadata URL |
| Authorization page rejects redirect URI | Client registration | Registered callback, native/web application type, DCR or manual client record |
| Token obtained, MCP still returns `401` | Token validation | Audience/resource binding, issuer, scope, expiration, proxy stripping `Authorization` |
| Connects but capabilities are absent | MCP lifecycle/permissions | Negotiated version, granted scopes, `tools/list`, `resources/list`, `prompts/list` |
| Works once, fails after restart | Session/token persistence | Protocol-era session handling, refresh token behavior, client credential storage |

Do not “fix” a `401` by retrying an old token indefinitely. Do not classify every `403` as OAuth: a tool may return an application-level permission error after authentication. Preserve the HTTP status, response headers, discovery requests, token endpoint result (with secrets redacted), and the first authenticated MCP request. Those facts identify the failing layer.

## Validate before normal use

After connection, compare discovered capabilities with the publisher's documentation. Start with read-only operations, then test a reversible write with explicit confirmation. Revoke access at the authorization provider and verify the client stops working. Finally, check reconnect and refresh behavior. A green “connected” indicator proves transport setup, not that permissions, tool safety, or failure recovery are correct.
