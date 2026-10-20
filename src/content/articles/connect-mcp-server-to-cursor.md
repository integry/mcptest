---
title: How to connect a remote MCP server to Cursor
navTitle: Connect a server to Cursor
summary: Configure a remote MCP server in Cursor's mcp.json, complete OAuth, and fix the Client Closed, Loading tools and No tools found states from the MCP Logs.
track: use
level: practitioner
order: 22
category: Client setup
readingTimeMinutes: 5
lastReviewed: "2026-10-20"
relatedSlugs:
  - connect-remote-mcp-server
  - mcp-clients-compared
  - mcp-server-connected-but-no-tools
  - remote-mcp-server-401-unauthorized
sourceLinks:
  - title: "Cursor docs: Model Context Protocol (MCP)"
    url: "https://cursor.com/docs/context/mcp"
  - title: "Cursor help: MCP"
    url: "https://cursor.com/help/customization/mcp"
  - title: Cursor release notes
    url: "https://cursor.com/docs/release-notes"
  - title: "Cursor forum: MCP servers fail to connect (Client Closed status)"
    url: "https://forum.cursor.com/t/65580"
  - title: "Cursor forum: MCP servers No tools found"
    url: "https://forum.cursor.com/t/49094"
---
## Before you start

This guide reflects Cursor's MCP documentation reviewed on 20 October 2026 and Cursor 3.24. Recent builds moved MCP management into **Customize** in the sidebar. Older guides describe settings pages such as "Tools & MCP" or "Tools & Integrations"; those are not in Cursor's current documentation, so use the config file and **Customize > MCPs** as described here.

Cursor supports stdio, SSE and Streamable HTTP. For a remote server you need the exact MCP endpoint, for example `https://mcp.example.com/mcp`, and to know whether it uses OAuth, a fixed header, or no authentication. [How to connect to a remote MCP server](/learn/connect-remote-mcp-server) covers how to confirm that.

## Compatibility at a glance

<!-- compat-matrix clients="cursor" limitations="true" -->

## Add the server to mcp.json

Cursor reads two files:

| File | Scope |
| --- | --- |
| `.cursor/mcp.json` in the project | This project only; can be committed for the team |
| `~/.cursor/mcp.json` | Every project on this machine |

1. Create or open the file you want.
2. Add the server under `mcpServers`. A remote server needs only `url`; Cursor does not use a `type` field for remote entries.

   ```json
   {
     "mcpServers": {
       "example": {
         "url": "https://mcp.example.com/mcp"
       }
     }
   }
   ```

3. If the server uses a fixed API key, add it as a header and read the value from your environment rather than writing it into the file:

   ```json
   {
     "mcpServers": {
       "example": {
         "url": "https://mcp.example.com/mcp",
         "headers": {
           "Authorization": "Bearer ${env:EXAMPLE_TOKEN}"
         }
       }
     }
   }
   ```

4. Open **Customize** from the sidebar, go to **MCPs**, and check that the server is switched on. Disabled servers do not load and do not appear in chat.

Interpolation with `${env:NAME}`, `${userHome}` and `${workspaceFolder}` works in `url`, `headers` and `auth`. Restart Cursor after you change your shell profile so it picks up new environment variables.

## Sign in with OAuth

Cursor supports OAuth for remote servers. When the server returns a `401` with OAuth metadata and supports automatic registration, Cursor offers to sign in and opens the authorization page in your browser. Marketplace entries installed with **Add to Cursor** do the same.

Some providers do not support Dynamic Client Registration, require a fixed client ID, or only allow redirect URLs they have approved. For those, register an OAuth app with the provider and add a static `auth` block:

```json
{
  "mcpServers": {
    "example": {
      "url": "https://mcp.example.com/mcp",
      "auth": {
        "CLIENT_ID": "${env:EXAMPLE_CLIENT_ID}",
        "CLIENT_SECRET": "${env:EXAMPLE_CLIENT_SECRET}",
        "scopes": ["read", "write"]
      }
    }
  }
}
```

