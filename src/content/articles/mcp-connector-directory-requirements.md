---
title: "MCP connector directory requirements: Claude and ChatGPT"
navTitle: Connector directory requirements
summary: What the Claude Connectors Directory and the ChatGPT Directory require from a remote MCP server, taken from each vendor's submission docs, and which items mcptest can check for you.
track: build
level: practitioner
order: 457
category: Discovery
readingTimeMinutes: 7
lastReviewed: "2026-11-11"
metaTitle: "Claude and ChatGPT MCP Directory Requirements | mcptest.io"
metaDescription: "Official submission requirements for the Claude Connectors Directory and ChatGPT Directory: tool titles and hints, OAuth, HTTPS, privacy policy, and test accounts."
relatedSlugs:
  - make-mcp-server-discoverable
  - add-remote-mcp-server-to-claude
  - connect-mcp-server-to-chatgpt
  - mcp-oauth-2-1-reference
  - test-remote-mcp-server-in-ci
sourceLinks:
  - title: "Claude Docs: Submit a connector to the directory"
    url: "https://claude.com/docs/connectors/building/submission"
  - title: "Claude Docs: Connector pre-submission checklist"
    url: "https://claude.com/docs/connectors/building/review-criteria"
  - title: "Claude Docs: Authentication for connectors"
    url: "https://claude.com/docs/connectors/building/authentication"
  - title: "OpenAI Developers: Plugin guidelines"
    url: "https://developers.openai.com/plugins/plugin-guidelines"
  - title: "OpenAI Developers: Upload and submit your plugin"
    url: "https://developers.openai.com/plugins/deploy/submission"
---
## Two directories, two review processes

Anthropic lists remote MCP servers in the Claude Connectors Directory. You submit them through the developer portal at claude.ai/directory/manage. OpenAI lists them in the ChatGPT Directory as part of a plugin, which you upload and submit from platform.openai.com. Both vendors scan the server automatically, read its tool list, and send reviewers to call the tools with a test account you provide.

This page summarises the official requirements as of November 11, 2026. Every item links to the vendor page it comes from. Developer forums also report other rejection reasons, but those are not repeated here, and you should check the linked pages before you submit. Both vendors change these pages often.

## Requirements shared by both directories

