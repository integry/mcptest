---
title: How to connect a remote MCP server to VS Code
navTitle: Connect a server to VS Code
summary: Add a remote HTTP MCP server for GitHub Copilot in VS Code in the Copilot mcpServers format or the older .vscode/mcp.json, complete OAuth, and fix the sign-in that never starts.
track: use
level: practitioner
order: 23
category: Client setup
readingTimeMinutes: 7
lastReviewed: "2026-11-11"
relatedSlugs:
  - connect-remote-mcp-server
  - mcp-clients-compared
  - mcp-client-support-matrix
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
  - title: "VS Code: Move from the Local to the Copilot harness"
    url: "https://code.visualstudio.com/docs/agents/run/move-to-copilot"
  - title: "VS Code 1.146 release notes"
    url: "https://code.visualstudio.com/updates/v1_146"
  - title: "VS Code extension guide: MCP developer guide (authorization)"
    url: "https://code.visualstudio.com/api/extension-guides/ai/mcp"
  - title: "microsoft/vscode#341574: Agent Host chats never start OAuth sign-in for remote HTTP MCP servers"
    url: "https://github.com/microsoft/vscode/issues/341574"
---
## Before you start

This guide reflects VS Code 1.146 (11 November 2026) and the MCP documentation approved on the same day. Two changes since mid-2026 decide which steps apply to you:

- **The Copilot harness is the default.** Since VS Code 1.143, new chat sessions run on the Copilot harness, the shared Copilot runtime (Copilot SDK). You can see and change it in the **Session Target** picker of a chat.
- **The Local harness is deprecated.** VS Code 1.146 deprecated the older, editor-specific Local harness and will remove it in February 2027. The `.vscode/mcp.json` format belongs to it.

You also need:

- **The exact MCP endpoint**, including its path, for example `https://mcp.example.com/mcp`.
- **The sign-in method**: OAuth, a fixed API key or header, or no authentication.
- **GitHub Copilot access** in VS Code. Organization policy can block MCP servers.

For the general checks on an endpoint before you configure it, see [How to connect to a remote MCP server](/learn/connect-remote-mcp-server).

## Compatibility at a glance

<!-- compat-matrix clients="vscode-copilot" limitations="true" -->

## Which configuration format to use

VS Code reads two configuration formats:

| Format | Files | Top-level key | Status |
| --- | --- | --- | --- |
| Copilot format | `~/.copilot/mcp-config.json` (or `$COPILOT_HOME/mcp-config.json`) for you, `.mcp.json` at the workspace root for the team | `mcpServers` | Read directly by the Copilot harness. Use it for new servers. |
| VS Code editor format | `.vscode/mcp.json` in the workspace, or `mcp.json` in your user profile | `servers` | For the deprecated Local harness. Eligible entries are forwarded to Copilot sessions. |

The user file `~/.copilot/mcp-config.json` is the same file Copilot CLI reads, so a server you add there also works in [Copilot CLI](/learn/connect-mcp-server-to-github-copilot-cli-and-coding-agent). The guided flow offers workspace-root `.mcp.json` only when the experimental setting `chat.mcp.workspaceRootConfig.enabled` is on; existing `.mcp.json` files are read either way.

## Add a remote HTTP server

### With the guided command

1. In a chat with **Copilot** selected as the session target, run **Chat: Open Customizations** from the Command Palette and select **MCP Servers**. You can also run **MCP: Add Server** directly.
2. Select **Add Server** (**+**) in the **User** group.
3. Choose **HTTP (HTTP or Server-Sent Events)** and enter the endpoint URL, for example `https://mcp.example.com/mcp`.
4. Enter a unique server ID without spaces, for example `example`.
5. Select **Global**, then **Copilot Global**. This writes `~/.copilot/mcp-config.json`.
6. Review any trust request before you accept it.

### By editing the configuration file

Open `~/.copilot/mcp-config.json`, or `.mcp.json` at the workspace root to share the server with your team, and add the server under `mcpServers`:

```json
{
  "mcpServers": {
    "example": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "tools": ["*"]
    }
  }
}
```

`type` is `http` for Streamable HTTP or `sse` for a legacy SSE endpoint. `tools` lists the tools to make available; `["*"]` means all of them.

For a server with a fixed API key, reference an environment variable in the header so the key stays out of the file. Use the braced `${NAME}` form:

```json
{
  "mcpServers": {
    "example": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "tools": ["*"],
      "headers": {
        "Authorization": "Bearer ${EXAMPLE_TOKEN}"
      }
    }
  }
}
```

Set `EXAMPLE_TOKEN` in the environment where the harness runs, then restart VS Code from that environment. For remote and Dev Container sessions, that is the remote host or container. The Copilot format has no input prompts and no `envFile`.

### Older `.vscode/mcp.json` configurations

Many published server docs still show the editor format. It keeps working for now:

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

