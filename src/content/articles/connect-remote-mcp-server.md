---
title: How to connect to a remote MCP server
summary: A client-oriented walkthrough for testing an authless or OAuth-protected Streamable HTTP endpoint and diagnosing the first connection.
track: use
level: newcomer
order: 1
category: Getting started
readingTimeMinutes: 6
lastReviewed: "2026-11-11"
relatedSlugs:
  - oauth-for-mcp-explained
  - mcp-clients-compared
sourceLinks:
  - title: "MCP specification 2026-07-28: Streamable HTTP"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
  - title: "MCP specification 2025-11-25: Transports"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports"
  - title: "MCP specification: Authorization"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization"
  - title: Claude Code MCP setup
    url: "https://code.claude.com/docs/en/mcp"
  - title: VS Code MCP server setup
    url: "https://code.visualstudio.com/docs/agent-customization/mcp-servers"
  - title: "VS Code: MCP configuration reference"
    url: "https://code.visualstudio.com/docs/agents/reference/mcp-configuration"
  - title: Cursor MCP setup
    url: "https://cursor.com/docs/context/mcp"
  - title: MCP Inspector
    url: "https://github.com/modelcontextprotocol/inspector"
---
## Before you connect

Get the exact MCP endpoint from the publisher, for example `https://mcp.example.com/mcp`. A marketing homepage, a REST API base URL, an SSE event URL and an MCP endpoint are not interchangeable. Before you give the server access to data, also note the publisher, the tools you expect, the authentication method and the scopes it asks for.

