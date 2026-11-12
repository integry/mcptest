---
title: "How to vet an MCP server before you connect it: assessment, audit and allowlisting"
navTitle: Vet an MCP server
summary: Turn an MCP server assessment into an approval decision with recorded evidence, a limited pilot, organisation allowlisting and a repeatable audit trail.
track: understand
level: practitioner
order: 43
category: Security and trust
readingTimeMinutes: 7
lastReviewed: "2026-10-25"
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
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices"
---

An MCP server assessment should answer a concrete question: may this client connect this account to this endpoint for this task? A successful connection is useful evidence, but approval also needs an owner, permitted data and actions, and a way to revoke access.

Start with [Is MCP safe?](/learn/is-mcp-safe) for the threat model and use the [server trust checklist](/learn/mcp-server-trust-checklist) for detailed publisher, runtime, permission and logging checks. This guide turns those checks into a decision and an organisation allowlist rather than repeating them.

## Define the assessment boundary

Name the task before reviewing tools. “Read issues in the test project” is assessable; “give the assistant access to our company” is not. Record the exact public endpoint including its path, the publisher, client, account or tenant, and requested scopes. For local servers, record the package version and executable arguments as well.

Choose a risk owner who can accept the data exposure. A documentation lookup and a production database writer need different evidence. Identify what could leave the organisation through tool arguments and what a malicious result could persuade the assistant to do next. Consider combinations with other enabled tools, such as a private file reader plus an external message sender.

## Collect evidence with mcptest's server report

Find the endpoint in the [server catalog](/catalog) and open its report. Compare the report with the publisher's official documentation; a matching name alone is insufficient.

| Report evidence | What it helps assess | What still needs review |
| --- | --- | --- |
| Endpoint and listing source | Whether you are testing the intended service | Publisher ownership and hosting contract |
| Declared and detected authentication | How the server challenges clients | Account privileges, scopes and token storage |
| Validation timestamp and status | When a connection was last observed | Current availability and production behavior |
| Tool inventory and schemas | Which actions were observed, including write operations | Implementation, hidden side effects and changes after review |
| Client setup and compatibility | Whether the selected host can connect | Your managed client policy and actual permissions |

An inventory missing behind OAuth means the public validator did not observe those tools. It does not mean the server offers no tools. Use a dedicated test account to [connect in the inspector](/), list the current tools and inspect their descriptions and schemas. Follow the [testing guide](/docs/testing-guide) and save a redacted report with the assessment. A green transport check is not a security certification or a code audit.

## Run a limited pilot before approval

Use synthetic data and the narrowest available credential. First test read-only operations, then any proposed write in a disposable project with a documented rollback. Verify denied operations actually fail: another tenant, an unapproved project or an out-of-scope action. A tool's name or read-only annotation is a claim to verify, not an access boundary.

Review raw tool descriptions and results for instructions that request secrets, bypass approvals or redirect the assistant to unrelated services. Test cancellation, error handling and confirmation for consequential actions. Have the owner demonstrate revocation, then confirm the revoked credential no longer works. Keep credentials out of exported evidence.

## Organisation allowlisting: enforce approval in the client

Maintain an approved set of endpoints, versions and actions. Apply it through the controls for each actual client; a network firewall allowlist alone does not restrict which tools an assistant can invoke. Plan and deployment differences matter, so verify the linked official controls in your tenant.

- **Claude:** [organisation custom connector settings](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) let authorised owners add remote connectors before members use them. Team and Enterprise roles govern who may add them. Review individual authentication and any shared credential separately. Local Desktop servers use a separate configuration surface; approval of a remote connector does not govern those processes.
- **ChatGPT:** use [workspace plugin controls](https://learn.chatgpt.com/docs/enterprise/apps-and-connectors) to govern MCP connections and role access. Where supported, constrain actions to a reviewed set and control newly added actions. Workspace availability, action permissions and service account scopes are separate controls. Verify all three before enabling access.
- **VS Code:** deploy [enterprise MCP policies](https://code.visualstudio.com/docs/enterprise/policies). `ChatAllowedMcpServers` limits which servers may install or run; `ChatDeniedMcpServers` blocks matches even when allowed. `ChatAllowManagedMcpServersOnly` selects the enterprise-managed allowlist, and `ChatMCP` controls MCP access. Verify the managed policy on a user's installed version and test that an unapproved server is blocked.

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

An MCP server audit checks that the deployed connection still matches that record. Re-review when the endpoint, publisher, authorization issuer, scopes, tool definitions or hosting terms change, or when an incident affects the service. Remote implementations can change without a local install. Compare fresh tool listings against the approved inventory and pause newly introduced write actions pending review.

This makes “are MCP servers safe?” a bounded decision supported by evidence. Use the [trust checklist](/learn/mcp-server-trust-checklist) for deeper review when the pilot exposes a gap.
