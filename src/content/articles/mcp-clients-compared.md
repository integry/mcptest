---
title: MCP clients compared
summary: Compare the documented transports, authentication paths, capabilities, configuration, and approval controls in six widely used MCP clients.
track: use
level: practitioner
order: 2
category: Clients and compatibility
readingTimeMinutes: 8
lastReviewed: "2026-11-11"
relatedSlugs:
  - connect-remote-mcp-server
  - mcp-client-support-matrix
  - mcp-server-trust-checklist
sourceLinks:
  - title: "Claude Code: Connect to tools via MCP"
    url: "https://code.claude.com/docs/en/mcp"
  - title: "Claude Help Center: Get started with custom connectors using remote MCP"
    url: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp"
  - title: "Claude docs: Add a connector that isn't in the directory"
    url: "https://claude.com/docs/connectors/custom/add-unlisted"
  - title: "OpenAI: Add custom MCP server"
    url: "https://developers.openai.com/api/docs/guides/custom-mcp-server"
  - title: "ChatGPT Learn: Model Context Protocol in Codex"
    url: "https://learn.chatgpt.com/docs/extend/mcp?surface=cli"
  - title: "Cursor docs: Model Context Protocol (MCP)"
    url: "https://cursor.com/docs/context/mcp"
  - title: "Cursor help: MCP"
    url: "https://cursor.com/help/customization/mcp"
  - title: "VS Code: Add and manage MCP servers"
    url: "https://code.visualstudio.com/docs/agent-customization/mcp-servers"
  - title: "VS Code: MCP configuration reference"
    url: "https://code.visualstudio.com/docs/agents/reference/mcp-configuration"
  - title: "VS Code 1.146 release notes (Local harness deprecation)"
    url: "https://code.visualstudio.com/updates/v1_146"
  - title: "Zed docs: Model Context Protocol"
    url: "https://zed.dev/docs/ai/mcp"
  - title: "MCP 2026-07-28 changelog"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/changelog"
  - title: MCP Inspector
    url: "https://github.com/modelcontextprotocol/inspector"
---
## Coverage and how to read this comparison

This comparison records behavior in the vendors' public documentation reviewed on **11 November 2026**. It does not promise that every account, plan, operating system, managed-workspace policy or older installed build shows the same UI. Where a cell says "not documented", the cited documentation does not establish support; that does not prove the capability is impossible. Legacy HTTP+SSE is listed separately from Streamable HTTP because they are different transports.

| Client | Local stdio | Remote HTTP | Documented authentication | Documented MCP surface | Approval and trust behavior | Configuration |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Desktop | Yes, through desktop extensions (`.mcpb`) and local servers in `claude_desktop_config.json` | Yes, through custom connectors on your Claude account, which connect from Anthropic's cloud | Connectors: OAuth with Claude's published client identity (CIMD), automatic registration (DCR) or your own client; request headers for API keys are a beta for some organizations. Extensions can collect API keys in their settings | Tools from connectors and extensions; this comparison does not infer resources or prompts | Install extensions only from publishers you trust; organizations can disable or restrict extensions, and only Owners add custom connectors on Team and Enterprise | **Customize > Connectors** for remote servers; **Settings > Desktop app > Extensions** (older layout: **Settings > Extensions**) and the developer config file for local servers |
| Claude Code | Yes | Streamable HTTP (`http`, with automatic SSE fallback) and legacy SSE | OAuth with CIMD, DCR or a client ID; fixed headers such as bearer or API-key tokens, with `${VAR}` expansion | Tools, resources and prompts are documented | Project-scoped `.mcp.json` servers need approval; choices can be reset | `claude mcp add`, plus local, project (`.mcp.json`) and user scopes; claude.ai connectors also load when you sign in with a claude.ai account |
| ChatGPT (web) | No; ChatGPT on the web connects only to remote endpoints (local Codex clients and the ChatGPT desktop app use `~/.codex/config.toml` instead) | Streamable HTTP (recommended) and SSE; private servers through Secure MCP Tunnel | OAuth with static client credentials, CIMD or DCR, or no authentication; no API-key or custom-header field | Tools; deep research and company knowledge use read and fetch actions only | Tools without `readOnlyHint` are treated as write actions and ask for confirmation by default; workspace policies such as Lockdown apply | **Plugins > Add custom MCP server** on chatgpt.com; availability depends on plan and workspace role |
| Cursor | Yes | Streamable HTTP and legacy SSE | OAuth with DCR or a static client ID in an `auth` block; headers with `${env:NAME}` interpolation | Tools, prompts, resources, roots, elicitation and MCP Apps (via extension) are listed as supported | Cursor asks for approval before MCP tool calls by default; from Cursor 3.6 the default Auto-review mode runs allowlisted tools and routes the rest through a safety classifier | `.cursor/mcp.json` or `~/.cursor/mcp.json`, **Customize > MCPs**, marketplace **Add to Cursor**, or the extension API |
| VS Code (GitHub Copilot) | Yes | Streamable HTTP and legacy SSE (`type: "sse"`); the older editor format falls back from HTTP to SSE automatically | OAuth with built-in GitHub and Microsoft Entra sign-in, DCR or a client ID (`oauthClientId`); headers with `${NAME}` environment references, or `${input:...}` prompts in the older format | Tools in every session; MCP Apps (experimental); resource browsing and MCP prompts as slash commands are documented for the deprecated Local harness | Workspace configurations follow Workspace Trust; tool calls can require confirmation; organization policy (`chat.mcp.access`) can block servers | `~/.copilot/mcp-config.json` or workspace `.mcp.json` (`mcpServers`), **Chat: Open Customizations > MCP Servers**, **MCP: Add Server**; `.vscode/mcp.json` (`servers`) is the deprecated Local harness format |
| MCP Inspector | Yes | Streamable HTTP and legacy SSE | Custom headers (`--header`, or `headers` in a config file) and interactive OAuth, including DCR and a client ID | A testing UI for tools, resources, prompts, protocol messages and transport behavior | Its backend can spawn processes, binds to `127.0.0.1`, and refuses all-interfaces binding unless you set `DANGEROUSLY_BIND_ALL_INTERFACES=true`; stored secrets fall back to an unencrypted file when no OS keychain is available | Web UI, CLI and TUI modes; a writable server catalog (`--catalog`) or a read-only `--config` file |

