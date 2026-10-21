---
title: How to connect a remote MCP server to JetBrains AI Assistant
navTitle: Connect a server to JetBrains AI
summary: Add a remote MCP server to AI Assistant in IntelliJ IDEA, PyCharm, and the other JetBrains IDEs, work around the missing OAuth and header support with a tested mcp-remote bridge, and tell AI Assistant apart from Junie and the IDE's own MCP server.
track: use
level: practitioner
order: 31
category: Client setup
readingTimeMinutes: 5
lastReviewed: "2026-10-21"
metaTitle: Connect a Remote MCP Server to JetBrains AI Assistant | mcptest.io
metaDescription: How to add a remote MCP server to JetBrains AI Assistant. The HTTP and STDIO JSON formats, server level, status and logs, and an mcp-remote bridge for servers that need OAuth or an API key.
relatedSlugs:
  - connect-remote-mcp-server
  - mcp-clients-compared
  - connect-mcp-server-to-zed
  - mcp-server-authentication-patterns
  - remote-mcp-server-401-unauthorized
sourceLinks:
  - title: "AI Assistant docs: Model Context Protocol (MCP)"
    url: "https://www.jetbrains.com/help/ai-assistant/mcp.html"
  - title: "AI Assistant docs: MCP settings reference"
    url: "https://www.jetbrains.com/help/ai-assistant/settings-reference-mcp.html"
  - title: "YouTrack LLM-25012: OAuth2 Authentication for MCP Server Connections"
    url: "https://youtrack.jetbrains.com/issue/LLM-25012"
  - title: "YouTrack LLM-24541: AI Assistant MCP doesn't provide HTTP authentication"
    url: "https://youtrack.jetbrains.com/issue/LLM-24541"
  - title: "Junie docs: MCP settings"
    url: "https://junie.jetbrains.com/docs/junie-plugin-mcp-settings.html"
  - title: mcp-remote
    url: "https://github.com/geelen/mcp-remote"
---

AI Assistant, the chat and agent plugin in IntelliJ IDEA, PyCharm, WebStorm, and the other JetBrains IDEs, is an MCP client. It connects to remote servers over Streamable HTTP or the legacy SSE transport, and to local servers over stdio. It does not yet sign in to servers that use OAuth, and its documentation does not describe sending custom headers, so many hosted servers need a small bridge. This guide reflects the AI Assistant 2026.2 documentation and the YouTrack tracker as of 21 October 2026; the latest stable IDE release was 2026.2.3.

## Three MCP features with similar names

JetBrains ships three separate MCP features. They are configured in different places, so check which one you mean:

| Feature | What it is | Where it is configured |
| --- | --- | --- |
| **AI Assistant MCP client** | AI Assistant calls tools on servers you add | **Settings → Tools → AI Assistant → Model Context Protocol (MCP)**; this guide |
| **Junie MCP client** | JetBrains' coding agent calls tools on servers you add | `.junie/mcp/mcp.json` in the project or `~/.junie/mcp/mcp.json`; Junie documents `headers` and OAuth |
| **The IDE's MCP server** | The IDE exposes its own tools to outside clients such as Claude Code | **Settings → Tools → MCP Server**, built in since 2025.2 |

A server added to AI Assistant is not available to Junie, and the reverse is also true.

## Check your version

Native remote transports arrived in 2025.3. The 2025.2 documentation says AI Assistant supported only stdio and suggested `mcp-remote` for remote servers. On 2025.2 or earlier, use the bridge described below for every remote server, or update the IDE.

## Add a server that needs no sign-in

1. Open **Settings → Tools → AI Assistant → Model Context Protocol (MCP)**. You can also type `/` in the AI chat and choose **Add Command**.
2. Click **Add**. The **New MCP Server** dialog has an **HTTP** tab and a **STDIO** tab.
3. On the **HTTP** tab, paste the configuration. The URL must be the endpoint that implements Streamable HTTP, including its path:

   ```json
   {
     "mcpServers": {
       "orders": {
         "url": "https://mcp.example.com/mcp"
       }
     }
   }
   ```

   For a legacy SSE server, use its SSE URL, usually ending in `/sse`, in the same format.

