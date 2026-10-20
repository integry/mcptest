---
title: MCP clients compared
summary: Compare the documented transports, authentication paths, capabilities, configuration, and approval controls in six widely used MCP clients.
track: use
level: practitioner
order: 2
category: Clients and compatibility
readingTimeMinutes: 11
lastReviewed: 2026-08-17
relatedSlugs:
  - connect-remote-mcp-server
  - mcp-server-trust-checklist
sourceLinks:
  - title: "Claude Code: Connect to tools via MCP"
    url: "https://code.claude.com/docs/en/mcp"
  - title: "Anthropic: Local MCP servers on Claude Desktop"
    url: "https://support.anthropic.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop"
  - title: "Anthropic: Desktop and web connectors"
    url: "https://support.anthropic.com/en/articles/11725091-when-to-use-desktop-and-web-connectors"
  - title: "OpenAI: Developer mode and MCP apps in ChatGPT"
    url: "https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt"
  - title: "Cursor: Model Context Protocol"
    url: "https://docs.cursor.com/context/model-context-protocol"
  - title: "VS Code: Add and manage MCP servers"
    url: "https://code.visualstudio.com/docs/agent-customization/mcp-servers"
  - title: "VS Code: MCP configuration reference"
    url: "https://code.visualstudio.com/docs/agents/reference/mcp-configuration"
  - title: MCP Inspector
    url: "https://github.com/modelcontextprotocol/inspector"
---
## Coverage and how to read this comparison

This matrix records behavior in the vendors' public documentation reviewed on **17 August 2026**. It is not a promise that every account, plan, operating system, managed-workspace policy, or older installed build exposes the same UI. A dash means the cited documentation does not establish support; it does not prove the capability is impossible. Legacy HTTP+SSE is listed separately from Streamable HTTP because they are different transports.

| Client | Local stdio | Remote HTTP | Documented authentication | Documented MCP surface | Approval and trust behavior | Configuration |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Desktop | Yes, through local desktop extensions and developer-defined local servers | Yes, through remote web connectors | Extension settings can collect API keys; remote connectors can run their own authorization flow | Official Desktop guidance documents connector-provided actions; this comparison does not infer resources or prompts | Install extensions only from publishers you trust; managed plans can restrict public and custom extensions | Extensions UI; developer configuration for local servers |
| Claude Code | Yes | Streamable HTTP (`http`) and legacy SSE | OAuth for HTTP; fixed headers such as bearer/API tokens are supported | Tools, resources, and prompts are documented | Project-scoped `.mcp.json` servers require approval; choices can be reset | CLI plus project, user, and local scopes |
| ChatGPT | No direct local server connection | Yes; custom apps connect to remote MCP endpoints | OAuth and the authentication options offered when creating an app; no API-key claim is inferred here | Full MCP apps can expose actions; exact availability depends on plan and rollout | Workspace admins publish apps, can control actions and access, and users may be asked to confirm writes | ChatGPT web settings and workspace app management |
| Cursor | Yes | Streamable HTTP and legacy SSE | OAuth for remote servers; environment variables can supply API keys to local servers | Tools, prompts, roots, and elicitation are explicitly listed; the cited support table does not list resources | Tool approval is on by default; auto-run is optional | `.cursor/mcp.json`, global config, one-click installs, or extension API |
| VS Code | Yes | Streamable HTTP with SSE fallback; explicit `sse` is also configurable | Request headers/input variables and OAuth with a client ID are documented | Tools, resources, prompts, and MCP Apps | First start normally asks whether the server is trusted; tool calls can require confirmation; local stdio can be sandboxed on macOS/Linux | Workspace or profile `mcp.json`, guided command, or gallery install |
| MCP Inspector | Yes | Streamable HTTP and legacy SSE | Custom headers/bearer tokens and interactive OAuth are documented in current Inspector guidance | A testing UI for tools, resources, prompts, protocol messages, and transport behavior | Its local proxy can spawn processes and must not be exposed to untrusted networks | Web UI, TUI/CLI flags, or an MCP configuration file |

### Important product boundaries

**Claude Desktop and Claude Code are different clients.** Desktop extensions are designed for locally installed integrations, while Claude Code documents CLI configuration scopes, resource mentions, prompt commands, HTTP headers, and an OAuth login flow. Do not copy a Claude Code command and assume the Desktop UI consumes it.

**ChatGPT is remote-first.** OpenAI's current guidance says ChatGPT does not directly connect to a server running only on your machine. Custom MCP apps are managed through ChatGPT web and availability varies by plan and workspace controls. Confirm current eligibility before designing distribution around it.

**VS Code and Cursor share some configuration ideas, not one guaranteed schema.** Both accept JSON-based MCP configuration, but field names, storage locations, trust prompts, input-variable syntax, and fallback behavior are client concerns. Publish a tested example for each client instead of calling one file universal.

## Transport and authentication choices

Choose **stdio** when the server must run on the user's machine or reach local files and tools. The client starts the process and exchanges protocol messages over standard input/output. Distribution then includes runtime installation, environment variables, upgrades, and the risk of executing a package locally.

Choose **Streamable HTTP** for a shared cloud service. One deployment can serve multiple clients and users, and browser-based OAuth is practical. Legacy SSE remains present in some client configuration and compatibility paths, but new services should target the current Streamable HTTP transport and test the actual clients they intend to support.

API keys are configuration, not interoperability. A local process may receive a secret in its environment; a remote client may attach a header. That does not mean every client exposes a safe way to collect, store, and rotate the same secret. OAuth is a better fit when each user must grant scoped access without giving the MCP client a long-lived upstream credential.

## Capabilities are more than tools

Tools are the most consistently visible primitive, but MCP also defines resources and prompts. Client UX differs: Claude Code exposes resource references and prompt commands, VS Code documents resource browsing and slash-command prompts, and Cursor's current protocol table explicitly lists prompts but not resources. Treat a capability as supported only after the client's current official docs or a versioned test establishes it.

Large tool catalogs also have a context cost. A client may load names and schemas into the model's working context, dynamically search them, or let users disable tools. Regardless of client, keep names distinct, descriptions decision-oriented, and schemas compact. Test whether the model selects the intended tool when several tools sound similar.

## A practical selection rule

1. Pick the surfaces your users already work in. A technically complete integration that requires switching clients rarely wins.
2. Eliminate clients that cannot reach your deployment model: local stdio versus public or privately tunneled HTTP.
3. Verify the required primitive—tools, resources, prompts, or interactive UI—against current client documentation.
4. Reproduce authentication with the exact client and account tier. Test first authorization, refresh, revocation, and insufficient scope.
5. Review approval controls for writes. A client trust prompt at installation is not the same as per-call confirmation.
6. Publish client-specific configuration and a review date. Avoid a single copy-paste block labeled “works everywhere.”

Next, follow [How to connect to a remote MCP server](/learn/connect-remote-mcp-server), then apply the [MCP server evaluation and trust checklist](/learn/mcp-server-trust-checklist) before granting access.
