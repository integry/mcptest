---
title: How to connect a remote MCP server to VS Code
navTitle: Connect a server to VS Code
summary: Add a remote HTTP MCP server for GitHub Copilot in VS Code at workspace or user level, complete OAuth, and fix the sign-in that never starts.
track: use
level: practitioner
order: 23
category: Client setup
readingTimeMinutes: 5
lastReviewed: "2026-10-20"
relatedSlugs:
  - connect-remote-mcp-server
  - mcp-clients-compared
  - remote-mcp-server-401-unauthorized
  - mcp-server-connected-but-no-tools
sourceLinks:
  - title: "VS Code: Add MCP servers in VS Code"
    url: "https://code.visualstudio.com/docs/agent-customization/mcp-servers"
  - title: "VS Code: MCP configuration reference"
    url: "https://code.visualstudio.com/docs/agents/reference/mcp-configuration"
  - title: "VS Code: Manage MCP servers"
    url: "https://code.visualstudio.com/docs/agents/run/manage-mcp-servers"
  - title: "VS Code: Tools in chat"
    url: "https://code.visualstudio.com/docs/agents/run/tools"
  - title: "VS Code extension guide: MCP developer guide (authorization)"
    url: "https://code.visualstudio.com/api/extension-guides/ai/mcp"
  - title: "microsoft/vscode#341574: Agent Host chats never start OAuth sign-in for remote HTTP MCP servers"
    url: "https://github.com/microsoft/vscode/issues/341574"
---
## Which configuration format to use

This guide reflects VS Code 1.142 (14 October 2026) and the MCP documentation dated 14 to 16 October 2026. VS Code now supports two configuration formats, and the difference matters:

| Format | Files | Top-level key |
| --- | --- | --- |
| VS Code format | `.vscode/mcp.json` in the workspace, or `mcp.json` in your user profile | `servers` |
| Portable Copilot format | `.mcp.json` at the workspace root, or `~/.copilot/mcp-config.json` | `mcpServers` |

The **MCP: Add Server** flow now labels the VS Code format destinations as deprecated, kept for compatibility. They still work, and they are the only format that supports `inputs` prompts for secrets. Servers that need input prompts are not forwarded to Copilot harness sessions, which is one reason a server can work in one chat and not another. The workspace `.mcp.json` option only appears when the experimental setting `chat.mcp.workspaceRootConfig.enabled` is on. The examples below use the VS Code format because it is what most published server docs show.

For the general checks on an endpoint before you configure it, see [How to connect to a remote MCP server](/learn/connect-remote-mcp-server).

## Add a remote HTTP server

### With the guided command

1. Open the Command Palette and run **MCP: Add Server**.
2. Choose **HTTP (HTTP or Server-Sent Events)**.
3. Enter the endpoint URL, for example `https://mcp.example.com/mcp`, and a server name.
4. Choose where to save it: the workspace or your user profile.

### By editing mcp.json

1. Run **MCP: Open Workspace Folder MCP Configuration** for `.vscode/mcp.json`, or **MCP: Open User Configuration** for a server available in every workspace.
2. Add an entry with `type` set to `http`:

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

3. Save the file. VS Code tries Streamable HTTP first and falls back to SSE. Set `"type": "sse"` only if the server supports nothing else.

For a server with a fixed API key, use an input so the secret is prompted for once and stored securely instead of committed:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "example-token",
      "description": "Example API token",
      "password": true
    }
  ],
  "servers": {
    "example": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${input:example-token}"
      }
    }
  }
}
```

### Trust and start

Servers in `.vscode/mcp.json` follow Workspace Trust; in Restricted Mode they do not start. Other sources may ask you to trust the server on first start or after a configuration change. Run **MCP: List Servers** and select the server to start, stop, restart or show its output. The experimental `chat.mcp.autostart` setting controls whether new or changed servers start automatically, and it skips servers that are disabled or in an error state.

## Sign in with OAuth

VS Code has built-in sign-in for GitHub and Microsoft Entra. For other providers it reads the server's `401` challenge, discovers the authorization server and tries Dynamic Client Registration. If the provider does not support it, VS Code asks for a client ID and client secret. You can also set the client ID in the config:

```json
{
  "servers": {
    "example": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "oauth": {
        "clientId": "your-client-id"
      }
    }
  }
}
```

When you register an app with a provider, add both redirect URIs: `http://127.0.0.1:33418` and `https://vscode.dev/redirect`. The account then appears in the Accounts menu, where **Manage Trusted MCP Servers** controls which servers may use it and where you can sign out.

## Pick the server's tools in chat

In agent mode, open the tools picker with **Configure Tools** and check that the server's tools are selected. VS Code allows at most 128 tools in a chat request. Above that, deselect tools or whole servers, or adjust `github.copilot.chat.virtualTools.threshold`. In VS Code's own words, a running server does not guarantee that its tools are available to the current session.

## When it fails

### The OAuth sign-in never starts

The server shows as needing authentication, but no browser window, consent prompt or Accounts entry ever appears. The output shows `MCP server "<server>" still requires authentication`.

As of VS Code 1.141 and 1.142, the most likely cause is [microsoft/vscode#341574](https://github.com/microsoft/vscode/issues/341574). New chats default to the Agent Host (Copilot SDK) harness. Its transport closes when it receives the OAuth challenge and never passes the authorization URL back to VS Code. The same server signs in normally from the local agent. Until the issue is fixed, the reporter's workaround is to prefer the local agent in your user settings:

```json
{
  "chat.defaultToCopilotHarness": false,
  "chat.editor.preferCopilotHarness": false,
  "chat.editor.localAgent.enabled": true
}
```

Restart VS Code and open a new chat. This is a community workaround from the issue, not official guidance; remove it once the issue is closed.

If the workaround does not apply, check the server side. VS Code can only start sign-in from a `401` with `WWW-Authenticate: Bearer resource_metadata="..."` or a protected resource metadata document at the well-known path. A bare `401` with no header gives it nothing to discover. Then check that the organization's `chat.mcp.access` policy or GitHub enterprise MCP allowlist is not blocking the server.

### Sign-in loops or uses the wrong client

A stale registration from an earlier attempt can be reused. Run **Authentication: Remove Dynamic Authentication Providers**, which discards the client ID issued to VS Code, then restart the server and sign in again.

### The provider rejects the redirect URI

The OAuth app is missing one of VS Code's redirect URIs. Register both `http://127.0.0.1:33418` and `https://vscode.dev/redirect` exactly.

### The server is running but chat sees no tools

Check the tools picker first, then the 128-tool limit, then whether the session is a Copilot harness session and the server uses `inputs`. If **Show Output** shows an empty tool list, follow [MCP server connected but no tools](/learn/mcp-server-connected-but-no-tools).

### Signed in, but every request still returns 401

The token was issued but the server rejects it, usually because its audience does not match the MCP server's URL or it lacks a scope. The [401 checklist](/learn/remote-mcp-server-401-unauthorized) covers each cause.

## Verify the endpoint before you add it

When VS Code stays in "needs authentication", the fault can be the server or the client. Open the [MCP Playground](/), paste the endpoint and connect before you add it. If the playground completes OAuth and lists tools, the server is fine and the problem is in VS Code. A link of the form `https://mcptest.io/server/<your endpoint URL>` opens the playground with the server already filled in.
