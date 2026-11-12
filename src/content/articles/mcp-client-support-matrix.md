---
title: Which clients support remote MCP servers
navTitle: Client support matrix
summary: Which MCP clients connect to remote servers, over which transports, with which OAuth registration and static credentials, and what each one cannot do, with a verification date on every row.
track: reference
level: practitioner
order: 25
category: Clients and compatibility
readingTimeMinutes: 9
lastReviewed: "2026-10-20"
metaTitle: "Which Clients Support Remote MCP? ChatGPT, Claude, Cursor, VS Code Compared | mcptest.io"
metaDescription: "Which clients support remote MCP servers: transports, protocol versions, OAuth (DCR, CIMD, client ID), headers and known limits for ChatGPT, Claude, Cursor, VS Code, Codex, Gemini CLI and Windsurf."
relatedSlugs:
  - mcp-clients-compared
  - connect-remote-mcp-server
  - mcp-oauth-2-1-reference
  - mcp-protocol-versions-explained
sourceLinks:
  - title: "mcptest client compatibility data (clientCompatibility.json)"
    url: "https://github.com/integry/mcptest/blob/master/src/data/clientCompatibility.json"
  - title: "mcptest: Host compatibility engine"
    url: "https://github.com/integry/mcptest/blob/master/docs/host-compatibility-engine.md"
  - title: "Claude docs: Add a connector that isn't in the directory"
    url: "https://claude.com/docs/connectors/custom/add-unlisted"
  - title: "Claude Code: Connect to tools via MCP"
    url: "https://code.claude.com/docs/en/mcp"
  - title: "OpenAI: Connect a custom MCP server to ChatGPT"
    url: "https://developers.openai.com/plugins/deploy/connect-chatgpt"
  - title: "Codex: MCP"
    url: "https://learn.chatgpt.com/docs/extend/mcp?surface=cli"
  - title: "Cursor help: MCP"
    url: "https://cursor.com/help/customization/mcp"
  - title: "VS Code: Add and manage MCP servers"
    url: "https://code.visualstudio.com/docs/agent-customization/mcp-servers"
  - title: "Devin Desktop: Cascade MCP"
    url: "https://docs.devin.ai/desktop/cascade/mcp"
  - title: "Gemini CLI: MCP servers"
    url: "https://geminicli.com/docs/tools/mcp-server/"
  - title: "MCP TypeScript SDK: Connect a client"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/clients/connect"
---
Every client below can connect to a remote MCP server over Streamable HTTP. Where they differ is how they register with your OAuth server, whether you can send a fixed token or API key instead, whether they reach private hosts, and which limits apply once connected. This page is generated from the same data that drives mcptest's compatibility checks, so the table, the per-client notes and the report agree.

## The full matrix {#matrix}

Each row carries the date its cells were last checked against the vendor's documentation. "Bridge required" means the client needs a tunnel or a stdio bridge to reach that kind of server.

<!-- compat-matrix clients="all" limitations="true" -->

## Claude.ai custom connectors {#claude-ai}

Verified 2026-10-20. Claude.ai connects over Streamable HTTP and the deprecated SSE transport, signs in with OAuth through CIMD, Dynamic Client Registration or your own client ID, and accepts authless servers. It cannot run stdio servers or reach addresses that are not globally routable (MCP tunnels, an Enterprise research preview, are the exception), and fixed request headers are a beta for a limited set of organizations.

Configure it under **Customize > Connectors > Add custom connector**; on Team and Enterprise, an Owner adds it under **Organization settings > Connectors > Add > Custom > Web**. Guide: [Add a remote MCP server to Claude](/learn/add-remote-mcp-server-to-claude).

## Claude Desktop {#claude-desktop}

Verified 2026-10-20. Remote servers are added to the Claude account as connectors and get the same transports, OAuth options and public-internet requirements as claude.ai, while local stdio servers run from `claude_desktop_config.json` or desktop extensions. No official page says whether a remote URL in `claude_desktop_config.json` works, and local servers configured there are not available in claude.ai or Cowork.

Remote servers go in **Customize > Connectors**; local servers in **Settings > Developer > Edit Config** or **Settings > Extensions** for `.mcpb` files. Guide: [Add a remote MCP server to Claude](/learn/add-remote-mcp-server-to-claude).

## Claude Code {#claude-code}

Verified 2026-10-20 against version 2.1.304. Claude Code supports Streamable HTTP, SSE and stdio, all three OAuth registration modes, and static `Authorization` or other headers, including a `headersHelper` command. Non-interactive runs (`claude -p`, the Agent SDK) cannot complete OAuth, and the docs do not state whether private or localhost HTTP servers are reachable.

