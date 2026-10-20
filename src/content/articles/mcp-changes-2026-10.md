---
title: "What changed in MCP, October 2026"
navTitle: "MCP changes, Oct 2026"
summary: "MCP changes from 2026-09-20 to 2026-10-20: the Server Cards SEP is final, six official SDKs shipped releases, and Claude connectors and Devin Desktop now negotiate 2026-07-28."
track: reference
level: practitioner
order: 60
category: Monthly digest
readingTimeMinutes: 7
lastReviewed: "2026-10-20"
metaTitle: "What changed in MCP, October 2026 | mcptest.io"
metaDescription: "MCP changes from 2026-09-20 to 2026-10-20: SEP-2127 Server Cards, TypeScript, Python and other SDK releases, client updates, and remote server news."
relatedSlugs:
  - mcp-protocol-versions-explained
  - mcp-protocol-timeline
  - mcp-clients-compared
  - mcp-oauth-2-1-reference
sourceLinks:
  - title: "SEP-2127: MCP Server Cards (PR #2127, merged 2026-10-06)"
    url: "https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127"
  - title: "SEP-2127: MCP Server Cards"
    url: "https://modelcontextprotocol.io/seps/2127-mcp-server-cards"
  - title: "Server Card extension repository"
    url: "https://github.com/modelcontextprotocol/experimental-ext-server-card"
  - title: "Require WG/IG discussion before SEP submission (PR #3336)"
    url: "https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3336"
  - title: "SEP guidelines"
    url: "https://modelcontextprotocol.io/community/sep-guidelines"
  - title: "Add Ruby SDK Tier 1 assessment to SDK listing (PR #3248)"
    url: "https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3248"
  - title: "Docs: add local server security guide (PR #3072)"
    url: "https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3072"
  - title: "Local server security"
    url: "https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/local-server-security"
  - title: "Use loopback IP literals in the CIMD redirect_uris example (PR #3384)"
    url: "https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3384"
  - title: "MCP draft specification changelog"
    url: "https://modelcontextprotocol.io/specification/draft/changelog"
  - title: "TypeScript SDK v2.2.0"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.2.0"
  - title: "TypeScript SDK v2.3.0"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.3.0"
  - title: "TypeScript SDK v2.3.1"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.3.1"
  - title: "TypeScript SDK 1.30.1"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.30.1"
  - title: "TypeScript SDK 1.31.0"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.31.0"
  - title: "TypeScript SDK 1.32.0"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.32.0"
  - title: "Python SDK v2.3.0"
    url: "https://github.com/modelcontextprotocol/python-sdk/releases/tag/v2.3.0"
  - title: "Java SDK v2.1.0"
    url: "https://github.com/modelcontextprotocol/java-sdk/releases/tag/v2.1.0"
  - title: "Java SDK v2.2.0-M1"
    url: "https://github.com/modelcontextprotocol/java-sdk/releases/tag/v2.2.0-M1"
  - title: "Rust SDK rmcp 3.6.0"
    url: "https://github.com/modelcontextprotocol/rust-sdk/releases/tag/rmcp-v3.6.0"
  - title: "Rust SDK rmcp 3.5.0"
    url: "https://github.com/modelcontextprotocol/rust-sdk/releases/tag/rmcp-v3.5.0"
  - title: "Rust SDK rmcp 3.5.1"
    url: "https://github.com/modelcontextprotocol/rust-sdk/releases/tag/rmcp-v3.5.1"
  - title: "Ruby SDK v1.8.0"
    url: "https://github.com/modelcontextprotocol/ruby-sdk/releases/tag/v1.8.0"
  - title: "Ruby SDK v1.6.0"
    url: "https://github.com/modelcontextprotocol/ruby-sdk/releases/tag/v1.6.0"
  - title: "PHP SDK v0.9.0"
    url: "https://github.com/modelcontextprotocol/php-sdk/releases/tag/v0.9.0"
  - title: "MCP Inspector releases"
    url: "https://github.com/modelcontextprotocol/inspector/releases"
  - title: "Claude Code changelog"
    url: "https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md"
  - title: "Claude release notes"
    url: "https://support.claude.com/en/articles/12138966-release-notes"
  - title: "OpenAI Apps SDK changelog"
    url: "https://developers.openai.com/apps-sdk/changelog"
  - title: "Cursor changelog"
    url: "https://cursor.com/changelog"
  - title: "VS Code 1.140 release notes"
    url: "https://code.visualstudio.com/updates/v1_140"
  - title: "VS Code 1.141 release notes"
    url: "https://code.visualstudio.com/updates/v1_141"
  - title: "Devin Desktop (formerly Windsurf) changelog"
    url: "https://docs.devin.ai/desktop/changelog"
  - title: "Gemini CLI releases"
    url: "https://github.com/google-gemini/gemini-cli/releases"
  - title: "Codex rust-v0.157.0"
    url: "https://github.com/openai/codex/releases/tag/rust-v0.157.0"
  - title: "Codex rust-v0.158.0"
    url: "https://github.com/openai/codex/releases/tag/rust-v0.158.0"
  - title: "Codex rust-v0.161.0"
    url: "https://github.com/openai/codex/releases/tag/rust-v0.161.0"
  - title: "Codex rust-v0.162.0"
    url: "https://github.com/openai/codex/releases/tag/rust-v0.162.0"
  - title: "Cloudflare changelog: step-up authorization for the Cloudflare MCP server (2026-10-19)"
    url: "https://developers.cloudflare.com/changelog/post/2026-10-19-cloudflare-mcp-step-up/"
  - title: "Cloudflare changelog: Workers Issues as MCP events (2026-10-13)"
    url: "https://developers.cloudflare.com/changelog/post/2026-10-13-cloudflare-mcp-events/"
  - title: "Atlassian: Atlassian MCP generally available (2026-10-06)"
    url: "https://www.atlassian.com/blog/company-news/team26-europe-atlassian-mcp"
  - title: "Atlassian Rovo MCP Server changelog"
    url: "https://developer.atlassian.com/cloud/rovo-mcp/changelog/"
  - title: "Google Cloud: Google Cloud CLI remote MCP server in preview"
    url: "https://cloud.google.com/blog/products/ai-machine-learning/google-cloud-cli-remote-mcp-server-in-preview"
  - title: "AWS: AWS MCP Server in six additional Regions (2026-10-02)"
    url: "https://aws.amazon.com/about-aws/whats-new/2026/10/aws-mcp-server-six-additional-regions/"