`CLIENT_ID` is required. `CLIENT_SECRET` is only for confidential clients. If you omit `scopes`, Cursor uses the `scopes_supported` value from the authorization server's metadata. Register these redirect URLs with the provider:

- Cursor desktop: `http://localhost:8787/callback`
- Cursor on the web and Cursor agents: `https://www.cursor.com/agents/mcp/oauth/callback`

Cursor 3.24 added a Cursor-hosted callback page for OAuth apps that reject local redirect URLs. It also shows a reconnect prompt when a login expires, instead of failing silently.

## Read the MCP Logs first

Every state below is easier to diagnose from the logs than from the indicator next to the server:

1. Open the Output panel with Cmd+Shift+U (macOS) or Ctrl+Shift+U (Windows and Linux).
2. Select **MCP Logs** in the dropdown.
3. Toggle the server off and on under **Customize > MCPs** and watch the initialization, the tool listing and any error.

## When it fails

### "Client Closed"

The client side of the connection ended before the server finished starting. Forum thread [65580](https://forum.cursor.com/t/65580) shows every server marked Client Closed while the same servers worked from a terminal. Almost all reports involve stdio servers that Cursor starts as a process:

- **Windows and `npx`.** Wrap the command: `"command": "cmd", "args": ["/c", "npx", "-y", "<package>"]`. Or install the package globally and run `node` with the full path to its entry file.
- **Node.js not found.** With nvm or another version manager, Cursor may not see your shell's `PATH`. Use the absolute path from `which npx`, then restart Cursor.

For a remote URL, Client Closed usually means the request failed outright: wrong path, TLS error, or a proxy that closed the connection. Check the MCP Logs for the HTTP status.

### Stuck on "Loading tools"

Cursor has connected but has not received a `tools/list` response. Check the MCP Logs for the last request sent. Common causes are a server that hangs after `initialize`, an SSE response that a proxy buffers until it times out, and a server that is still waiting for a session ID the client never received. Thread [49094](https://forum.cursor.com/t/49094) also reports that after one tool call times out, the server can stay broken until Cursor is restarted. Restart Cursor before you change any configuration.

### "No tools found"

The logs show `Error fetching tools for server ...: Error: No tools found`, or the server is shown as running but lists nothing. Work through these in order:

1. Read the line before it. `spawn npx ENOENT` means a local server never started, so fix the command path as described above.
2. Check that the server is switched on under **Customize > MCPs**, and that no tool allowlist for that server excludes everything. An empty allowlist allows all tools.
3. Check whether the server needs sign-in before it lists tools. Some servers return an empty list to unauthenticated clients.
4. Check whether the server declares the `tools` capability and returns tools from `tools/list`. [MCP server connected but no tools](/learn/mcp-server-connected-but-no-tools) explains how to tell from the raw messages.

Cursor's October 2026 builds refresh a server's tool list when the agent thinks a tool is missing. If a tool you just added does not appear, toggle the server off and on.

### Sign-in opens but fails, or never completes

A redirect URL error from the provider means the OAuth app does not list Cursor's callback. Add `http://localhost:8787/callback` or switch to the static `auth` block. If the browser never opens, the server probably returned a `401` without a usable `WWW-Authenticate` header; see the [401 checklist](/learn/remote-mcp-server-401-unauthorized). If your team uses an MCP allowlist, an admin-blocked server now says so in Cursor rather than asking you to sign in again.

### An npm-based server keeps running an old version

Remove the server in **Customize**, run `npm cache clean --force`, and add it again.

## Verify the endpoint before you add it

Cursor's indicators show that something failed, not which request failed. Open the [MCP Playground](/), paste the endpoint and connect before you edit `mcp.json`. **Logs & Events** shows each JSON-RPC message and HTTP status in order, so you can see whether `initialize`, `tools/list` or the OAuth discovery is failing. A link of the form `https://mcptest.io/server/<your endpoint URL>` opens the playground with the server already filled in.
