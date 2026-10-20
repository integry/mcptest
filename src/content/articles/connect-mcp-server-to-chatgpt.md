---
title: How to connect a remote MCP server to ChatGPT
navTitle: Connect a server to ChatGPT
summary: Add a custom MCP server to ChatGPT from Plugins, understand why the option is missing on many accounts, and know when deep research needs search and fetch tools.
track: use
level: newcomer
order: 21
category: Client setup
readingTimeMinutes: 6
lastReviewed: "2026-10-20"
relatedSlugs:
  - connect-remote-mcp-server
  - mcp-clients-compared
  - connect-mcp-server-to-windsurf-gemini-cli-and-codex
  - remote-mcp-server-401-unauthorized
sourceLinks:
  - title: "OpenAI Help Center: Connecting custom MCP servers in ChatGPT"
    url: "https://help.openai.com/en/articles/12584461"
  - title: "OpenAI: Add custom MCP server"
    url: "https://developers.openai.com/api/docs/guides/custom-mcp-server"
  - title: "OpenAI: Connect and test your plugin"
    url: "https://developers.openai.com/plugins/deploy/connect-chatgpt"
  - title: "OpenAI: Building MCP servers for plugins and API integrations"
    url: "https://developers.openai.com/api/docs/mcp"
  - title: "ChatGPT Learn: Model Context Protocol in Codex"
    url: "https://learn.chatgpt.com/docs/extend/mcp?surface=cli"
---
## What changed in 2026

Until recently, ChatGPT guides said to turn on **Developer mode** under the Apps settings before a custom MCP server could be added. OpenAI's current Help Center article says you no longer need Developer mode. Custom MCP servers are now created from **Plugins**, and OpenAI's pages use "plugin" and "app" for the same thing. The older app-creation path still exists as "legacy custom app configuration" for workspaces that already use it.

This guide reflects OpenAI's documentation reviewed on 20 October 2026. ChatGPT only connects to remote servers. A server that runs only on your laptop needs a public HTTPS endpoint or OpenAI's Secure MCP Tunnel. For general endpoint checks, see [How to connect to a remote MCP server](/learn/connect-remote-mcp-server).

## Compatibility at a glance

<!-- compat-matrix clients="chatgpt" limitations="true" -->

## Why the option is missing for many users

The most common question about ChatGPT and MCP is why **Add custom MCP server** does not appear. Availability depends on your plan and your role, not on a hidden setting:

| Account | What you can do |
| --- | --- |
| Free, Go, Plus | OpenAI's article does not list these plans for custom MCP servers. Expect the option to be absent. |
| Pro | Connect custom MCP servers with read and fetch permissions only. |
| Business | Full MCP support, but only workspace admins and owners can create and publish plugins for custom servers. |
| Enterprise and Edu | Full MCP support. Admins grant the "Create plugins with MCPs" permission to selected members through role-based access control. |

If the option is missing, check these in order:

1. Your plan. Pro accounts get read and fetch only; Business, Enterprise and Edu get full MCP.
2. Your workspace role. Business members who are not admins or owners cannot create the plugin. Your role is shown under **Workspace settings > Members**.
3. On Enterprise or Edu, whether an admin has granted you "Create plugins with MCPs".
4. Workspace policies such as Lockdown, which still apply to custom servers.
5. The app you are using. Custom MCP servers are web only; the mobile apps do not offer the option.

OpenAI states there are no regional restrictions, so a VPN will not change the result. If you followed an older guide and cannot find a Developer mode toggle, that is expected.

## Add a custom MCP server

1. Open **Plugins** in ChatGPT on the web (chatgpt.com/plugins).
2. Select the plus button, then **Add custom MCP server**.
3. Enter a name and, optionally, a description.
4. Under **Connection**, enter the server's public HTTPS MCP endpoint, for example `https://mcp.example.com/mcp`. For a private server, choose **Tunnel** and select a Secure MCP Tunnel.
5. Choose the authentication mode: **OAuth**, **No authentication**, or **OAuth or no authentication**. The mixed mode sends initialization and tool listing without credentials and applies OAuth per tool according to each tool's security scheme.
6. Read the risk warning and select **I understand and want to continue**.
7. Select **Create as a plugin** and review the tools ChatGPT discovered.
8. Install the plugin from your personal plugins, or from the workspace if an admin published it, and enable it in a conversation.