**Verified transport and authentication matrix.** The next table is generated from mcptest's sourced client data, the same data the release-readiness report uses for its host verdicts. Each row shows the date its cells were last checked against the vendor's documentation, and every cell has a source in the data file. Where a vendor does not document something, the cell says unknown instead of guessing. The [client support matrix](/learn/mcp-client-support-matrix) explains each row.

<!-- compat-matrix clients="claude-ai,claude-desktop,claude-code,chatgpt,codex-cli,cursor,vscode-copilot,windsurf,gemini-cli,generic-sdk" -->

### Important product boundaries

**Claude Desktop and Claude Code are different clients.** Desktop extensions run integrations locally, and remote connectors are brokered through your Claude account from Anthropic's cloud. Claude Code connects from your own machine and documents CLI configuration scopes, resource mentions, prompt commands, HTTP headers and an OAuth login flow. Do not copy a Claude Code command and assume the Desktop UI uses it. Setup for both is in [How to add a remote MCP server to Claude](/learn/add-remote-mcp-server-to-claude).

**ChatGPT on the web is remote-only.** It does not connect to a server that runs only on your machine; use a public HTTPS endpoint or Secure MCP Tunnel. Custom MCP servers are created from **Plugins** on ChatGPT web. Pro accounts get read and fetch actions only; Business, Enterprise and Edu get full MCP, with creation limited by workspace role or permission. Confirm eligibility before you design distribution around it. See [How to connect a remote MCP server to ChatGPT](/learn/connect-mcp-server-to-chatgpt).

**VS Code and Cursor share some configuration ideas, not one schema.** Both accept JSON-based MCP configuration, but field names, file locations, trust prompts, variable syntax and fallback behavior differ. VS Code itself now has two formats: the Copilot `mcpServers` format and the deprecated `.vscode/mcp.json` `servers` format, which the Local harness uses until its removal in February 2027. Publish a tested example for each client instead of calling one file universal.

## Transport and authentication choices

Choose **stdio** when the server must run on the user's machine or reach local files and tools. The client starts the process and exchanges protocol messages over standard input and output. Distribution then includes runtime installation, environment variables, upgrades, and the risk of running a package locally.

Choose **Streamable HTTP** for a shared cloud service. One deployment can serve many clients and users, and browser-based OAuth is practical. Legacy SSE remains in some client configuration and compatibility paths, and the `2026-07-28` specification formally lists it as deprecated, so new services should target Streamable HTTP and test the actual clients they intend to support. Clients that run in the vendor's cloud, such as claude.ai and ChatGPT, also need the server to be reachable from the public internet.

API keys are configuration, not interoperability. A local process may receive a secret in its environment; a remote client may attach a header. That does not mean every client offers a safe way to collect, store and rotate the same secret, and ChatGPT and JetBrains AI Assistant document no header field at all. OAuth is a better fit when each user must grant scoped access without giving the MCP client a long-lived upstream credential. For client registration, the `2026-07-28` specification prefers Client ID Metadata Documents and deprecates Dynamic Client Registration, which many clients still use.

## Capabilities are more than tools

Tools are the most consistently visible primitive, but MCP also defines resources and prompts. Client UX differs: Claude Code exposes resource references and prompt commands; Cursor lists tools, prompts, resources, roots and elicitation as supported; VS Code documents resource browsing and prompt slash commands only for its deprecated Local harness, while Copilot sessions read resources only for MCP Apps. Zed supports tools and prompts but not resources. Treat a capability as supported only after the client's current official docs or a versioned test establishes it.

Large tool catalogs also have a context cost. A client may load names and schemas into the model's working context, search them on demand, or let users disable tools, and some cap the number of enabled tools (VS Code allows 128 in one request). Whatever the client, keep names distinct, descriptions decision-oriented and schemas compact. Test whether the model selects the intended tool when several tools sound similar.

## A practical selection rule

1. Pick the surfaces your users already work in. A technically complete integration that requires switching clients rarely wins.
2. Eliminate clients that cannot reach your deployment model: local stdio versus public or privately tunneled HTTP.
3. Verify the required primitive (tools, resources, prompts or interactive UI) against current client documentation.
4. Reproduce authentication with the exact client and account tier. Test first authorization, refresh, revocation and insufficient scope.
5. Review approval controls for writes. A client trust prompt at installation is not the same as per-call confirmation.
6. Publish client-specific configuration and a review date. Avoid a single copy-paste block labeled "works everywhere".

Next, follow [How to connect to a remote MCP server](/learn/connect-remote-mcp-server), then apply the [MCP server evaluation and trust checklist](/learn/mcp-server-trust-checklist) before granting access.
