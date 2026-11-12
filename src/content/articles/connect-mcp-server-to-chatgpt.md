---
title: How to connect a remote MCP server to ChatGPT
navTitle: Connect a server to ChatGPT
summary: Add a custom MCP server to ChatGPT from Plugins, understand why the option is missing on many accounts, and know when deep research needs search and fetch tools.
track: use
level: newcomer
order: 21
category: Client setup
readingTimeMinutes: 7
lastReviewed: "2026-11-11"
relatedSlugs:
  - connect-remote-mcp-server
  - mcp-clients-compared
  - mcp-client-support-matrix
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

Until recently, ChatGPT guides said to turn on **Developer mode** under the Apps settings before you could add a custom MCP server. OpenAI's current Help Center article says you no longer need Developer mode. Custom MCP servers are now created from **Plugins**, and OpenAI's pages use "plugin" and "app" for the same thing. The older app-creation path still exists as "legacy custom app configuration" for workspaces that already use it.

This guide reflects OpenAI's documentation reviewed on 11 November 2026.

## Before you start

- **A public endpoint.** Custom MCP servers in ChatGPT on the web are called from OpenAI's servers, so the endpoint must be reachable over public HTTPS, for example `https://mcp.example.com/mcp`. A server that runs only on your laptop needs a public URL or OpenAI's Secure MCP Tunnel.
- **The sign-in method.** Find out whether the server uses OAuth or no authentication. ChatGPT has no field for a fixed API key or custom header.
- **The right plan and role.** See the table below. Many accounts do not have the option at all.
- **ChatGPT on the web.** The option is not in the mobile apps.

For general endpoint checks, see [How to connect to a remote MCP server](/learn/connect-remote-mcp-server).

## Compatibility at a glance

<!-- compat-matrix clients="chatgpt" limitations="true" -->

## Why the option is missing for many users

The most common question about ChatGPT and MCP is why **Add custom MCP server** does not appear. Availability depends on your plan and your role, not on a hidden setting. The table follows OpenAI's Help Center article on custom MCP servers:

| Account | What you can do |
| --- | --- |
| Free, Go, Plus | OpenAI's article does not list these plans for custom MCP servers. Expect the option to be absent. |
| Pro | Connect custom MCP servers with read and fetch permissions only. |
| Business | Full MCP support, but only workspace admins and owners can create and publish plugins for custom servers. |
| Enterprise and Edu | Full MCP support. Admins grant the "Create plugins with MCPs" permission to selected members through role-based access control. The permission is off by default. |

If the option is missing, check these in order:

1. Your plan. Pro accounts get read and fetch only; Business, Enterprise and Edu get full MCP.
2. Your workspace role. Business members who are not admins or owners cannot create the plugin.
3. On Enterprise or Edu, whether an admin has granted you "Create plugins with MCPs" under **Workspace settings > Permissions & roles**.
4. Workspace policies such as Lockdown, which still apply to custom servers.
5. The app you are using. Custom MCP servers are web only; the mobile apps do not offer the option.

If you followed an older guide and cannot find a Developer mode toggle, that is expected.

## Add a custom MCP server

1. Open **Plugins** in ChatGPT on the web (chatgpt.com/plugins).
2. Select the plus button, then **Add custom MCP server**.
3. Enter a name and, optionally, a description.
4. Under **Connection**, enter the server's public HTTPS MCP endpoint, for example `https://mcp.example.com/mcp`. For a private server, choose **Tunnel** and select a Secure MCP Tunnel from the list or enter its `tunnel_id`.
5. Choose the authentication mode: **OAuth**, **No authentication**, or **OAuth or no authentication**. The mixed mode sends initialization and tool listing without credentials and applies OAuth per tool according to each tool's security scheme.
6. Read the risk warning and select **I understand and want to continue**.
7. Select **Create as a plugin** and review the tools ChatGPT discovered.
8. Install the plugin from your personal plugins, or from the workspace if an admin published it.
9. In a conversation, type `@` in the prompt box and select the plugin.