Add a server with `claude mcp add --transport http <name> <url>`, or edit `.mcp.json` (project) or `~/.claude.json`. Guide: [Add a remote MCP server to Claude](/learn/add-remote-mcp-server-to-claude#claude-code).

## ChatGPT {#chatgpt}

Verified 2026-10-20. ChatGPT connects over Streamable HTTP (recommended, usually at `/mcp`) or SSE, and signs in with OAuth through CIMD (preferred), Dynamic Client Registration or static client credentials, or with no authentication. It cannot present custom API keys or bearer tokens other than the OAuth-issued one, and stdio or private servers need Secure MCP Tunnel.

Add a server in ChatGPT web under **Plugins > Add custom MCP server**, then configure authentication and accept the risk warning. Guide: [Connect an MCP server to ChatGPT](/learn/connect-mcp-server-to-chatgpt).

## Codex CLI {#codex-cli}

Verified 2026-10-20 against `rust-v0.163.0`. Codex supports Streamable HTTP and stdio, OAuth through Dynamic Client Registration, CIMD or a client ID, a bearer token read from an environment variable, and static or environment-sourced headers. Legacy SSE servers need a stdio bridge, and an explicit no-auth mode for HTTP servers is not documented.

Run `codex mcp add <name> --url <url>`, then `codex mcp login <name>`, or edit `[mcp_servers.<name>]` in `~/.codex/config.toml`. Guide: [Connect an MCP server to Windsurf, Gemini CLI and Codex](/learn/connect-mcp-server-to-windsurf-gemini-cli-and-codex).

## Cursor {#cursor}

Verified 2026-10-20 against version 3.24. Cursor supports Streamable HTTP, SSE and stdio, OAuth through Dynamic Client Registration or a static client ID in an `auth` block, arbitrary headers with `${env:NAME}` interpolation, and url-only servers without sign-in. CIMD is not mentioned in its documentation, and an admin allowlist can restrict which remote URLs are allowed.

Edit `mcpServers` in `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global), or use **Customize > MCPs**. Guide: [Connect an MCP server to Cursor](/learn/connect-mcp-server-to-cursor).

## VS Code with GitHub Copilot {#vscode-copilot}

Verified 2026-10-20 against version 1.142. VS Code supports Streamable HTTP with SSE fallback, stdio, every OAuth registration mode, headers with `${input:...}` variables, and localhost servers, Unix sockets and Windows named pipes. At most 128 tools can be enabled in one chat request, and an open issue means Agent Host (Copilot SDK) chats never start OAuth sign-in for remote HTTP servers.

Use the **MCP: Add Server** command, edit `servers` in `.vscode/mcp.json` or the user `mcp.json`, or run `code --add-mcp '<json>'`. Guide: [Connect an MCP server to VS Code](/learn/connect-mcp-server-to-vs-code).

## Windsurf {#windsurf}

Verified 2026-10-20. Windsurf (Devin Desktop, Cascade) supports Streamable HTTP, SSE and stdio, and headers with `${env:VAR}` or `${file:path}` values. OAuth is supported for every transport but the docs do not say how the client registers, and Cascade can use at most 100 tools at a time.

Edit `serverUrl` or `url` in `~/.config/devin/mcp_config.json` (`%APPDATA%\devin\mcp_config.json` on Windows), or open it from the Cascade panel under **MCPs > Open MCP config file**. Guide: [Connect an MCP server to Windsurf, Gemini CLI and Codex](/learn/connect-mcp-server-to-windsurf-gemini-cli-and-codex).

## Gemini CLI {#gemini-cli}

Verified 2026-10-20. Gemini CLI supports Streamable HTTP (`httpUrl`), SSE (`url`) and stdio, OAuth through Dynamic Client Registration or a client ID in an `oauth` block, bearer and API-key headers, and localhost servers. OAuth needs a local browser, so it fails over SSH without X11 forwarding and in containers without one, and CIMD is not mentioned.

Run `gemini mcp add --transport http <name> <url>`, or edit `mcpServers` in `~/.gemini/settings.json` (user) or `.gemini/settings.json` (project). Guide: [Connect an MCP server to Windsurf, Gemini CLI and Codex](/learn/connect-mcp-server-to-windsurf-gemini-cli-and-codex).

## MCP TypeScript SDK client {#generic-sdk}

Verified 2026-10-20 against version 2.3.1. The SDK is the only client here that documents its protocol versions, and it supports every transport and authentication mode in the matrix. What a client built on it supports depends on how the application wires transports, auth and handlers, and the SDK does not validate the OAuth `state` parameter, so the application must.

Connect programmatically with `new Client(...).connect(new StreamableHTTPClientTransport(url))`. There is no mcptest guide; see the [SDK client documentation](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect).

## How we verify {#how-we-verify}

Each cell in the matrix is read from the vendor's current official documentation and stored with the exact source page and the day it was read. Where a vendor does not document something, the cell says "unknown"; support is never inferred from forum posts or third-party blogs. A client's verification date is the oldest date among its cells.

The freshness rule is 90 days: the compatibility check fails when any cell was verified more than 90 days ago, and the fix is to re-read the source and update the cell and its date, even when nothing changed. The process, and how the same data drives mcptest's host verdicts, is described in [the host compatibility engine documentation](https://github.com/integry/mcptest/blob/master/docs/host-compatibility-engine.md).

## Check your server against these clients

The matrix tells you what a client documents; it does not tell you whether your server meets it. Open the [MCP Playground](/), paste your endpoint and connect to see the transport, OAuth discovery and capabilities each of these clients will run into.
