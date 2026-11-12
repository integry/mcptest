---
title: "How to vet an MCP server before you connect it: assessment, audit and allowlisting"
navTitle: Vet an MCP server
summary: Turn an MCP server assessment into an approval decision with recorded evidence, a limited pilot, organisation allowlisting and a repeatable audit trail.
track: understand
level: practitioner
order: 43
category: Security and trust
readingTimeMinutes: 7
lastReviewed: "2026-11-11"
metaTitle: "How to Vet an MCP Server: Audit & Allowlisting | mcptest.io"
metaDescription: "Assess an MCP server before connecting: collect evidence, test permissions, audit tools and approve an organisation allowlist for Claude, ChatGPT or VS Code."
relatedSlugs:
  - mcp-server-trust-checklist
  - is-mcp-safe
  - mcp-clients-compared
  - testing-guide
sourceLinks:
  - title: "Claude organisation custom connector controls"
    url: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp"
  - title: "ChatGPT workspace plugin and MCP controls"
    url: "https://learn.chatgpt.com/docs/enterprise/apps-and-connectors"
  - title: "VS Code enterprise MCP policies"
    url: "https://code.visualstudio.com/docs/enterprise/policies"
  - title: "MCP security best practices"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices"
---

An MCP server assessment answers one concrete question: may this client connect this account to this endpoint for this task? A successful connection is useful evidence. Approval also needs an owner, a list of permitted data and actions, and a way to revoke access.

[Is MCP safe?](/learn/is-mcp-safe) covers the threat model, and the [server trust checklist](/learn/mcp-server-trust-checklist) covers the detailed publisher, runtime, permission and logging checks. This guide does not repeat them; it turns them into a decision and an organisation allowlist.

## Define the assessment boundary

Name the task before reviewing tools. “Read issues in the test project” can be assessed; “give the assistant access to our company” cannot. Record:

- the exact endpoint URL, including its path
- the publisher
- the client
- the account or tenant
- the requested OAuth scopes
- for a local server, the package version and the command-line arguments

Choose a risk owner who can accept the data exposure. A documentation lookup and a production database writer need different evidence. Identify what could leave the organisation through tool arguments, and what a malicious tool result could persuade the assistant to do next. Check combinations with other enabled tools too: a private file reader plus an external message sender can leak data that neither leaks alone.

## Collect evidence with mcptest's server page

Find the endpoint in the [server catalog](/catalog) and open its server page. Compare what the page shows with the publisher's official documentation; a matching name is not enough.

| Server page evidence | What it helps assess | What still needs review |
| --- | --- | --- |
| Endpoint and listing source | Whether you are testing the intended service | Publisher ownership and hosting contract |
| Declared and detected authentication | How the server challenges clients | Account privileges, scopes and token storage |
| Validation timestamp and status | When a connection was last observed | Current availability and production behavior |
| Tool inventory and schemas | Which actions were observed, including write operations | Implementation, hidden side effects and changes after review |
| Client setup and compatibility | Whether the selected host can connect | Your managed client policy and actual permissions |

If a server requires OAuth, the page usually has no tool inventory, because the public validator cannot sign in. That does not mean the server has no tools. Sign in with a dedicated test account in the [mcptest.io playground](/), list the current tools, and read their descriptions and schemas. Follow the [testing guide](/docs/testing-guide) and keep the resulting report with the assessment. A passing connection check is neither a security certification nor a code audit.

## Run a limited pilot before approval

Use synthetic data and the narrowest credential available.

1. Test read-only operations first.
2. Test each proposed write in a disposable project, with a documented rollback.
3. Check that denied operations actually fail: another tenant, an unapproved project, an out-of-scope action. A tool's name or read-only annotation is a claim to verify, not an access boundary.
4. Read the raw tool descriptions and results for instructions that ask for secrets, try to skip approvals or point the assistant at unrelated services.
5. Test cancellation, error handling and the confirmation step for consequential actions.
6. Have the owner revoke access, then confirm the revoked credential no longer works.

Keep credentials out of exported evidence.

## Organisation allowlisting: enforce approval in the client

Keep a list of approved endpoints, versions and actions. Enforce it through each client's own controls: a network firewall allowlist alone does not restrict which tools an assistant can call. Controls differ by plan and deployment, so check the linked documentation against your own tenant.

- **Claude:** remote connectors are added to the organisation under [Organization settings > Connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) before members can use them. On Team plans only Owners and Primary Owners can add them; on Enterprise plans, also people with a custom role that includes Manage access to Libraries. Members then connect individually with their own accounts, unless the connector uses a shared credential such as an API key, which gives every user that credential's access. Local servers in Claude Desktop are configured separately, so approving a remote connector does not govern them.
- **ChatGPT:** [workspace plugin controls](https://learn.chatgpt.com/docs/enterprise/apps-and-connectors) are layered. Member permissions decide who may use, upload or publish plugins and create custom MCP connections. Installation settings decide who can install a plugin. App access and actions decide who can use each app, which tools or actions it allows and, where supported, whether actions added later are allowed. The connected account's own permissions still apply. Check every layer before enabling access.
- **VS Code:** deploy [enterprise MCP policies](https://code.visualstudio.com/docs/enterprise/policies). `ChatAllowedMcpServers` limits which servers may be installed or run. `ChatDeniedMcpServers` blocks matching servers even when the allowlist matches them. `ChatAllowManagedMcpServersOnly` makes VS Code use only the enterprise-managed allowlist, and `ChatMCP` controls access to MCP servers as a whole. Check the policy on a user's installed version and test that an unapproved server is blocked.

Do not tell users to bypass a policy to finish setup. Route exceptions to the risk owner with a defined scope and expiry. Remove obsolete entries and revoke associated credentials when access ends.

## Record the audit decision and re-review triggers

Keep one record per approved connection:

```text
Owner and reviewer:
Task, client and environment:
Publisher and exact endpoint (or pinned package/version):
Approved accounts, scopes, data classes and actions:
Evidence date, report and permission-test results:
Decision: approved / limited pilot / rejected
Exceptions and expiry:
Revocation procedure and next review date:
```

An MCP server audit checks that the deployed connection still matches that record. Re-review when the endpoint, publisher, authorization server, scopes, tool definitions or hosting terms change, or when an incident affects the service. A remote server can change without anything being installed on your side, so compare fresh tool listings with the approved inventory and hold back new write actions until they are reviewed.

This turns “are MCP servers safe?” into a bounded decision backed by evidence. When the pilot exposes a gap, use the [trust checklist](/learn/mcp-server-trust-checklist) for a deeper review.