For a new remote deployment, prefer **Streamable HTTP**. It uses one endpoint: the client sends JSON-RPC messages with HTTP POST and the server answers with JSON or an event stream. In the 2025 protocol versions the client may also open a GET stream; the current version, `2026-07-28`, is POST only. Clients label this transport `http`, `streamable-http` or simply "remote". An explicit `sse` option normally means the older two-endpoint HTTP+SSE transport. [MCP protocol versions explained](/learn/mcp-protocol-versions-explained) covers the differences, and the [glossary](/learn/mcp-glossary#streamable-http) defines the terms.

Not every client can reach every server. Clients that run in the vendor's cloud, such as claude.ai and ChatGPT, need a public HTTPS endpoint; desktop and command-line clients connect from your own machine. The [client support matrix](/learn/mcp-client-support-matrix) lists each client's transports and sign-in options.

## Path A: an authless endpoint

Start in the [MCP Playground](/). Paste the endpoint and click **Connect**. The playground tries the exact endpoint, then the 2026 stateless protocol, then the 2025 stateful protocol, and starts OAuth only if the server sends an authorization challenge. Read **Logs & Events** before you call anything:

1. Confirm the request reached the intended hostname and path.
2. Confirm the response is MCP JSON or an MCP event stream, not an HTML login page or a generic API response.
3. Check the discovered tool, resource and prompt lists. An empty list can be legitimate, but it should agree with the server's published purpose.
4. Call a read-only tool with the smallest valid input. Review both the structured result and any text content.
5. Disconnect and reconnect to catch hidden session assumptions.

Many clients use a configuration of this shape, but use the field names your client documents:

```json
{
  "mcpServers": {
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

Client schemas differ. VS Code's older `.vscode/mcp.json` uses `servers` instead of `mcpServers`, Cursor's remote entries need only `url`, and Gemini CLI and Zed use their own settings files. Do not silently translate fields a client does not recognize. The step-by-step guides cover [Claude](/learn/add-remote-mcp-server-to-claude), [ChatGPT](/learn/connect-mcp-server-to-chatgpt), [Cursor](/learn/connect-mcp-server-to-cursor), [VS Code](/learn/connect-mcp-server-to-vs-code), [Windsurf, Gemini CLI and Codex](/learn/connect-mcp-server-to-windsurf-gemini-cli-and-codex), [Zed](/learn/connect-mcp-server-to-zed), [JetBrains AI Assistant](/learn/connect-mcp-server-to-jetbrains-ai-assistant) and [GitHub Copilot CLI](/learn/connect-mcp-server-to-github-copilot-cli-and-coding-agent).

## Path B: OAuth-protected access

Add the same endpoint without copying an access token into the URL. On the first protocol request, a protected server should return `401 Unauthorized` with a `WWW-Authenticate: Bearer` challenge. MCP authorization uses protected resource metadata to tell the client which authorization server can issue a token for this MCP server.

A conforming client then opens a browser. Check the address bar before you sign in, review the requested scopes, approve, and return to the client. After the code exchange, the client retries the MCP request with a bearer access token. The server must check that the token was issued for this server, not merely that its signature is valid.

When a client offers manual OAuth fields, do not assume you need them. The client can usually identify itself automatically, with a Client ID Metadata Document (CIMD) or Dynamic Client Registration (DCR). The `2026-07-28` specification deprecates DCR in favour of CIMD, but many clients and providers still use it. Enter a manual client ID (and, for confidential clients, a secret) only when the authorization server requires a pre-registered client. See [OAuth for MCP explained](/learn/oauth-for-mcp-explained) for the full sequence, and the [MCP OAuth checker](/tools/oauth-check) to test each discovery step without signing in.

## Fixed API keys and headers

Some publishers document a fixed bearer token or API-key header instead of OAuth. Keep the credential out of files you commit: use the client's secret prompt, or a reference to an environment variable. A typical entry looks like this:

```json
{
  "type": "http",
  "url": "https://mcp.example.com/mcp",
  "headers": {
    "Authorization": "Bearer ${EXAMPLE_TOKEN}"
  }
}
```

The reference syntax is client-specific. Claude Code and the Copilot format use `${EXAMPLE_TOKEN}`, Cursor uses `${env:EXAMPLE_TOKEN}`, VS Code's older format uses `${input:...}` prompts, and Gemini CLI also accepts `$EXAMPLE_TOKEN`. Some clients, including ChatGPT, have no header field at all. Check your client's guide. Never put credentials in query strings: URLs leak through history, logs, screenshots, referrers and monitoring systems.

## Diagnose the first failure

| Symptom | Likely layer | What to inspect |
| --- | --- | --- |
| DNS, TLS, or timeout | Network/hosting | Hostname, certificate chain, firewall, private-network reachability; see [Request timed out](/learn/mcp-error-request-timed-out) |
| `404` or HTML response | Endpoint | Exact path, reverse-proxy routing, whether you copied a homepage; see [Error POSTing to endpoint](/learn/mcp-error-posting-to-endpoint) |
| Browser-only CORS failure | Browser access policy | `Origin`, preflight response, allowed headers; compare a non-browser client; see [CORS headers for browser clients](/learn/mcp-cors-headers-for-browser-clients) |
| `401` without useful discovery | OAuth resource server | `WWW-Authenticate`, `resource_metadata`, protected resource metadata URL; see [Failed to discover OAuth metadata](/learn/mcp-error-failed-to-discover-oauth-metadata) |
| Authorization page rejects redirect URI | Client registration | Registered callback, native or web application type, CIMD, DCR or manual client record; see [invalid_redirect_uri](/learn/mcp-error-invalid-redirect-uri) |
| Token obtained, MCP still returns `401` | Token validation | Audience/resource binding, issuer, scope, expiration, a proxy stripping `Authorization`; see the [401 checklist](/learn/remote-mcp-server-401-unauthorized) |
| Connects but capabilities are absent | MCP lifecycle/permissions | Negotiated version, granted scopes, `tools/list`, `resources/list`, `prompts/list`; see [Connected but no tools](/learn/mcp-server-connected-but-no-tools) |
| Works once, fails after restart | Session/token persistence | Session handling for the protocol version, refresh token behavior, client credential storage; see [Session not found after deploy](/learn/mcp-session-not-found-after-deploy) |

Do not "fix" a `401` by retrying an old token indefinitely. Do not treat every `403` as an OAuth problem: a tool may return an application-level permission error after authentication. Keep the HTTP status, response headers, discovery requests, token endpoint result (with secrets redacted) and the first authenticated MCP request. Those facts identify the failing layer.

## Validate before normal use

After you connect, compare the discovered capabilities with the publisher's documentation. Start with read-only operations, then test a reversible write with explicit confirmation. Revoke access at the authorization provider and check that the client stops working. Finally, check reconnect and refresh behavior. A green "connected" indicator proves the transport works, not that permissions, tool safety or failure recovery are correct.
