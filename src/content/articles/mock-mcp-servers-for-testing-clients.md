---
title: "Mock MCP servers for testing MCP clients and agents"
navTitle: Mock MCP servers for clients
summary: "Test an MCP client or agent against deterministic servers: which failures to simulate (auth, protocol errors versus isError, slow tools, complex schemas, version negotiation), public test servers you can use today, and a minimal mock with the TypeScript and Python SDKs."
track: build
level: practitioner
order: 410
category: Testing
readingTimeMinutes: 9
lastReviewed: "2026-11-11"
metaTitle: "Mock MCP servers for testing clients and agents (TypeScript and Python) | mcptest.io"
metaDescription: "How to test an MCP client against mock servers: failure modes to simulate, public test servers such as server-everything and MCP Playground mocks, and a minimal mock in the TypeScript and Python SDKs."
relatedSlugs:
  - testing-guide
  - mcp-json-rpc-error-codes
  - mcp-protocol-versions-explained
  - mcp-error-request-timed-out
  - test-mcp-server-with-curl-and-postman
  - mcp-inspector-alternatives
sourceLinks:
  - title: "MCP 2026-07-28 specification"
    url: "https://modelcontextprotocol.io/specification/2026-07-28"
  - title: "MCP 2026-07-28 tools: error handling"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/server/tools"
  - title: "Everything MCP server"
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/everything"
  - title: "MCP conformance suite"
    url: "https://github.com/modelcontextprotocol/conformance"
  - title: "MCP Inspector: Configuration (sample servers)"
    url: "https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/configuration"
  - title: "MCP Playground: Mock MCP servers"
    url: "https://mcpplaygroundonline.com/mock-mcp-servers"
  - title: "TypeScript SDK: Test a server"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/testing.md"
  - title: "Python SDK: Testing"
    url: "https://py.sdk.modelcontextprotocol.io/get-started/testing/"
---

Most MCP testing advice is about servers. If you build the other side, an MCP client, agent framework or host app, you need servers whose behaviour you control: a mock gives the same answer every run and fails on purpose in the ways real servers fail in production. This guide lists the failures worth simulating, the public test servers available today, and a minimal mock in each official SDK. The TypeScript and Python examples were run on November 11, 2026, with `@modelcontextprotocol/server` 2.4.0 and `mcp` 2.3.0.

## Why test a client against mock servers

- **Determinism.** A live server changes its tools, rate-limits you or goes down. A mock returns the same answers every time.
- **Failure on demand.** Real servers rarely time out or reject your token while you watch. A mock does it whenever the test asks.
- **No credentials or side effects.** CI needs no production account.
- **Both protocol eras.** Clients meet stateless 2026-07-28 and stateful 2025 servers; a mock tests each path on its own.

Keep a few tests against real servers, such as the public ones in the [mcptest.io catalog](/catalog), to catch what a mock does not model.

## Failure modes to simulate

### Authentication failures

A server that requires credentials answers `401` with a `WWW-Authenticate` header. Test that your client:

- surfaces a missing or invalid token as an authentication problem, not as "server unreachable" or "old protocol";
- reads `resource_metadata` from the challenge and starts OAuth discovery when it supports OAuth;
- handles `403` with `error="insufficient_scope"` by asking for the missing scope instead of looping;
- retries once after refreshing an expired token, and never puts a token in a URL.

With the TypeScript client, connecting to the mock below without a token rejected with "Version negotiation failed: the server requires authorization (HTTP 401)", which is the error your host should turn into a sign-in prompt. [401 Unauthorized](/learn/remote-mcp-server-401-unauthorized) covers what real clients show.

### Protocol errors versus `isError`

MCP has two kinds of failure, and clients must treat them differently:

- **Tool execution errors** are normal results with `isError: true`. The model should see the text and can correct its arguments or try something else. Input validation failures belong here since 2025-11-25.
- **Protocol errors** are JSON-RPC `error` objects, such as `-32602` for an unknown tool or `-32601` for an unknown method. The SDK call rejects; there is nothing for the model to read unless your client passes it on.

SDKs differ here. Calling an unknown tool on the TypeScript mock below returned protocol error `-32602` ("Tool nope not found"), while the Python mock returned a result with `isError: true`. A client that only handles one shape will mishandle the other. The [JSON-RPC error codes reference](/learn/mcp-json-rpc-error-codes) lists every code.

