---
title: "Invalid Host header: MCP DNS rebinding fixes"
navTitle: "Invalid Host header"
summary: "Repair MCP Host allowlists behind Docker and reverse proxies while retaining DNS rebinding protection, with Python and TypeScript SDK examples."
track: "build"
level: "practitioner"
order: 456
category: "Security"
readingTimeMinutes: 5
lastReviewed: "2026-10-26"
metaTitle: "Invalid Host header: MCP DNS rebinding fixes | mcptest.io"
metaDescription: "Repair MCP Host allowlists behind Docker and reverse proxies while retaining DNS rebinding protection, with Python and TypeScript SDK examples."
relatedSlugs:
  - troubleshooting
  - mcp-cors-headers-for-browser-clients
  - mcp-error-posting-to-endpoint
  - remote-mcp-server-with-fastapi
sourceLinks:
  - title: "VS Code Host and port report #57"
    url: "https://github.com/datagouv/datagouv-mcp/issues/57"
  - title: "Python SDK Host troubleshooting"
    url: "https://github.com/modelcontextprotocol/python-sdk/blob/main/docs/troubleshooting.md"
  - title: "TypeScript Express Host protection"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/express.md"
  - title: "Python transport security implementation"
    url: "https://github.com/modelcontextprotocol/python-sdk/blob/main/src/mcp/server/transport_security.py"
---

## Invalid Host header

```text
Invalid Host header
```

**Where it appears:** [datagouv MCP #57](https://github.com/datagouv/datagouv-mcp/issues/57), filed March 2, 2026, records VS Code/GitHub Copilot receiving a 421 response while connecting to a Docker-published Python server. The request carried a host and port absent from the configured allowlist. The [Python SDK troubleshooting guide](https://github.com/modelcontextprotocol/python-sdk/blob/main/docs/troubleshooting.md) also documents this response and explains that its Python client can instead surface `Server returned an error response`.

## Likely causes, ranked by the report evidence

1. **Host and port do not match the Python allowlist.** The datagouv reproduction used `127.0.0.1:8000` against entries without ports. Compare the actual HTTP `Host` with the configured strings.
2. **A deployment still permits only localhost.** The Python SDK troubleshooting guide describes public requests rejected by the default protection. Compare the public hostname forwarded by ingress with the local development allowlist.
3. **A proxy forwards a different Host than expected.** Inspect the value reaching the application. Binding to `0.0.0.0` controls interfaces; it does not make a public hostname trusted. This is a hypothesis to verify in proxy logs.

These are qualitative priorities, not a measured frequency ranking. A browser-only `Invalid Origin header` is a related but separate allowlist failure.

## Fix for client users

Use the documented hostname and port. Give the server operator the response status, message, URL and redacted timestamp. OAuth retries cannot change a Host rejection before the MCP handler. Do not solve it by configuring an arbitrary Host override or disabling protection on a shared development machine.

Compare a local request with the public route. If local works and ingress fails, the operator needs to align the deployed allowlist and proxy forwarding. If there is no readable HTTP response in a browser, investigate [CORS](/learn/mcp-cors-headers-for-browser-clients) separately.

## Fix for Python server authors

Python SDK 2.x accepts transport security on `streamable_http_app()`. Configure the actual served names, retaining protection. This local example deliberately permits only port 8000:

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

For deployment, substitute the intended public hosts and trusted browser origins. The [security implementation](https://github.com/modelcontextprotocol/python-sdk/blob/main/src/mcp/server/transport_security.py) supports `hostname:*` for explicit ports; allow only what the deployment needs. A browser UI hosted elsewhere needs its own permitted origin as well as correct CORS headers. Python 1.x uses `FastMCP` and its version's transport-security settings.

## Fix for TypeScript server authors

The [SDK Express guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/express.md) uses hostname-based, port-agnostic allowlists, unlike Python's Host-string matching:

```ts
import { createMcpExpressApp } from '@modelcontextprotocol/express';

const app = createMcpExpressApp({
  host: '0.0.0.0',
  allowedHosts: ['mcp.example.com'],
});
// Attach your authenticated /mcp handler and listen on the intended port.
```

That guide documents 403 for rejected Host/Origin values; it does not promise Python's 421 body or wording. Keep authentication and Origin validation configured for your deployment. Do not allow every hostname merely to make the test pass.

## Check with mcptest

Use **Test your server** with the public endpoint and examine its HTTP status and body. There is no dedicated Host/DNS-rebinding diagnostic id. [transport.cors-expose-headers-missing](/learn/mcp-transport-diagnostics-reference#transport-cors-expose-headers-missing) detects unreadable response headers, not a Host allowlist failure. Confirm the permitted host connects and an untrusted host is still rejected in a controlled server-side test. For other status bodies, use the [POST failure guide](/learn/mcp-error-posting-to-endpoint).