---

This digest covers 2026-09-20 to 2026-10-20. It lists changes to the MCP specification, the official SDKs, the major clients and notable remote servers. Each item links its source. Anything that could not be verified from a primary source dated in the window is left out.

## Specification

The window has no new specification revision. 2026-07-28 is still current, and the [draft changelog](https://modelcontextprotocol.io/specification/draft/changelog) has no new entries.

- **SEP-2127, MCP Server Cards, is Final** ([PR #2127](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127), merged 2026-10-06). An Extensions Track SEP with the identifier `io.modelcontextprotocol/server-card`. A Server Card is a static JSON document that describes a remote server before anyone connects to it: its name, version, transport endpoints and supported protocol versions. The recommended location is `<streamable-http-url>/server-card`. For domain-level discovery, an AI Catalog at `/.well-known/ai-catalog.json` can link to or embed cards. When a card and a live `server/discover` result disagree, clients should prefer `server/discover`. The wire format lives in the [extension repository](https://github.com/modelcontextprotocol/experimental-ext-server-card), not in the [SEP page](https://modelcontextprotocol.io/seps/2127-mcp-server-cards).
- **SEPs now need prior discussion** ([PR #3336](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3336), merged 2026-09-28). Before opening a SEP, its author must discuss it with the relevant working or interest group and link that discussion in the PR. The [SEP guidelines](https://modelcontextprotocol.io/community/sep-guidelines) now require it.
- **The Ruby SDK moves to Tier 1** ([PR #3248](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3248), merged 2026-09-28). The SDK listing for 2026-07-28 and the draft changed. The application cites 67/67 server and 50/50 client conformance scenarios.
- **New guide: local server security** ([PR #3072](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3072), merged 2026-10-05). [Local server security](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/local-server-security) covers the machine-level threat model of stdio servers. It is documentation, not specification text.
- **Editorial changes.** The example Client ID Metadata Document in the draft authorization pages now uses loopback IP literals (`127.0.0.1`, `[::1]`) instead of `localhost` in `redirect_uris` ([PR #3384](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3384)). The 2026-07-28 page keeps the published example.

## SDK releases

| SDK | Version (date) | Changes you will notice |
| --- | --- | --- |
| TypeScript | [v2.2.0](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.2.0) (2026-09-28) | `listTools()` and the other list calls without a cursor follow `nextCursor` to the end. Machine-to-machine OAuth providers take `expectedIssuer`; leaving it out is deprecated. `fetchToken()` throws `AuthorizationServerMismatchError` when stored client information belongs to another authorization server. |
| TypeScript | [v2.3.0](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.3.0) (2026-10-02), [v2.3.1](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.3.1) (2026-10-05) | `Server.connect()` rejects an instance that is already connected, and a stateless transport handles one request, so create the server per request. HTTP client transports follow redirects only on the same origin unless `redirectPolicy: 'follow'` is set. New opt-in `maxToolInputElements` and `expectedResource` (token audience check); 2.3.1 adds `expectedResource` to `server-legacy`. `allowedOrigins` accepts `<scheme>://*` for browser-extension clients. A large single-event SSE result arrives much faster. |
| TypeScript 1.x | [1.30.1](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.30.1) (2026-09-23), [1.31.0](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.31.0) (2026-09-28), [1.32.0](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.32.0) (2026-10-02) | Backports: request body size limit and batch length bound (1.30.1), OAuth credentials bound to their issuer (1.31.0), same-origin redirects, `maxToolInputElements` and `expectedResource` (1.32.0). 1.32.1 changed only documentation. |
| Python | [v2.3.0](https://github.com/modelcontextprotocol/python-sdk/releases/tag/v2.3.0) (2026-10-02) | A tool with an invalid `x-mcp-header` annotation now fails at registration; before, 2026-07-28 clients silently dropped it. On 2025-era connections, empty `_meta` and `params` are no longer sent. New `max_sse_event_size` (default 1 MiB per event). `Client.call_tool` re-lists and retries once after `-32020`. An interactive OAuth login no longer counts toward request timeouts. Requires `httpx2>=2.10.0`. |
| Java | [v2.1.0](https://github.com/modelcontextprotocol/java-sdk/releases/tag/v2.1.0) (2026-10-16) | Removes the 2024-11-05 protocol from Streamable HTTP. Rejects POST bodies that are not `application/json`. Adds session sweeping and keep-alive, and `extensions` on capabilities (SEP-2133). Patch releases v1.1.5 and v0.18.5 shipped the same day. |
| Java | [v2.2.0-M1](https://github.com/modelcontextprotocol/java-sdk/releases/tag/v2.2.0-M1) (2026-10-16, milestone) | A new stateless 2026-07-28 server in `io.modelcontextprotocol.modern`. It does not yet support a modern client, tasks or SEP-2243 custom headers. |
| Rust (`rmcp`) | [3.4.1](https://github.com/modelcontextprotocol/rust-sdk/releases/tag/rmcp-v3.4.1) to [3.6.0](https://github.com/modelcontextprotocol/rust-sdk/releases/tag/rmcp-v3.6.0) (2026-09-23 to 2026-10-20) | [3.5.0](https://github.com/modelcontextprotocol/rust-sdk/releases/tag/rmcp-v3.5.0) rejects duplicate SEP-2243 headers and matches explicit default ports in the Origin allowlist. [3.5.1](https://github.com/modelcontextprotocol/rust-sdk/releases/tag/rmcp-v3.5.1) defaults missing cache hints for 2026-07-28 peers. 3.6.0 follows same-origin 307/308 redirects, answers a session-less non-`initialize` POST with `400`, cancels abandoned client requests and adds initial OAuth scope selection. |
| Ruby | [v1.6.0](https://github.com/modelcontextprotocol/ruby-sdk/releases/tag/v1.6.0) to [v1.8.0](https://github.com/modelcontextprotocol/ruby-sdk/releases/tag/v1.8.0) (2026-09-21 to 2026-10-16) | 1.6.0 raises an error when Protected Resource Metadata is unreachable instead of falling back to legacy discovery. 1.8.0 adds OAuth 2.1 resource server support to `StreamableHTTPTransport` (JWT or RFC 7662 introspection, RFC 9728 metadata), and its client transports reject server messages without `"jsonrpc": "2.0"`. |
| PHP | [v0.9.0](https://github.com/modelcontextprotocol/php-sdk/releases/tag/v0.9.0) (2026-10-18) | Breaking: authorization is narrowed to the resource server role, and `structuredContent` is validated against `outputSchema`. stdio serves both protocol eras. CORS preflight passes the authorization middleware, and the default CORS headers allow `Mcp-Method`, `Mcp-Name` and `Mcp-Param-*`. |

The Go, C#, Kotlin and Swift SDKs had no release in the window. The [MCP Inspector](https://github.com/modelcontextprotocol/inspector/releases) shipped 2.8.0 through 2.11.0.

## Client changes

Only documented changes that affect remote servers are listed.

- **Claude.** In the [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) (dates are the GitHub release dates):
  - 2.1.281 (2026-09-23) added URL-mode elicitation on 2026-07-28 connections.
  - 2.1.287 (2026-10-01) added URL prompts for servers on 2025-11-25. A server that no longer connects after this can set `"bareElicitationCapability": true`.
  - 2.1.288 (2026-10-02) prompts the user to re-authenticate when a server asks for more OAuth scope during a tool call.
  - 2.1.295 (2026-10-08) makes claude.ai connectors negotiate 2026-07-28 by default. 2.1.299 (2026-10-14) does the same for cloud session and Remote Control connectors and stops following HTTP redirects to claude.ai's connector proxy and Anthropic-hosted servers. `MCP_PROTOCOL_NEGOTIATION=legacy` opts out.
  - 2.1.302 (2026-10-16) fixed servers that negotiate 2026-07-28 but omit `resultType`, `ttlMs` or `cacheScope`, which had shown no tools or failed every call.

  The [Claude release notes](https://support.claude.com/en/articles/12138966-release-notes) have no documented connector changes in the window.
- **ChatGPT.** No documented changes. The [Apps SDK changelog](https://developers.openai.com/apps-sdk/changelog) has no entries in the window.
- **Cursor.** No documented changes in the [Cursor changelog](https://cursor.com/changelog).
- **VS Code.** No changes specific to remote servers. [1.140](https://code.visualstudio.com/updates/v1_140#_add-mcp-servers-to-portable-configuration-files) (2026-09-30) can write servers to portable configuration files from **MCP: Add Server**. [1.141](https://code.visualstudio.com/updates/v1_141#_see-discovered-mcp-servers-in-customizations-editor-preview) (2026-10-07, preview) lists servers supplied by extensions and plugins in the Agent Customizations editor.
- **Windsurf** (now Devin Desktop). In the [changelog](https://docs.devin.ai/desktop/changelog), 3.10.67 (2026-10-12) connects to servers on 2026-07-28 (`server/discover`, no `initialize`). As a private preview, it can also reach remote servers configured in Devin Cloud.
- **Gemini CLI.** No documented changes affecting remote servers in [v0.61.0 to v0.64.0](https://github.com/google-gemini/gemini-cli/releases).
- **Codex.**
  - [rust-v0.157.0](https://github.com/openai/codex/releases/tag/rust-v0.157.0) (2026-09-25) restricts MCP OAuth authorization endpoints to HTTP(S).
  - [rust-v0.158.0](https://github.com/openai/codex/releases/tag/rust-v0.158.0) (2026-09-28) connects to servers that need a pre-registered OAuth client secret (`codex mcp add --oauth-client-secret`).
  - [rust-v0.161.0](https://github.com/openai/codex/releases/tag/rust-v0.161.0) (2026-10-07) adds `/mcp login <name>` in the terminal UI.
  - [rust-v0.162.0](https://github.com/openai/codex/releases/tag/rust-v0.162.0) (2026-10-08) follows tool pagination in legacy protocol mode.

## Remote servers

- **Cloudflare API server** (`https://mcp.cloudflare.com/mcp`). On 2026-10-19 it added [step-up authorization](https://developers.cloudflare.com/changelog/post/2026-10-19-cloudflare-mcp-step-up/): a client can start with minimal scopes and is asked for more through an `insufficient_scope` challenge. On 2026-10-13 it began [sending Workers Issues as MCP events](https://developers.cloudflare.com/changelog/post/2026-10-13-cloudflare-mcp-events/) to a client webhook after `events/subscribe`. It is in the catalog; our last validation got an OAuth `401`, so no protocol version was recorded.
- **Atlassian MCP.** Atlassian [announced general availability](https://www.atlassian.com/blog/company-news/team26-europe-atlassian-mcp) of the rebuilt server on 2026-10-06. Its [changelog](https://developer.atlassian.com/cloud/rovo-mcp/changelog/) records MCP Apps for some Jira tools and Confluence search on V2 from 2026-10-13. The catalog entry still points to `https://mcp.atlassian.com/v1/mcp/authv2`.
- **Google Cloud CLI server** (`https://cloudcli.googleapis.com/mcp`). Google [released it in preview](https://cloud.google.com/blog/products/ai-machine-learning/google-cloud-cli-remote-mcp-server-in-preview) on 2026-10-01. It offers `run_gcloud_command` and `run_bq_command`, with OAuth 2.0 or Agent Identity and IAM permissions through `roles/mcp.toolUser`. It is not in the catalog.
- **AWS MCP Server.** On 2026-10-02 AWS [added six Regions](https://aws.amazon.com/about-aws/whats-new/2026/10/aws-mcp-server-six-additional-regions/): Singapore, Sydney, Tokyo, Ireland, London and Oregon. It is not in the catalog; the catalog's AWS entry is the separate AWS Knowledge server.

## What to do about it

- If your server sits behind a redirect to another host or port, publish the final URL. TypeScript SDK 2.3.0 and 1.32.0 clients no longer follow those redirects by default, and Claude Code no longer follows redirects to its connector proxy or Anthropic-hosted servers.
- If you build on the TypeScript SDK 2.3.0, create the server and the transport per request. A shared instance now fails on its second `connect()`.
- Test your server on 2026-07-28 now that claude.ai connectors and Devin Desktop negotiate it by default. Check that results carry the fields 2026-07-28 expects, and that every `x-mcp-header` parameter is a plain string, integer or boolean.
- If tokens need more scope for some tools, answer with an `insufficient_scope` challenge. Claude Code and Cloudflare's server now handle step-up instead of failing.
- To make your remote server discoverable before connection, read [SEP-2127](https://modelcontextprotocol.io/seps/2127-mcp-server-cards) and consider serving a Server Card at `<your-endpoint>/server-card`.

## Try it

To see which protocol version your server negotiates and what each revision changed, read [MCP protocol versions explained](/learn/mcp-protocol-versions-explained).