In this format, an `http` entry tries Streamable HTTP first and falls back to SSE, and environment variables are written `${env:NAME}`. Entries that use `${input:...}` or `${command:...}` are **not** forwarded to Copilot harness sessions, so a server configured like the example above works only in Local sessions. To use it in default sessions, move it to the Copilot format with an environment variable as shown earlier. **MCP: Open Workspace Folder MCP Configuration**, **MCP: Open User Configuration** and `code --add-mcp` all write this older format.

### Trust and start

Workspace `.vscode/mcp.json` and `.mcp.json` follow Workspace Trust: in Restricted Mode these servers do not start, and in a trusted workspace they start without a separate MCP trust prompt. To start, stop or inspect a server, open **Chat: Open Customizations > MCP Servers** and use the server's **...** menu, or run **MCP: List Servers**.

## Sign in with OAuth

VS Code has built-in sign-in for GitHub and Microsoft Entra ID. For other providers it follows the MCP authorization flow and registers itself with Dynamic Client Registration, or uses a pre-registered client. When a server needs sign-in, its actions in **MCP Servers** include **Authenticate**.

If the provider requires a pre-registered client, set its client ID. In the Copilot format the field is the flat `oauthClientId`:

```json
{
  "mcpServers": {
    "example": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "tools": ["*"],
      "oauthClientId": "your-client-id"
    }
  }
}
```

In the older editor format the same setting is a nested object, `"oauth": { "clientId": "your-client-id" }`.

When you register an app with a provider, add both redirect URIs: `http://127.0.0.1:33418` and `https://vscode.dev/redirect`. [VS Code MCP OAuth redirect URIs](/learn/vscode-mcp-oauth-redirect-uris) covers this in detail.

## Check that it worked

1. Open **Chat: Open Customizations > MCP Servers** and check that the server is running and does not offer **Authenticate**. In a Copilot session, `/mcp show example` shows the same.
2. Open the **Tools** tab in the Agent Customizations editor and check that the server's tools are enabled. In a Local session, use **Configure Tools** in the chat input.
3. Ask for a low-impact task that needs the server, then expand the tool call in the reply. A plausible answer without a tool call does not prove the connection works.
4. If something is off, choose **Show Output** from the server's **...** menu to read its output channel.

VS Code allows at most 128 enabled tools in a chat request. Above that, deselect tools or whole servers, or adjust `github.copilot.chat.virtualTools.threshold`. In VS Code's own words, a running server does not guarantee that its tools are available to the current session.

## When it fails

### The OAuth sign-in never starts

The server shows as needing authentication, but no browser window, consent prompt or Accounts entry ever appears. The output shows `MCP server "<server>" still requires authentication`.

The most likely cause is [microsoft/vscode#341574](https://github.com/microsoft/vscode/issues/341574), still open on 11 November 2026. In sessions on the Copilot harness (the reporter's logs call it the Agent Host), the transport closes when it receives the OAuth challenge and never passes the authorization URL back to VS Code. The same server signs in normally in a Local session. Until the issue is fixed, and only if your organization allows it, start a new session and select **Local** under **Session Target**, then sign in. This stops working when the Local harness is removed in February 2027.

If that does not apply, check the server side. A bare `401` with no `WWW-Authenticate: Bearer resource_metadata="..."` header and no protected resource metadata at the well-known path gives a client nothing to discover; see [Failed to discover OAuth metadata](/learn/mcp-error-failed-to-discover-oauth-metadata). Then check that the organization's `chat.mcp.access` policy or GitHub enterprise MCP allowlist is not blocking the server.

### Sign-in loops or uses the wrong client

A stale registration from an earlier attempt can be reused. Run **Authentication: Remove Dynamic Authentication Providers**, which discards the client ID issued to VS Code, then restart the server and sign in again.

### The provider rejects the redirect URI

The OAuth app is missing one of VS Code's redirect URIs. Register both `http://127.0.0.1:33418` and `https://vscode.dev/redirect` exactly. See [VS Code MCP OAuth redirect URIs](/learn/vscode-mcp-oauth-redirect-uris) and [invalid_redirect_uri](/learn/mcp-error-invalid-redirect-uri).

### The server is running but chat sees no tools

Check the **Tools** tab first, then the 128-tool limit, then whether the server is defined in `.vscode/mcp.json` with `inputs`, which keeps it out of Copilot sessions. If **Show Output** shows an empty tool list, follow [MCP server connected but no tools](/learn/mcp-server-connected-but-no-tools).

### Signed in, but every request still returns 401

The token was issued but the server rejects it, usually because its audience does not match the MCP server's URL or it lacks a scope. The [401 checklist](/learn/remote-mcp-server-401-unauthorized) covers each cause.

## Verify the endpoint before you add it

When VS Code stays in "needs authentication", the fault can be the server or the client. Open the [MCP Playground](/), paste the endpoint and click **Connect** before you add it. If the playground completes OAuth and lists tools, the server is fine and the problem is in VS Code. A link such as `https://mcptest.io/server/mcp.example.com/mcp` opens the playground with `https://mcp.example.com/mcp` already filled in.