- **A remote server on a public HTTPS URL.** Anthropic's portal asks for an `https://` URL and does not accept local servers as connectors ([submission checklist](https://claude.com/docs/connectors/building/submission#pre-submission-checklist-for-connectors)). OpenAI asks for "a stable, public HTTPS endpoint" ([submission guide](https://developers.openai.com/plugins/deploy/submission)).
- **Tool annotations.** Both vendors read `readOnlyHint` and `destructiveHint`. Claude uses them to decide which calls run without per-call confirmation, and OpenAI uses them to inform client safeguards. Both portals flag missing hints.
- **One operation per tool.** Anthropic rejects a tool that accepts both safe and unsafe HTTP methods, such as a catch-all `api_request` tool with a `method` argument. It asks you to split read and write operations into separate tools ([review criteria](https://claude.com/docs/connectors/building/review-criteria#separate-read-and-write-tools)). OpenAI asks you to "expose each model-callable operation as a separate tool". It does not allow operation selection through a generic executor ([tool independence](https://developers.openai.com/plugins/plugin-guidelines#tool-independence-and-exposure)).
- **OAuth for user accounts.** A server that needs sign-in uses OAuth. Anthropic's requirements call for OAuth 2.0 for authenticated services; its static-header option for an API key or bearer token is a beta for a limited set of organizations. OpenAI's portal has no API-key or bearer-token connection flow.
- **A test account for reviewers.** It must be fully populated, with sample data, and must not need MFA or other extra steps a reviewer cannot complete.

## Claude Connectors Directory

From [Submit a connector](https://claude.com/docs/connectors/building/submission), the [pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria) and [Authentication for connectors](https://claude.com/docs/connectors/building/authentication):

| Requirement | What the docs say | mcptest |
| --- | --- | --- |
| Tool title | Every tool includes a `title` | Checked |
| Safety hint | `readOnlyHint: true` for read-only tools, `destructiveHint: true` for tools that modify or delete data | Checked |
| Tool name length | 64 characters or fewer | Checked |
| Separate read and write | No tool accepts both safe and unsafe HTTP methods | Checked |
| Authentication | OAuth 2.0 when tools act on a user's account; no authentication for public data | Checked |
| Discovery | `401` with a `resource_metadata` pointer to RFC 9728 metadata, plus RFC 8414 or OpenID Connect authorization server metadata | Checked |
| PKCE | The authorization server supports S256 PKCE | Checked |
| Listing | Documentation URL, privacy policy URL, support contact, icon, listing text | Manual |
| Testing | Every tool called from Claude as a custom connector | Manual |
| Terms | Directory Terms and Policy; no money transfers or AI image, video, or audio generation | Manual |
| MCP Apps | 3 to 5 PNG carousel screenshots at least 1000px wide | Manual |

Claude also asks your authorization server to accept the hosted callback `https://claude.ai/api/mcp/auth_callback` and Claude Code's loopback redirects. It finds a client identity through Dynamic Client Registration, a Client ID Metadata Document, or a client you enter in the portal. The [OAuth checker](/tools/oauth-check) traces each of these steps.

## ChatGPT Directory

From the [Plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines) and [Upload and submit your plugin](https://developers.openai.com/plugins/deploy/submission):

| Requirement | What the docs say | mcptest |
| --- | --- | --- |
| Annotations | `readOnlyHint`, `destructiveHint` and `openWorldHint` set to explicit booleans on every tool | Checked |
| Descriptions | Every tool has a nonempty description that matches its behaviour | Checked (presence) |
| Tool names | Unique within the server, plain language, ideally a verb | Checked (uniqueness) |
| Authentication | No authentication, OAuth, or mixed unauthenticated and OAuth access | Checked |
| Privacy policy | Published, covering data categories, purposes, recipients, retention, and controls | Manual |
| Reviewer account | Demo account with sample data, no MFA, email codes, or magic links | Manual |
| Domain verification | Challenge token served at `/.well-known/openai-apps-challenge` | Manual |
| Review information | Five positive and three negative test cases, a video walkthrough, release notes | Manual |
| Listing text | Clear name and description; do not append "MCP" or "Plugin" to a product name | Manual |
| UI | Iframe origins declared in `_meta.ui.csp.frameDomains`, with a justification | Manual |

OpenAI's guidance on hints is precise. `readOnlyHint: false` covers any external change, including queued jobs and sent messages. `destructiveHint: true` covers deletion, overwriting, cancellation and irreversible sends. Being able to undo an action does not make it non-destructive. `openWorldHint: true` covers public or open-ended targets such as web search.

## Run the preflight in a report

Open a server's report in mcptest and look at the **Connector directory preflight** section. It reuses the report's evidence and does not connect again. It shows the tool annotations, the authorization challenge, OAuth discovery, and PKCE results for each directory, and links every item to its source. Items that only you can confirm, such as the privacy policy, appear as an unchecked list rather than a pass or a fail. An item stays unknown when the report has no evidence for it, for example tool checks before you authorize.

The CLI prints the same summary for each endpoint and appends the full checklist to the Markdown artifact:

```bash
npm run mcptest -- --format markdown https://mcp.example.com/mcp
```

The preflight also flags, as an advisory only, a tool whose `action` or `operation` argument selects both reads and writes. That shape cannot carry one accurate `readOnlyHint` or `destructiveHint`, so a reviewer may flag it under the one-operation-per-tool rules above. The detection is a naming heuristic. If the operations are genuinely one capability, you can ignore it.

## Before you submit

1. Run a full report and fix every failed preflight item.
2. Add the server to Claude as a custom connector ([how](/learn/add-remote-mcp-server-to-claude)) and connect it in ChatGPT ([how](/learn/connect-mcp-server-to-chatgpt)), then call every tool from a conversation.
3. Prepare the manual items: privacy policy, documentation, support contact, icon, reviewer account, and for ChatGPT the test cases and video.
4. Re-read the linked vendor pages. They change faster than this guide.