ChatGPT supports Streamable HTTP and SSE; OpenAI recommends Streamable HTTP, usually at `/mcp`. For OAuth, ChatGPT uses static client credentials if you supply them. Otherwise it uses a Client ID Metadata Document when the authorization server advertises support, or Dynamic Client Registration when that is configured.

### The tool list is a snapshot

After a plugin is published, its tools are frozen. Tools the server adds later are disabled by default. An admin must open the plugin's details in workspace settings, use **Refresh**, and enable the new tools. Any tool without `readOnlyHint` is treated as a write action and asks for confirmation by default.

## Deep research and company knowledge servers

OpenAI's Help Center now says `search` and `fetch` tools are no longer required for a custom server. They still matter for two features:

- **Deep research** uses read and fetch actions only, never write actions.
- **Company knowledge** supports custom servers with fetch and search access.

OpenAI's server-building guide still recommends that such servers implement two read-only tools. `search` returns results with `id`, `title` and `url`. `fetch` takes an `id` and returns `id`, `title`, `text`, `url` and optional `metadata`. Return the data in `structuredContent` and as JSON text in `content`. ChatGPT only creates a citation when `url` is a non-empty string, so a server without URLs works but produces answers without sources.

## Codex

Codex (CLI, IDE extension and desktop app) is configured separately from ChatGPT. It reads `~/.codex/config.toml` and connects from your own machine, so it can reach servers ChatGPT cannot. The short version is:

```bash
codex mcp add example --url https://mcp.example.com/mcp
codex mcp login example
```

The full setup, config keys and failure modes are in [Connect an MCP server to Windsurf, Gemini CLI and Codex](/learn/connect-mcp-server-to-windsurf-gemini-cli-and-codex#codex).

## When it fails

### "Add custom MCP server" is not there

This is a plan, role or policy issue, as covered in the checklist above. Ask a workspace admin which applies. On Business, the admin can create the plugin and publish it to the workspace for you.

### "Connector is not safe" or "This MCP Server violates our guidelines"

ChatGPT reviews the server's tool metadata when you create the plugin. Developers on OpenAI's community forum report rejections when tool names or descriptions suggest arbitrary code execution, contain personal data, or include phrases such as "no authentication". Some also report rejections when OAuth endpoints are not served over HTTPS. Rewrite descriptions to state plainly what each tool does, then create the plugin again.

### Creation times out or fails with "Error creating connector"

ChatGPT must reach the endpoint from OpenAI's servers within its timeout. Reported causes include endpoints behind tunnels or CDNs that buffer or delay the response, and servers that answer `initialize` but stall on `tools/list`. Test the same URL from outside your network. If you use a tunnel, OpenAI says to check its workspace association and the `tunnel-client` status.

### OAuth sign-in fails or loops

The server's `401` challenge or metadata is usually the cause. Confirm that the `401` carries a `WWW-Authenticate` header with `resource_metadata`, that the authorization server metadata is reachable, and that tokens are issued for the MCP server's URL. Request `offline_access` if the server should keep working after the access token expires. The [401 checklist](/learn/remote-mcp-server-401-unauthorized) walks through each step.

### The plugin is installed but ChatGPT uses none of its tools

Check that the plugin is enabled in the conversation. Then check whether the tools you expect were added after publishing, because new tools stay disabled until an admin refreshes them. If the plugin shows no tools at all, see [MCP server connected but no tools](/learn/mcp-server-connected-but-no-tools).

## Verify the endpoint before you add it

ChatGPT shows little detail when creation fails, and a failed attempt can leave a draft behind. Open the [MCP Playground](/), paste the endpoint and connect before you create the plugin. The playground shows the `401` challenge, each OAuth discovery request and the exact tool list that ChatGPT will scan. A link of the form `https://mcptest.io/server/<your endpoint URL>` opens the playground with the server already filled in.
