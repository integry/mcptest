---
title: How to connect a remote MCP server to Cursor
navTitle: Connect a server to Cursor
summary: Configure a remote MCP server in Cursor's mcp.json, complete OAuth, and fix the Client Closed, Loading tools and No tools found states from the MCP Logs.
track: use
level: practitioner
order: 22
category: Client setup
readingTimeMinutes: 6
lastReviewed: "2026-11-11"
relatedSlugs:
  - connect-remote-mcp-server
  - mcp-clients-compared
  - mcp-client-support-matrix
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

This guide reflects Cursor's MCP documentation reviewed on 11 November 2026 and Cursor 3.27 (22 October 2026). Recent builds moved MCP management into **Customize** in the sidebar. Older guides describe settings pages such as "Tools & MCP" or "Tools & Integrations"; those are not in Cursor's current documentation, so use the config file and **Customize > MCPs** as described here.

You need:

- **The exact MCP endpoint**, including its path, for example `https://mcp.example.com/mcp`.
- **The sign-in method**: OAuth, a fixed header such as an API key, or no authentication.
- **Node.js on your `PATH`**, only if you also run local servers started with `npx`.

Cursor supports stdio, SSE and Streamable HTTP. [How to connect to a remote MCP server](/learn/connect-remote-mcp-server) explains how to confirm the endpoint and its sign-in method.

## Compatibility at a glance

<!-- compat-matrix clients="cursor" limitations="true" -->

## Add the server to mcp.json

Cursor reads two files and merges them. If the same server name is in both, the project file wins.

| File | Scope |
| --- | --- |
| `.cursor/mcp.json` in the project | This project only; can be committed for the team |
| `~/.cursor/mcp.json` | Every project on this machine |

1. Create or open the file you want.
2. Add the server under `mcpServers`. Cursor's remote examples need only `url`:

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

Cursor expands `${env:NAME}`, `${userHome}`, `${workspaceFolder}` (the folder that contains `.cursor/mcp.json`), `${workspaceFolderBasename}` and `${pathSeparator}` in `command`, `args`, `env`, `url` and `headers`, and in `auth` values. Restart Cursor after you change your shell profile so it picks up new environment variables.

## Sign in with OAuth

Cursor supports OAuth for remote servers, using the authorization code flow with PKCE. When the server returns a `401` with OAuth metadata and the authorization server supports Dynamic Client Registration (DCR), Cursor registers itself, offers to sign in and opens the authorization page in your browser. Marketplace entries installed with **Add to Cursor** do the same.

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

Register both if people sign in from both the desktop app and the web. With DCR, the desktop app registers both URLs and may send the web callback; set a static `CLIENT_ID` if your provider must see only the desktop URL.

Cursor renews expired access tokens with the refresh token. If your provider issues refresh tokens only for a scope such as `offline_access`, add it to `scopes`. Cursor 3.24 added a Cursor-hosted callback page for OAuth apps that reject local redirect URLs. Since 3.27, a sign-in whose refresh token has expired asks you to reconnect.

## Check that it worked

1. Open **Customize > MCPs**. The server is switched on and shows its tool count. A server that is still connecting shows "Connecting…".
2. Open the tools list at the top of the chat panel and check that the server's tools are there. You can switch single tools off by clicking their names.
3. Ask the agent for something only one of the server's tools can do. Cursor asks for approval before an MCP tool runs by default. Click the arrow next to the tool name to see the arguments it sent.

## Read the MCP Logs first

Every state below is easier to diagnose from the logs than from the indicator next to the server:

1. Open the Output panel with Cmd+Shift+U (macOS) or Ctrl+Shift+U (Windows and Linux).
2. Select **MCP Logs** in the dropdown.
3. Toggle the server off and on under **Customize > MCPs** and watch the initialization, the tool listing and any error.

## When it fails

The headings below are the labels Cursor users report on the forum. Current Cursor documentation does not list these labels, so newer builds may word them differently; the causes are the same.

### "Client Closed"

The client side of the connection ended before the server finished starting. Forum thread [65580](https://forum.cursor.com/t/65580) (2025, Cursor 0.47) shows every server marked Client Closed while the same servers worked from a terminal. Almost all reports involve stdio servers that Cursor starts as a process:

- **Windows and `npx`.** Wrap the command: `"command": "cmd", "args": ["/c", "npx", "-y", "<package>"]`. Or install the package globally and run `node` with the full path to its entry file.
- **Node.js not found.** With nvm or another version manager, Cursor may not see your shell's `PATH`. Use the absolute path from `which npx`, then restart Cursor.

For a remote URL, Client Closed usually means the request failed outright: wrong path, TLS error, or a proxy that closed the connection. Check the MCP Logs for the HTTP status, then see [MCP error -32000: Connection closed](/learn/mcp-error-connection-closed).

### Stuck on "Loading tools"

Cursor has connected but has not received a `tools/list` response. Check the MCP Logs for the last request sent. Common causes are a server that hangs after `initialize`, an SSE response that a proxy buffers until it times out, and a server that is still waiting for a session ID the client never received. A Cursor user in thread [49094](https://forum.cursor.com/t/49094) (2025, Cursor 0.45) also reported that after one tool call timed out, the server stayed broken until Cursor was restarted. Restart Cursor before you change any configuration. [MCP error -32001: Request timed out](/learn/mcp-error-request-timed-out) covers slow servers.

### "No tools found"

The logs show `Error fetching tools for server ...: Error: No tools found`, or the server is shown as running but lists nothing. Work through these in order:

1. Read the line before it. `spawn npx ENOENT` means a local server never started, so fix the command path as described above.
2. Check that the server is switched on under **Customize > MCPs**, and that its tools are not switched off in the tools list at the top of the chat panel.
3. Check whether the server needs sign-in before it lists tools. Some servers return an empty list to unauthenticated clients.
4. Check whether the server declares the `tools` capability and returns tools from `tools/list`. [MCP server connected but no tools](/learn/mcp-server-connected-but-no-tools) explains how to tell from the raw messages.

If a tool you just added to the server does not appear, toggle the server off and on.

### Sign-in opens but fails, or never completes

A redirect URL error from the provider means the OAuth app does not list Cursor's callback. Add `http://localhost:8787/callback` or switch to the static `auth` block; [invalid_redirect_uri](/learn/mcp-error-invalid-redirect-uri) explains the error. If the provider says it does not support registration, see [Does not support dynamic client registration](/learn/mcp-error-dynamic-client-registration). If the browser never opens, the server probably returned a `401` without a usable `WWW-Authenticate` header; see the [401 checklist](/learn/remote-mcp-server-401-unauthorized).

### An npm-based server keeps running an old version

Remove the server in **Customize**, run `npm cache clean --force`, and add it again.

## Verify the endpoint before you add it

Cursor's indicators show that something failed, not which request failed. Open the [MCP Playground](/), paste the endpoint and click **Connect** before you edit `mcp.json`. **Logs & Events** shows each JSON-RPC message and HTTP status in order, so you can see whether the first request, `tools/list` or the OAuth discovery is failing. A link such as `https://mcptest.io/server/mcp.example.com/mcp` opens the playground with `https://mcp.example.com/mcp` already filled in.