4. Choose the **Server level**: global, for every project, or the current project only. You can change it later in the **Level** column.
5. Click **OK**, then **Apply**. Applying starts the connection.

If you already use Claude Desktop, **Import from Claude** copies its configured servers into the table.

## Check that it connected

The **Status** column shows the connection state. When it is connected, click the icon in that column to see the tools the server offers. Turn on **Automatically enable new and changed MCP servers** if you want new and edited entries to start without an extra step.

To stop a server, clear its checkbox and click **Apply**; to retry a failed connection, use **Reconnect**. For details, open **Help → Show Log in Finder** on macOS or **Show Log in Explorer** on Windows, then the `mcp` folder, which has one log per configured server.

AI Assistant calls MCP tools on its own when a request needs them. You can also call a tool explicitly by typing `/` in the chat and choosing its command. The Claude Agent and Codex agents inside AI Assistant only see these servers when **Pass custom MCP servers** is enabled for them, and their MCP tools do not appear in the `/` menu.

## Servers that need OAuth or an API key

Two open YouTrack issues define the gap:

- **LLM-25012**, "OAuth2 Authentication for MCP Server Connections", is an open feature request. AI Assistant does not run the MCP OAuth flow.
- **LLM-24541**, "AI Assistant MCP doesn't provide HTTP authentication (401 without an authentication link)", is an open bug. A server that answers `401` simply fails to connect. Reports such as LLM-30889, "Expected status code 200 but was 405" against a hosted Streamable HTTP endpoint, were closed as duplicates of it.

The documentation shows no `headers` field for HTTP servers, so do not rely on one. The dependable route is the `mcp-remote` bridge on the **STDIO** tab. AI Assistant starts it as a local process; `mcp-remote` talks Streamable HTTP to the server and handles authentication.

### OAuth servers

```json
{
  "mcpServers": {
    "orders": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.example.com/mcp"]
    }
  }
}
```

On first connection, `mcp-remote` opens your browser for the server's sign-in and stores the tokens under `~/.mcp-auth`. If the browser never opens, read the server's `mcp` log in the IDE; the server may not return a usable `401` challenge, which the [401 checklist](/learn/remote-mcp-server-401-unauthorized) covers.

### API key servers

```json
{
  "mcpServers": {
    "orders": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.example.com/mcp", "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer <your API key>" }
    }
  }
}
```

`mcp-remote` expands `${AUTH_HEADER}` from its environment. Keeping the space inside the environment value, not in `args`, avoids clients that split arguments on spaces. This configuration was tested with `mcp-remote` 0.15.2 against a server that requires a bearer key: the bridge answered `initialize` and returned the result of an authenticated `tools/call`. `mcp-remote` also has `--header-file` if you prefer not to put the key in the IDE's settings at all.

The bridge needs Node.js. If AI Assistant cannot start `npx`, use its absolute path from `which npx`; IDEs launched from the dock do not always inherit your shell's `PATH`.

## When it fails

### The Status column shows an error for an HTTP server

Check the URL path first: `https://mcp.example.com` and `https://mcp.example.com/mcp` are different endpoints, and the configuration needs the one that implements Streamable HTTP. Then check the server's `mcp` log for the HTTP status. A `401` means the server needs authentication: use the bridge. A `405` from a hosted server can have the same cause; LLM-30889 reported exactly that and was closed as a duplicate of the authentication bug. Connect to the URL in the playground to see which status the first `POST` really gets.

### A local Streamable HTTP server will not connect

LLM-24589 reports AI Assistant failing to connect to a Streamable HTTP server on `localhost` that other clients reach. Until it is fixed, run that server over stdio, or put `mcp-remote` in front of it; `mcp-remote` accepts plain `http://` URLs on localhost without extra flags.

### Connected, but no tools

Open the tool list from the Status column. If it is empty, the server may list tools only after sign-in, or it may not declare the `tools` capability. [MCP server connected but no tools](/learn/mcp-server-connected-but-no-tools) shows how to tell from the raw messages.

## Test the endpoint first

AI Assistant's status shows that a connection failed, not why. Open the [MCP Playground](/), paste the endpoint, and connect. The log shows the exact status of each request, so you can see before you touch the IDE whether the server needs OAuth, a header, or a different path.