ChatGPT supports Streamable HTTP and SSE; OpenAI recommends Streamable HTTP, usually at `/mcp`. For OAuth, ChatGPT uses static client credentials if you supply them. Otherwise it uses a Client ID Metadata Document (CIMD) when the authorization server advertises support and the plugin's creator chooses CIMD, or Dynamic Client Registration (DCR) when that is configured. See the [glossary](/learn/mcp-glossary#dynamic-client-registration) for these terms.

### The tool list is a snapshot

ChatGPT stores the tool list it discovered when the plugin was created. When the server's tools change, open the connection in **Plugins**, select **Refresh**, and start a new conversation. For published plugins, OpenAI says tool updates go through continuous review. Any tool without `readOnlyHint` is treated as a write action, and write actions ask for confirmation by default.

## Check that it worked

1. After **Create as a plugin**, check that the list of discovered tools matches what the server should offer.
2. In a new conversation, type `@`, select the plugin, and ask for something only one of its tools can answer.
3. Expand the tool call in the reply. ChatGPT shows the full JSON input and output of each call. A plausible answer with no tool call does not prove the connection works.

## Deep research and company knowledge servers

OpenAI's Help Center now says `search` and `fetch` tools are no longer required for a custom server. They still matter for two features:

- **Deep research** uses read and fetch actions only, never write actions.
- **Company knowledge** supports custom servers with fetch and search access.

OpenAI's server-building guide still recommends that such servers implement two read-only tools. `search` returns an object with a single `results` key, a list of items with `id`, `title` and `url`. `fetch` takes an `id` and returns `id`, `title`, `text`, `url` and optional `metadata`. Return the data in `structuredContent` and as JSON text in `content`. ChatGPT only creates a citation when `url` is a non-empty string, so a server without URLs works but produces answers without sources.

## Codex

Codex is configured separately from ChatGPT on the web. OpenAI's documentation says the ChatGPT desktop app, the Codex CLI and the Codex IDE extension share one MCP configuration in `~/.codex/config.toml`. They connect from your own machine, so they can reach local and private servers that ChatGPT on the web cannot. The short version is:

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

ChatGPT must reach the endpoint from OpenAI's servers within its timeout. Causes reported on OpenAI's community forum include endpoints behind tunnels or CDNs that buffer or delay the response, and servers that answer `initialize` but stall on `tools/list`. Test the same URL from outside your network. If you use a tunnel, OpenAI says to check its workspace association and the `tunnel-client` status.

### OAuth sign-in fails or loops

The server's `401` challenge or metadata is usually the cause. Confirm that:

- the `401` carries a `WWW-Authenticate` header with `resource_metadata`,
- the authorization server metadata is reachable and lists `S256` in `code_challenge_methods_supported`,
- tokens are issued for the MCP server's URL.

Request `offline_access` if the server should keep working after the access token expires. The [401 checklist](/learn/remote-mcp-server-401-unauthorized) walks through each step, and [Failed to discover OAuth metadata](/learn/mcp-error-failed-to-discover-oauth-metadata) covers discovery errors.

### The plugin is installed but ChatGPT uses none of its tools

Check that you selected the plugin with `@` in the conversation. Then check whether the tools you expect were added after the plugin was created; use **Refresh** in **Plugins** and start a new conversation. If the plugin shows no tools at all, see [MCP server connected but no tools](/learn/mcp-server-connected-but-no-tools).

## Verify the endpoint before you add it

ChatGPT shows little detail when creation fails. Open the [MCP Playground](/), paste the endpoint and click **Connect** before you create the plugin. **Logs & Events** shows the `401` challenge, each OAuth discovery request and the tool list that ChatGPT will scan. For OAuth problems, the [MCP OAuth checker](/tools/oauth-check) tests each discovery step without signing in. A link such as `https://mcptest.io/server/mcp.example.com/mcp` opens the playground with `https://mcp.example.com/mcp` already filled in.