### Slow tools, timeouts and cancellation

Add a tool that waits for as long as the test asks. Check that your client enforces its own deadline, reports the timeout instead of hanging, sends a cancellation, does not blindly retry a tool with side effects, and keeps serving other requests meanwhile. [Request timed out](/learn/mcp-error-request-timed-out) describes the production version.

### Large and complex schemas

Simulate tool lists that are big, nested or confusable:

- many tools, and `tools/list` results split across pages with `nextCursor`;
- nested objects, arrays of objects, enums, `oneOf` and optional fields in `inputSchema`;
- tools whose names and arguments are easy to confuse;
- tools with an `outputSchema`, so your client validates `structuredContent` (see [output schemas](/learn/mcp-tool-output-schemas-and-structured-content));
- very large results, and image or audio content.

### Version negotiation and transport

Test your client against a 2026-only server, a 2025-only server and one that serves both. On a 2025 server with sessions, return `404` for an unknown session and check that the client starts a new session instead of failing every call; [session not found after deploy](/learn/mcp-session-not-found-after-deploy) explains why this matters. Answer some requests as JSON and others as `text/event-stream`, because servers do both. A 2026 server that rejects an unsupported version returns `-32022` (UnsupportedProtocolVersion); your client should fall back or report it, not retry forever.

## Public test servers

You do not always need to write your own mock:

- **Everything server.** The MCP project's [`@modelcontextprotocol/server-everything`](https://github.com/modelcontextprotocol/servers/tree/main/src/everything) "is not intended to be a useful server, but rather a test server for builders of MCP clients". It implements tools, prompts, resources, templates, sampling, elicitation and the 2026 features, and serves both eras over stdio (`npx @modelcontextprotocol/server-everything`) or Streamable HTTP (`npx @modelcontextprotocol/server-everything streamableHttp`, on `http://localhost:3001/mcp`). It needs Node 24 or later.
- **MCP example server.** The MCP Inspector's sample list includes the project's hosted `https://example-server.modelcontextprotocol.io/mcp`. It requires OAuth: an unauthenticated request got `401` with a `resource_metadata` challenge, which makes it a real target for your OAuth flow.
- **Conformance suite, client mode.** `npx @modelcontextprotocol/conformance client --command "<your client>" --scenario <name>` starts a test server for each scenario, runs your client against it and records pass or fail, including an `auth` suite. It is the closest thing to an official client test.
- **MCP Playground mock servers.** [MCP Playground Online](https://mcpplaygroundonline.com/mock-mcp-servers) hosts six public mock endpoints: echo, a bearer-token auth server, an error server that fails in eight ways with an optional delay, a complex-schema server, an MCP Apps server and a 2026 stateless server. They detect the protocol era from the request, and `?rev=2026-07-28` or `?rev=2025-11-25` pins one. On the review date the echo server was offline (`503`) and the complex-schema server answered.

Hosted mocks are someone else's service; for CI, run a mock you own.

## A minimal mock with the TypeScript SDK

This server has three tools: `echo` for the happy path, `fail` for a tool execution error, and `slow` for timeouts. Requests to `/auth/mcp` need a bearer token, so the same process also tests 401 handling. `createMcpHandler` serves 2026 and 2025 clients from one stateless handler.

```ts
// mock-server.mjs: npm i @modelcontextprotocol/server @modelcontextprotocol/node zod
import http from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

const TOKEN = process.env.MOCK_TOKEN ?? 'test-token';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildServer() {
  const server = new McpServer({ name: 'mock', version: '1.0.0' });
  server.registerTool('echo',
    { description: 'Return the text unchanged', inputSchema: z.object({ text: z.string() }) },
    async ({ text }) => ({ content: [{ type: 'text', text }] }));
  server.registerTool('fail',
    { description: 'Always return a tool execution error', inputSchema: z.object({}) },
    async () => ({ isError: true, content: [{ type: 'text', text: 'Upstream returned 503; retry later' }] }));
  server.registerTool('slow',
    { description: 'Wait, then answer', inputSchema: z.object({ ms: z.number().int().max(120_000) }) },
    async ({ ms }) => { await sleep(ms); return { content: [{ type: 'text', text: `waited ${ms} ms` }] }; });
  return server;
}

const mcp = toNodeHandler(createMcpHandler(buildServer));

http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/auth/mcp' && req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.writeHead(401, { 'WWW-Authenticate': 'Bearer error="invalid_token"', 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'invalid_token' }));
  }
  if (pathname === '/mcp' || pathname === '/auth/mcp') return void mcp(req, res);
  res.writeHead(404).end();
}).listen(Number(process.env.PORT ?? 3005));
```

The client checks then read like this. Replace `Client` with your own client or agent wrapper:

```ts
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const client = new Client({ name: 'client-under-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:3005/mcp')));

// A tool execution error is a normal result the agent must read, not an exception.
assert.equal((await client.callTool({ name: 'fail', arguments: {} })).isError, true);
// An unknown tool is a protocol error: the call rejects.
await assert.rejects(client.callTool({ name: 'no-such-tool', arguments: {} }));
// A slow tool must hit the client's own deadline instead of hanging the agent.
await assert.rejects(client.callTool({ name: 'slow', arguments: { ms: 5000 } }, { timeout: 1000 }));
```

## A minimal mock with the Python SDK

The same three tools with `MCPServer`. Raising `ToolError` produces an `isError` result. By default `run(transport="streamable-http")` keeps sessions, so 2025 clients get an `Mcp-Session-Id`; a request with an unknown one got `404` "Session not found", which is the session-loss case to test.

```python
# mock_server.py: pip install "mcp>=2"
import asyncio

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

mcp = MCPServer("mock", version="1.0.0")


@mcp.tool()
def echo(text: str) -> str:
    """Return the text unchanged."""
    return text


@mcp.tool()
def fail() -> str:
    """Always return a tool execution error."""
    raise ToolError("Upstream returned 503; retry later")


@mcp.tool()
async def slow(ms: int) -> str:
    """Wait, then answer."""
    await asyncio.sleep(ms / 1000)
    return f"waited {ms} ms"


if __name__ == "__main__":
    mcp.run(transport="streamable-http", port=3006)
```

A Python client check against it:

```python
import asyncio

from mcp import Client, MCPError


async def main() -> None:
    async with Client("http://127.0.0.1:3006/mcp") as client:
        assert (await client.call_tool("fail", {})).is_error
        try:
            await client.call_tool("slow", {"ms": 5000}, read_timeout_seconds=1)
            raise AssertionError("expected a timeout")
        except MCPError:
            pass  # "Request 'tools/call' timed out"


asyncio.run(main())
```

For unit tests that need no port, the Python `Client` also accepts the `MCPServer` object itself and connects in memory; the TypeScript SDK can pass the handler's `fetch` to the transport. The [testing guide](/docs/testing-guide#unit-tests-of-tool-handlers) shows both.

## Run the mock in CI

Start the mock as a test fixture, wait until the port answers, run the client tests, and stop it. Keep the mock next to the client code and add a tool or route for each bug you fix. Before a release, also try the client against a few real servers in both protocol eras, with and without OAuth. To inspect a real server's behaviour first, use [mcptest.io](/) or one of the [MCP Inspector alternatives](/learn/mcp-inspector-alternatives); to check the wire format by hand, see [testing with curl and Postman](/learn/test-mcp-server-with-curl-and-postman).

## FAQ

### What is a mock MCP server?

A small MCP server that exists only to be tested against. It exposes predictable tools with known answers and can fail on purpose, so you can prove a client or agent handles each case before it meets a real server.

### Is there a public MCP server for testing a client?

Yes. The MCP project's everything server runs locally over stdio or HTTP, and MCP Playground Online hosts public mock endpoints, including auth and error servers. For OAuth, the MCP example server at `example-server.modelcontextprotocol.io` requires a real sign-in.

### Should a failing tool return an error or throw?

Return a result with `isError: true` for anything the model could act on, such as bad arguments or an upstream failure. Use JSON-RPC protocol errors for problems with the request itself, such as an unknown method. Your client must handle both.

### How do I test that my client handles the 2026 stateless protocol?

Point it at a server that speaks only 2026-07-28, then at one that speaks only 2025, and check that it negotiates each. Both SDK mocks above serve both eras from one URL; MCP Playground's mocks let you pin one with `?rev=`.

