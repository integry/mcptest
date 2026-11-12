---
title: MCP server evaluation and trust checklist
summary: "Evaluate a server's publisher, code and hosting, permissions, authentication, write behavior, evidence, logging, and revocation before connecting it."
track: build
level: practitioner
order: 3
category: Security and trust
readingTimeMinutes: 9
lastReviewed: "2026-10-25"
relatedSlugs:
  - how-to-vet-an-mcp-server
  - mcp-clients-compared
  - designing-production-mcp-server
sourceLinks:
  - title: "MCP specification: Security and trust principles"
    url: "https://modelcontextprotocol.io/specification/2024-11-05/index"
  - title: "MCP specification: Tool safety"
    url: "https://modelcontextprotocol.io/specification/draft/server/tools"
  - title: "MCP specification: Transport security"
    url: "https://modelcontextprotocol.io/specification/2025-06-18/basic/transports"
  - title: "MCP specification: Authorization"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization"
  - title: VS Code MCP server trust guidance
    url: "https://code.visualstudio.com/docs/agent-customization/mcp-servers"
  - title: OpenAI MCP app safety guidance
    url: "https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt"
---

For a repeatable approval process and organisation client controls, see [how to vet an MCP server: assessment, audit and allowlisting](/learn/how-to-vet-an-mcp-server).

## Trust is a chain, not a badge

Connecting an MCP server can give an AI host access to local code, private data, external accounts, or write operations. “Uses MCP,” a directory listing, a familiar tool name, or a successful connection test does not establish safety. Evaluate the publisher, distributed code, runtime, hosting operator, authorization server, downstream APIs, tools, and client controls as one chain.

Use this checklist before connecting, after meaningful updates, and on a regular review date. Raise the evidence bar with impact: a public documentation search tool is not the same risk as a local shell, payroll writer, production database, or messaging integration.

## 1. Publisher and distribution

- Is the publisher the service owner, a known maintainer, or an unrelated third party?
- Does the product page link to the exact repository, package, endpoint, and support channel?
- For a package, are owner accounts protected, releases signed or provenance-attested, dependencies locked, and versions pinned?
- Does a one-click install resolve to the same command and arguments you reviewed?
- Is there a security policy, vulnerability-reporting path, release history, and response record?
- Has the package or endpoint changed owners, domains, or behavior since the last review?

Typosquatting is especially dangerous for stdio examples that run `npx`, `uvx`, containers, or install scripts. Resolve the exact package owner and version. Avoid floating “latest” execution for production or sensitive work.

## 2. Code, runtime, and hosting

For local stdio, inspect the command, arguments, environment variables, working directory, filesystem reach, child-process behavior, and outbound network access. Local servers execute with the user's OS permissions unless the client or operating system provides a sandbox. Open source helps review but does not prove the installed artifact matches the repository.

For remote HTTP, verify TLS, the endpoint owner, hosting region/operator, data retention, subprocessors, tenant isolation, incident history, availability expectations, and deletion policy. Ask whether prompts, tool arguments, results, and tokens are stored or used for training. A remote server can change without a package update, so monitoring and review dates matter.

## 3. Requested permissions

Inventory permissions in user language:

| Permission | Questions |
| --- | --- |
| Read | Which accounts, projects, folders, messages, records, or local paths? Are private fields filtered? |
| Write | Can it create, edit, send, publish, merge, deploy, purchase, invite, or change access? |
| Delete | Is deletion soft/reversible? Is bulk deletion possible? |
| Execute | Can it run shell commands, code, browser automation, SQL, or arbitrary URLs? In which sandbox? |
| Share | Can returned data go to the model provider, other servers, third parties, or logs? |
| Admin | Can it manage credentials, members, billing, permissions, or audit settings? |

Prefer least-privilege scopes, restricted service accounts, test tenants, read-only keys, limited local directories, and short-lived credentials. Reject a generic all-access token when the documented job only needs one project or read-only search.

