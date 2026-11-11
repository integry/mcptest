---
title: MCP server evaluation and trust checklist
summary: "Evaluate a server's publisher, code and hosting, permissions, authentication, write behavior, evidence, logging, and revocation before connecting it."
track: build
level: practitioner
order: 3
category: Security and trust
readingTimeMinutes: 10
lastReviewed: "2026-11-11"
relatedSlugs:
  - how-to-vet-an-mcp-server
  - mcp-clients-compared
  - designing-production-mcp-server
sourceLinks:
  - title: "MCP 2026-07-28 specification: Security and trust & safety"
    url: "https://modelcontextprotocol.io/specification/2026-07-28"
  - title: "MCP 2026-07-28 specification: Tools (tool safety, annotations)"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/server/tools"
  - title: "MCP 2026-07-28 specification: Streamable HTTP (transport security)"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
  - title: "MCP 2026-07-28 specification: Authorization"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
  - title: MCP security best practices
    url: "https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices"
  - title: VS Code MCP server trust guidance
    url: "https://code.visualstudio.com/docs/agent-customization/mcp-servers"
  - title: "VS Code: Manage MCP servers (server trust and sandboxing)"
    url: "https://code.visualstudio.com/docs/agents/run/manage-mcp-servers"
  - title: OpenAI MCP app safety guidance
    url: "https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt"
---

For a repeatable approval process and organisation-wide client controls, see [how to vet an MCP server: assessment, audit and allowlisting](/learn/how-to-vet-an-mcp-server).

## Trust is a chain, not a badge

Connecting an MCP server can give an AI host access to local code, private data, external accounts, or write operations. None of these establish that a server is safe:

- it "uses MCP";
- it is listed in a directory;
- its tool names look familiar;
- a connection test succeeds.

Evaluate the whole chain together: the publisher, the distributed code, the runtime, the hosting operator, the authorization server, the downstream APIs, the tools, and the controls in your client.

Run this checklist before connecting, after meaningful updates, and on a fixed review date. Ask for more evidence as the impact grows. A public documentation search tool is a different risk from a local shell, a payroll writer, a production database, or a messaging integration.

## 1. Publisher and distribution

- Is the publisher the service owner, a known maintainer, or an unrelated third party?
- Does the product page link to the exact repository, package, endpoint and support channel?
- For a package: are the owner accounts protected, releases signed or provenance-attested, dependencies locked, and versions pinned?
- Does a one-click install resolve to the same command and arguments you reviewed?
- Is there a security policy, a way to report vulnerabilities, a release history, and a record of past responses?
- Has the package or endpoint changed owner, domain or behavior since the last review?

Typosquatting is especially dangerous for stdio examples that run `npx`, `uvx`, containers or install scripts. Confirm the exact package owner and version. Do not run a floating "latest" version for production or sensitive work.

## 2. Code, runtime, and hosting

**Local stdio servers** run with your operating system permissions unless the client or the OS sandboxes them. Inspect:

- the command, arguments and environment variables;
- the working directory and which files it can reach;
- whether it starts child processes;
- its outbound network access.

Some clients can sandbox local servers. For example, VS Code can restrict file system and network access for stdio servers with `sandboxEnabled` on macOS and Linux, but not on Windows. Open source helps review, but does not prove that the installed artifact matches the repository.

A local server that listens on HTTP instead of stdio must validate the `Origin` header and should bind only to `127.0.0.1`. The specification requires this to stop websites from reaching it through DNS rebinding.

**Remote HTTP servers** need different checks:

- TLS and the owner of the endpoint;
- the hosting region and operator;
- data retention, subprocessors and deletion policy;
- tenant isolation, incident history and availability expectations.

Ask whether prompts, tool arguments, results or tokens are stored or used for training. A remote server can change without a package update, so monitoring and review dates matter.

## 3. Requested permissions

List the permissions in terms a user would recognise:

| Permission | Questions |
| --- | --- |
| Read | Which accounts, projects, folders, messages, records, or local paths? Are private fields filtered? |
| Write | Can it create, edit, send, publish, merge, deploy, purchase, invite, or change access? |
| Delete | Is deletion soft or reversible? Is bulk deletion possible? |
| Execute | Can it run shell commands, code, browser automation, SQL, or fetch arbitrary URLs? In which sandbox? |
| Share | Can returned data go to the model provider, other servers, third parties, or logs? |
| Admin | Can it manage credentials, members, billing, permissions, or audit settings? |

Prefer the least privilege that does the job: narrow scopes, restricted service accounts, test tenants, read-only keys, limited local directories, and short-lived credentials. Reject a generic all-access token when the documented job only needs one project or read-only search.

## 4. Authentication and token handling

For an OAuth server, check each step of the flow:

- The protected resource metadata names the authorization server you expect.
- The browser opens that authorization server, not a look-alike.
- The requested scopes match the job.
- PKCE is used.
- The token is requested for this MCP server (the `resource` parameter), and the server only accepts tokens issued for it.
- Revoking access works.
- Reauthorization shows the user any change in scopes.

Find out where access tokens, refresh tokens and client credentials are stored, and how they are encrypted. A server that forwards your token to another API is a red flag: the specification forbids MCP servers from passing tokens through.

For an API key, find out who creates, rotates, revokes and can read it. Do not put keys in URLs, source control, shared workspace configuration, screenshots or model prompts.

For a server without authentication, confirm that it only serves public, non-sensitive data. Make sure it cannot be used as an open relay or as an anonymous surface for expensive writes.

A login prompt proves that you authenticated to something. The issuer and the scopes tell you what. A valid OAuth flow does not prove that the publisher of the MCP server is safe.

## 5. Tool surface and write behavior

Read every tool name, description and input schema before you enable the server. Flag any tool that:

- accepts arbitrary commands, URLs or raw SQL;
- accepts broad filesystem paths;
- takes credentials as inputs;
- sends to recipients the user is not shown;
- previews and commits in one call.

Check that names and descriptions state side effects plainly.

For write tools, require server-side authorization, input validation, idempotency, audit IDs, and safe retries. High-impact operations should offer a preview or dry run, an explicit target and scope, and a way to reverse them. Test what happens when the client times out after the server has committed: a blind retry must not duplicate a payment, message, ticket or deployment.

Tool annotations such as `readOnlyHint` and the publisher's descriptions are claims made by the server. The specification says clients **MUST** treat annotations as untrusted unless the server is trusted. Confirm critical properties with code review, controlled tests and logs.

## 6. Client controls and prompt-injection exposure

The specification says a human **SHOULD** always be able to deny a tool call. Confirm that the client shows which server supplied a tool, and shows its arguments and results.

Check which of these the client controls separately:

- trusting the server at install or first start;
- enabling individual tools;
- confirming each call, and confirming writes;
- auto-running tools without confirmation.

Keep auto-run off during evaluation. Clients store trust differently, so learn how yours does. In VS Code, for example, servers configured in a trusted workspace start without a separate MCP trust prompt, even after their configuration changes. **MCP: Reset Trust** clears VS Code's own MCP trust decisions but not tool approvals. Reset stored trust yourself after a configuration or publisher change.

Any server that reads web pages, tickets, messages, documents or repositories can return hostile instructions hidden in the data. This is called prompt injection. Test whether the host treats that content as data, and whether a malicious document can trigger a sensitive tool call. Limit which other tools are enabled alongside it: injection does the most damage when read access can trigger unrelated writes.

## 7. Logging, privacy, and incident response

The publisher should state:

- what it logs, and for how long;
- who can access logs, and what is redacted;
- how tenants are separated;
- how data is deleted.

Logs should let you correlate requests and audit writes without recording tokens or unnecessary content. Your organization should be able to answer: who invoked which operation, against which target, under which identity, and with what outcome?

Keep your own record of each connection:

- owner and business purpose;
- approved scopes;
- server version or endpoint, and a hash of the configuration;
- test evidence and review date;
- how to revoke it.

Decide who disables the integration during an incident, and how to find every installed copy.

## 8. Testing evidence

Do not accept a screenshot of "connected" on its own. Look for, or produce:

- the exact endpoint or package digest tested, and the date;
- supported client and protocol versions;
- the discovered tools, resources and prompts, compared with the documentation;
- schema boundary and malformed-input tests;
- cross-user and cross-tenant authorization tests;
- OAuth first login, refresh, revocation and insufficient-scope tests;
- write idempotency and timeout-after-commit tests;
- rate limit, body and output size, cancellation and dependency failure tests;
- checks that secrets and sensitive data are redacted;
- evidence of the local sandbox or remote isolation;
- a reproducible test in the [MCP Playground](/) or the official Inspector.

Community reports can suggest what to test, but they are anecdotal. Base approval decisions on specification requirements, vendor documentation, source review and reproducible evidence.

## Decision record

End every review with one of four explicit outcomes:

- **Approved** for named users, data and actions.
- **Approved with controls**, such as read-only access, a sandbox, a test tenant, or per-call confirmation.
- **Needs evidence**, with a named owner and a deadline.
- **Rejected**, naming the requirement that failed.

Set an expiry or next review date. Review again when any of these happen:

- the owner, domain or authorization server changes;
- new write tools appear or scopes expand;
- dependencies or the runtime change materially;
- the client's trust policy changes;
- an incident occurs.

Remove connections nobody uses, and revoke their credentials. Disabling a server in the UI can leave a valid token behind.
