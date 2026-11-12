---
title: "Invalid Host header: MCP DNS rebinding fixes"
navTitle: "Invalid Host header"
summary: "Why MCP SDKs reject a request with Invalid Host header, how Python and TypeScript differ, and how to fix the allowlist behind Docker and reverse proxies without turning protection off."
track: "build"
level: "practitioner"
order: 456
category: "Security"
readingTimeMinutes: 5
lastReviewed: "2026-11-11"
metaTitle: "Invalid Host header: MCP DNS rebinding fixes | mcptest.io"
metaDescription: "Fix MCP Invalid Host header (421 in Python, 403 in TypeScript): match the allowlist to the Host your proxy forwards while keeping DNS rebinding protection."
relatedSlugs:
  - troubleshooting
  - mcp-cors-headers-for-browser-clients
  - mcp-error-posting-to-endpoint
  - remote-mcp-server-with-fastapi
sourceLinks:
  - title: "Python SDK transport security implementation"
    url: "https://github.com/modelcontextprotocol/python-sdk/blob/main/src/mcp/server/transport_security.py"
  - title: "Python SDK troubleshooting: 421 Invalid Host header"
    url: "https://github.com/modelcontextprotocol/python-sdk/blob/main/docs/troubleshooting.md"
  - title: "TypeScript SDK Host header validation"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/middleware/hostHeaderValidation.ts"
  - title: "TypeScript SDK Express guide: DNS rebinding"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/express.md"
  - title: "MCP 2025-11-25 transports: security warning"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports"
  - title: "VS Code Host and port report #57"
    url: "https://github.com/datagouv/datagouv-mcp/issues/57"
---

## Invalid Host header

```text
Invalid Host header
```

The server's DNS rebinding protection rejected the request because its `Host` header is not on the server's allowlist. The check runs before any MCP handling, so authentication and the MCP request itself never ran.

The MCP specification requires servers to validate `Origin`, and to bind local servers to localhost. Checking `Host` as well is an SDK defense against DNS rebinding: a malicious website re-points its own domain to `127.0.0.1` and reaches a local server. It applies the same way to 2025 and 2026 servers.

**What each SDK returns:**

| SDK | Status | Body | Notes |
| --- | --- | --- | --- |
| Python | `421 Misdirected Request` | `Invalid Host header` (plain text) | The Python client shows `Server returned an error response`. The server log has `Invalid Host header: <host>`. |
| TypeScript 2.x | `403` | JSON-RPC `-32000`, `Invalid Host: <hostname>` | `Invalid Host header: <value>` only when the header cannot be parsed. |
| TypeScript 1.x transport option | `403` | JSON-RPC `-32000`, `Invalid Host header: <host>` | From `allowedHosts` on the server transport. |

A rejected `Origin` is a related check: Python answers 403 `Invalid Origin header`, TypeScript 403 `Invalid Origin: <hostname>`.

## Likely causes {#likely-causes-ranked-by-the-report-evidence}

1. **A deployed server still allows only localhost.** Python's `streamable_http_app()` turns protection on by default, because its `host` argument defaults to `127.0.0.1`. It then allows only `127.0.0.1:*`, `localhost:*` and `[::1]:*`, even if the app is served on a public name. TypeScript's `createMcpExpressApp()` does the same with its default `127.0.0.1` bind.
2. **The port does not match (Python).** Python compares the whole `Host` value, port included. An entry such as `localhost` does not match `localhost:8000`; you need `localhost:8000` or `localhost:*`. [datagouv MCP #57](https://github.com/datagouv/datagouv-mcp/issues/57) shows this for a Docker-published server reached at `127.0.0.1:8000`. TypeScript compares hostnames only and ignores the port.
3. **A proxy forwards a different `Host`.** The proxy sends an internal name, such as a Docker Compose service (`mcp:8000`) or a Kubernetes service, instead of the public hostname.

## How to confirm the cause

Send a request with the `Host` the server will see, straight to the server:

```bash
curl -si http://127.0.0.1:8000/mcp \
  -H 'Host: mcp.example.com' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
```

- 421 with `Invalid Host header`: a Python server rejected that `Host`.
- 403 with `Invalid Host: mcp.example.com`: a TypeScript server rejected that hostname.
- Repeat with `-H 'Host: 127.0.0.1:8000'`. If that works and the public name does not, it is cause 1 or 2.

To see what the proxy actually forwards, read the Python server log line `Invalid Host header: <host>`, or log the `Host` header at the server. A value you do not recognize is cause 3.

## Fix for client users

- Use the hostname and port the publisher documents.
- Give the operator the status, body, URL and time of the failure.
- Signing in again cannot fix this: the server rejects the request before authentication.
- Do not work around it with a fake `Host` header or by turning protection off on a shared machine.

## Fix for Python server authors

Pass `transport_security` with the names you actually serve. This local example allows only port 8000:

```python
from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings

mcp = MCPServer("example")
app = mcp.streamable_http_app(
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=["127.0.0.1:8000", "localhost:8000"],
        allowed_origins=["http://127.0.0.1:8000", "http://localhost:8000"],
    )
)
```

For a deployment, list the public host exactly as the proxy forwards it, plus the trusted browser origins. Behind HTTPS on port 443 that is usually `mcp.example.com` with no port. `name:*` matches any port but only when a port is present: `127.0.0.1:*` rejects a bare `Host: 127.0.0.1`. Python 1.x used `FastMCP` with the same `TransportSecuritySettings`.

## Fix for TypeScript server authors

List hostnames without ports. The [SDK Express guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/express.md) uses:

```ts
import { createMcpExpressApp } from '@modelcontextprotocol/express';

const app = createMcpExpressApp({
  host: '0.0.0.0',
  allowedHosts: ['mcp.example.com'],
});
// Attach your authenticated /mcp handler and listen on the intended port.
```

Binding to `0.0.0.0` without `allowedHosts` drops the check altogether, so name the hosts you serve. Keep `Origin` validation and authentication configured. Do not allow every hostname just to make a test pass.

## Check with mcptest

Use **Test your server** with the public endpoint and read the status and body in the message log. mcptest has no dedicated Host or DNS rebinding finding. [transport.cors-expose-headers-missing](/learn/mcp-transport-diagnostics-reference#transport-cors-expose-headers-missing) is about unreadable response headers, not this check. After the fix, confirm in a server-side test that the allowed host connects and an unknown `Host` is still rejected.

## Related errors

- [Error POSTing to endpoint](/learn/mcp-error-posting-to-endpoint): how clients wrap this 421 or 403.
- [CORS headers for browser clients](/learn/mcp-cors-headers-for-browser-clients): a browser that cannot read the response at all.
