---
title: "MCP 'Session not found' (404): why it happens after deploys and how to fix it"
navTitle: Session not found after deploys
summary: Diagnose stale MCP sessions after restarts and replica changes, choose durable session ownership or stateless HTTP, and actively test recovery before release.
track: build
level: practitioner
order: 445
category: Transports
readingTimeMinutes: 7
lastReviewed: "2026-10-24"
metaTitle: "MCP Session not found (404) after deploys: fixes | mcptest.io"
metaDescription: Fix stale Mcp-Session-Id failures after deploys, cold starts and scale-out. Compare sticky sessions, Redis, Durable Objects and stateless MCP, and test recovery.
relatedSlugs:
  - mcp-transport-diagnostics-reference
  - deploy-remote-mcp-server
  - mcp-cors-headers-for-browser-clients
  - test-mcp-server-before-deploying
sourceLinks:
  - title: "MCP session management specification"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management"
  - title: "Claude Code stale-session recovery report #50450"
    url: "https://github.com/anthropics/claude-code/issues/50450"
  - title: "Cline restart recovery report #15147"
    url: "https://github.com/cline/cline/issues/15147"
  - title: "Appsmith replica session report #42238"
    url: "https://github.com/appsmithorg/appsmith/issues/42238"
  - title: "Epydemix session issue #24"
    url: "https://github.com/epistorm/epydemix/issues/24"
  - title: "Cursor CLI session recovery discussion"
    url: "https://forum.cursor.com/t/cursor-mcp-client-does-not-restart-session-on-404-session-not-found/161132"
  - title: "xmcp session not found explainer"
    url: "https://xmcp.dev/blog/mcp-session-not-found-error"
  - title: "Python SDK session troubleshooting"
    url: "https://github.com/modelcontextprotocol/python-sdk/blob/main/docs/troubleshooting.md"
---

A healthy endpoint can reject an old MCP session even while fresh connections work. Start by comparing a new connection with the failing client. If a new initialize succeeds and the old id receives 404, investigate the session lifecycle before changing tools or credentials.

## Why a deploy loses the session

A stateful Streamable HTTP server sends `Mcp-Session-Id` in its initialize response. Subsequent requests use it to find the session. An in-memory map disappears when the process exits. A rolling deploy, crash or cold start can therefore leave a client holding an id its next server instance cannot recognize. Idle expiration can produce the same symptom without any restart.

The [session management specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management) requires HTTP 404 for an invalid session id. After receiving it, clients must initialize again without that header. Returning 400, 401 or 500 for an unknown session hides the recovery signal. Continue to use 401 for actual authentication failures: an id is never an authorization credential.

A 404 on the wrong URL is a separate possibility. Confirm the request reaches the MCP handler and inspect response evidence before attributing it to a lost session.

## Why multiple replicas make failures intermittent

Imagine initialization reaches replica A. If the next request goes to replica B, a process-local map on B has no record of the new id. Alternating successful requests and 404s are consistent with this arrangement. Serverless instances can exhibit the same behavior as instances start and retire.

Check the routing configuration and session ownership in server logs. A failure ratio alone cannot prove which replica answered, and expiration or application bugs can also lose state. Avoid logging raw session ids or bearer tokens; correlate using a server-side safe identifier.

## Choose where the state lives

| Approach | Helps with | Limitation |
| --- | --- | --- |
| Sticky routing | Requests consistently reaching the live session owner | An owner restart still loses memory; cookie affinity may not work for every MCP client |
| Shared application state in Redis | Recovering durable data across replicas | A stored id is insufficient: SDK transport objects, streams and lifecycle need an ownership design |
| Durable Objects | Consistent ownership and durable application state on Workers | Define how transport state is recreated after an object wakes or migrates |
| Stateless HTTP | Avoiding transport session lookup across replicas | Features relying on server-held session state need a different design |

If sticky routing is a short-term measure, keep 404 and fresh initialization correct so a redeploy can recover. If using Redis, define expiration, deletion and concurrency behavior together; sharing a key without sharing the state behind it will still fail.

For a TypeScript SDK transport that needs no sessions:

```ts
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});
```

For Python SDK/FastMCP:

```python
mcp = FastMCP("server", stateless_http=True, json_response=True)
app = mcp.streamable_http_app()
```

These are transport configuration excerpts; retain your framework's documented lifecycle and authentication setup. For stateful TypeScript handlers, test the session lookup explicitly:

```ts
const id = req.headers['mcp-session-id'];
if (id && !transports.has(id)) return res.status(404).end();
// For initialize without an id, create a fresh transport.
```

On Workers, use the SDK's durable session routing where appropriate, such as `McpAgent.serve('/mcp')`, and invalidate durable ownership when accepting DELETE. Do not route an arbitrary id to an unrelated new process and report it as an authentication error.

## What clients do today

The required behavior and deployed client behavior differ. [Claude Code #50450](https://github.com/anthropics/claude-code/issues/50450) and [Cline #15147](https://github.com/cline/cline/issues/15147) report failures to recover after stale-session responses. [Appsmith #42238](https://github.com/appsmithorg/appsmith/issues/42238) describes replica-local state rejecting issued ids. These are reports about particular implementations and versions, not guarantees about every current release.

The [Cursor discussion](https://forum.cursor.com/t/cursor-mcp-client-does-not-restart-session-on-404-session-not-found/161132) distinguishes IDE recovery from CLI behavior and includes later reports of idle-expiry failures. Check your exact host version. Reconnecting the affected client can restore a fresh session, but does not repair the server's routing or durability. For a custom client, discard the stale id on 404, initialize without it, and finish the initialized notification before retrying safe requests. Avoid blindly replaying tool calls with side effects.

## Test the wire behavior before release

In the mcptest inspector, connect and click **Check session resilience** in the diagnostics area. It creates temporary sessions, sends a fabricated UUID, checks initialization after 404, runs 8 sequential then 4 parallel pings, and checks DELETE invalidation. It never invokes tools or deletes the inspector's connection. Each request has a five-second deadline, and a run sends at most 22 HTTP requests including cleanup.

A stateless 2026 connection passes with **not applicable: stateless**. On an older HTTP server, initialization without an id is only classified as sessionless after a sessionless ping also succeeds. Missing CORS exposure must not be mistaken for stateless behavior: expose `Mcp-Session-Id` so browsers can read it.

Opt into the same check on the report page or in CI:

```bash
npm run mcptest -- --session-resilience https://mcp.example/mcp
```

The four [session finding ids](/learn/mcp-transport-diagnostics-reference#session-unknown-id) retain redacted evidence in the report, exported artifact and published permalink. A clean burst samples current continuity; it cannot prove a future deploy will preserve state. Complete a staging restart test with the actual client host as well, and verify both correct 404 responses and successful fresh initialization.