## 4. Authentication and token handling

For OAuth, verify protected-resource metadata points to the expected authorization server; the browser opens the expected issuer; requested scopes match the job; PKCE is used; the token is bound to the MCP resource; revocation works; and reauthorization makes scope changes visible. Determine where access tokens, refresh tokens, and client credentials are stored and encrypted.

For API keys, identify who creates, rotates, revokes, and can read the key. Do not put keys in URLs, source control, shared workspace configuration, screenshots, or model prompts. For an authless server, confirm it truly serves public/non-sensitive data and cannot be used as an open relay or expensive anonymous write surface.

A client login prompt authenticates something; inspect the issuer and scopes to know what. A valid OAuth flow does not prove the MCP publisher is safe.

## 5. Tool surface and write behavior

Read every tool name, description, and input schema before enabling the server. Flag tools with arbitrary commands, unrestricted URLs, raw SQL, broad filesystem paths, credential inputs, hidden recipients, or combined preview-and-commit behavior. Check whether names and descriptions plainly disclose side effects.

For writes, require server-side authorization, validation, idempotency, audit IDs, and safe retry behavior. High-impact operations should offer preview/dry run, explicit target and scope, and a reversible path. Test what happens when the client times out after the server commits; a blind retry must not duplicate payments, messages, tickets, or deployments.

Tool annotations and publisher descriptions are claims from the server. The MCP specification tells clients to treat annotations as untrusted unless the server itself is trusted. Confirm critical properties through code, controlled tests, and logs.

## 6. Client controls and prompt-injection exposure

Confirm the client shows which server supplied a tool, its arguments, and results. Determine whether installation trust, per-tool enablement, per-call confirmation, write confirmation, and auto-run are separate controls. Keep auto-run off during evaluation. Reset stored trust after configuration or publisher changes.

Any server that reads web pages, tickets, messages, documents, or repositories can return hostile instructions embedded in data. Test whether the host distinguishes content from instructions and whether a malicious document can cause a sensitive tool call. Limit which other tools are enabled in the same session, because prompt injection becomes more damaging when read access can trigger unrelated writes.

## 7. Logging, privacy, and incident response

The publisher should state what it logs, retention duration, access controls, redaction, tenant boundaries, and deletion process. Logs should support request correlation and write audits without recording tokens or unnecessary content. Verify the organization can answer: who invoked which operation, against which target, under which identity, and with what outcome?

Record your own connection owner, business purpose, approved scopes, server version/endpoint, configuration hash, test evidence, review date, and revocation instructions. Define who disables the integration during an incident and how to find every installed copy.

## 8. Testing evidence

Do not accept only a screenshot of “connected.” Look for or produce:

- exact tested endpoint/package digest and date;
- supported client and protocol versions;
- discovered tools/resources/prompts compared with documentation;
- schema boundary and malformed-input tests;
- cross-user and cross-tenant authorization tests;
- OAuth first login, refresh, revocation, and insufficient-scope tests;
- write idempotency and timeout-after-commit tests;
- rate limits, body/output limits, cancellation, and dependency failure tests;
- secret and sensitive-data redaction checks;
- local sandbox or remote isolation evidence;
- a reproducible test in the [MCP Playground](/) or official Inspector.

Community reports can reveal questions worth testing, but they are anecdotal. Prefer specification requirements, vendor documentation, source review, and reproducible evidence for approval decisions.

## Decision record

End the review with one of four explicit outcomes: **approved** for named users/data/actions; **approved with controls** such as read-only, sandbox, test tenant, or per-call confirmation; **needs evidence** with a named owner and deadline; or **rejected** with the failed requirement.

Set an expiry or next-review date. Re-review on ownership change, domain or authorization-server change, new write tools, expanded scopes, material dependency/runtime changes, client trust-policy changes, or an incident. Remove unused connections and revoke credentials—disabled UI alone may leave a valid token behind.
