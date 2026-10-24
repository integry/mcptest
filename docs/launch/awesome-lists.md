# Awesome-list submissions

Ready-to-paste entries for curated lists that accept MCP tools. **No pull requests have been opened.** The maintainer decides which to submit.

Every list below was checked on 2026-10-21 with `gh api repos/<owner>/<repo>` (README, CONTRIBUTING.md, latest commit) and by searching each repository's pull requests for "mcptest" (none found). Star counts and dates are from that day. Lists change: before submitting, reread the section and the rules, and match whatever format the neighbouring entries use then.

The descriptions use only facts from [press-facts.md](press-facts.md). Where a list asks for a repository link, the entry links `https://github.com/integry/mcptest`; the language is TypeScript.

## Summary

| List | Fit | File and section | Activity on 2026-10-21 |
| --- | --- | --- | --- |
| [punkpeye/awesome-mcp-devtools](https://github.com/punkpeye/awesome-mcp-devtools) | Best | `README.md`, `## Testing Tools` | Last commit 2026-08-04; about 200 open PRs, slow to merge |
| [AlexMili/Awesome-MCP](https://github.com/AlexMili/Awesome-MCP) | Good | `README.md`, `## Tools` (table) | Last commit 2026-10-19; active |
| [collabnix/awesome-mcp-lists](https://github.com/collabnix/awesome-mcp-lists) | Good | `README.md`, `### Testing Tools` (table) | Last commit 2026-10-19; active |
| [punkpeye/awesome-mcp-clients](https://github.com/punkpeye/awesome-mcp-clients) | Fair (web client entry) | `README.md`, `## Clients` | Last commit 2026-06-07; 136 open PRs |
| [modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry) | Weak | `docs/community-projects.md`, `### Other` | Last commit 2026-10-11; community entries still merged |

## 1. punkpeye/awesome-mcp-devtools

- **File and section:** `README.md`, `## Testing Tools` ("Tools for testing MCP servers and clients").
- **Already listed there:** `modelcontextprotocol/inspector` (📇 🎖️), `mcpjam/inspector`, `muppet-kit/inspector`, `wong2/mcp-cli`. Postman and Glama are not listed.
- **Rules (CONTRIBUTING.md):** name linked to the repository; brief description of what it does; correct section; "Maintain alphabetical order within each category"; "Follow the existing format and style … formatting, capitalization, and punctuation". Language emoji from the README legend (📇 = TypeScript; 🎖️ is for official implementations only, so do not use it). No badge or CI check.
- **Placement:** the rule says alphabetical, but the section is not sorted in practice. Put the line after `muppet-kit/inspector` or wherever keeps the nearest entries in order, and mention that in the PR.

Entry:

```markdown
- [integry/mcptest](https://github.com/integry/mcptest) 📇 - Browser-based inspector and evaluator for remote MCP servers (Streamable HTTP and legacy SSE). Records browser CORS evidence, runs OAuth 2.1 with PKCE in the browser, and produces shareable reports with README badges. Hosted at mcptest.io; also has a headless CLI for CI.
```

Suggested PR title: `Add integry/mcptest to Testing Tools`.

## 2. AlexMili/Awesome-MCP

- **File and section:** `README.md`, `## Tools` ("Tooling that helps you build, test, secure, deploy or manage MCP servers.").
- **Already listed there:** the official Server inspector (✅) and ytkoka's MCP Server Tester, a web-based remote inspector. MCPJam is not listed.
- **Rules (CONTRIBUTING.md):**
  - The name links to the GitHub repository, and that is the only link in the row.
  - The description is one sentence: start with a capital, end with a period, no links, no marketing language.
  - The language column takes the devicon `<img>`.
  - Fill Activity and ⭐ with the placeholders `🟢 0d` and `0`. Do not add ✅ yourself.
  - Add the row as the last line of the section; the table is sorted by stars, not alphabetically.
  - One entry per pull request, titled `Add <Name> to <Category>`.

Entry (one sentence, no links in the description):

```markdown
| [mcptest](https://github.com/integry/mcptest) | Browser-based inspector and evaluator for remote MCP servers that records browser CORS evidence, runs OAuth 2.1 with PKCE, and publishes shareable reports with README badges. | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/typescript/typescript-original.svg" width="18" alt="TypeScript" title="TypeScript"> | 🟢 0d | 0 |
```

Suggested PR title: `Add mcptest to Tools`.

## 3. collabnix/awesome-mcp-lists

- **File and section:** `README.md`, `### Testing Tools`, with columns `# | Tool Name | Language | Description`. It currently has 4 rows, the first being `modelcontextprotocol/inspector`.
- **Rules (CONTRIBUTING.md):**
  - Add one row as the last row of the table, and continue the numbering.
  - Match the table's columns exactly.
  - The description is one specific sentence, with no trailing period required. Describe capabilities, not adjectives. Escape any `|` as `&#124;`.
  - The link must work and be direct, with no tracking redirect.
  - Search for duplicates first.
  - Contributions are released under CC0 1.0.
  - The list prefers projects that are runnable. A hosted web app qualifies.
- **Alternative:** if a maintainer prefers, an issue with the "Suggest an MCP project" template is the documented route that avoids a PR.

Entry (row number assumes the table still ends at 4):

```markdown
| 5 | [integry/mcptest](https://github.com/integry/mcptest) | TypeScript | Browser-based inspector and evaluator for remote MCP servers, hosted at mcptest.io: records browser CORS evidence, runs OAuth 2.1 with PKCE, and publishes shareable reports with README badges |
```

## 4. punkpeye/awesome-mcp-clients

mcptest.io is a client in the sense this list uses: it connects to servers and calls their tools. Comparable entries are "MCP Playground" (`Type: Web app`) and Apify's "Tester MCP Client". The official Inspector and MCPJam are not listed.

- **File and section:** `README.md`. Add a `### mcptest.io` block under `## Clients`, and a matching line in the table of contents at the top.
- **Rules (CONTRIBUTING.md):** client name linked to its repository or website; a brief description of what it does; "Follow the existing format and style"; "Maintain alphabetical order within each category". In practice the contents list is only roughly alphabetical. Place the entry after `MCP Playground`.
- **Format:** an HTML facts table (GitHub, Website, License, Type, Platforms, Pricing, Programming Languages), a paragraph, a "Key features" list, and an optional `<details>` block of screenshots. Screenshots are optional. The repository has some in `docs/screenshots/`, but take fresh ones from production if you include any.

Contents line:

```markdown
    - [mcptest.io](#mcptestio)
```

Entry:

```markdown
### mcptest.io

<table>
<tr><th align="left">GitHub</th><td>https://github.com/integry/mcptest</td></tr>
<tr><th align="left">Website</th><td>https://mcptest.io</td></tr>
<tr><th align="left">License</th><td>MIT</td></tr>
<tr><th align="left">Type</th><td>Web app</td></tr>
<tr><th align="left">Platforms</th><td>Web</td></tr>
<tr><th align="left">Pricing</th><td>Free</td></tr>
<tr><th align="left">Programming Languages</th><td>TypeScript</td></tr>
</table>

mcptest.io is a browser-based inspector, playground and evaluator for remote MCP servers. It negotiates MCP 2026-07-28 stateless, 2025 stateful and legacy HTTP+SSE with the official TypeScript SDK, lists tools, resources and prompts next to the raw JSON-RPC traffic, and calls tools from schema-generated forms. It does not support local stdio servers and does not run a language model.

Key Features:
- **Browser CORS evidence** - Connects directly from the page first and records whether cross-origin requests succeed and which headers are readable
- **OAuth in the browser** - OAuth 2.1 with PKCE (pre-registered client, Client ID Metadata Document, dynamic registration), bearer tokens and API keys
- **Shareable reports** - Release decision, JSON and Markdown export, public permalinks with history, README badges
- **Server catalog** - Public remote servers with weekly revalidation and per-server pages
- **Headless CLI** - Same evaluator in CI with JSON/Markdown reports and stable exit codes
```

Suggested PR title: `Add mcptest.io client`.

## 5. modelcontextprotocol/registry: `docs/community-projects.md` (weak fit)

This is the only official MCP repository that still accepts third-party entries, but the page is for "projects in the ecosystem related to the MCP Registry". mcptest.io does not browse or consume the registry. Two catalog entries cite a registry listing as their source; check with `node -e 'const c=require("./src/data/serverCatalog.json");console.log(c.filter(s=>s.listingSource?.kind==="mcp-registry").length)'`. So the `### Browsers 🔎` section does not apply. `### Other` is possible but likely to be questioned. Submit only if the catalog starts importing from the registry.

- **Rule (verbatim):** "To add your community project, submit a pull request adding a one-line entry above with format: `[project-name](link) - brief description`". Existing entries add `([source code](…))` when the link is a website.
- **Precedent:** `mcpscore` (a web UI, CLI and GitHub Action auditor) was merged into `### Other` in 2026-09.

Entry:

```markdown
- [mcptest.io](https://mcptest.io) - Browser-based inspector and evaluator for remote MCP servers, with browser CORS evidence, in-browser OAuth, shareable report permalinks with badges, and a weekly revalidated catalog of public remote servers ([source code](https://github.com/integry/mcptest)).
```

## Checked and not suitable

| List | Why not |
| --- | --- |
| [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | Servers only ("This list is for servers with a public GitHub repository"), and a CI workflow checks each entry for a Glama score badge. It sends clients to awesome-mcp-clients. |
| [punkpeye/awesome-remote-mcp-servers](https://github.com/punkpeye/awesome-remote-mcp-servers) | Hosted server endpoints only. |
| [wong2/awesome-mcp-servers](https://github.com/wong2/awesome-mcp-servers) | "We do not accept PRs." Submissions go through the mcpservers.org form, which takes servers only. |
| [appcypher/awesome-mcp-servers](https://github.com/appcypher/awesome-mcp-servers) | Archived (read-only). |
| [jaw9c/awesome-remote-mcp-servers](https://github.com/jaw9c/awesome-remote-mcp-servers) | A table of remote servers only. |
| [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | "We accept issues, not pull requests." The README points to the MCP Registry, and the old community list (`ADDITIONAL.md`) is no longer extended. |
| [bh-rat/awesome-mcp-enterprise](https://github.com/bh-rat/awesome-mcp-enterprise) | The main list needs enterprise evidence (customers, certifications, 6+ months GA). Newer projects can go to `EMERGING.md`, but the scope is hosting and running infrastructure. Revisit later. |
| MCP documentation (modelcontextprotocol.io) | No community tools page. The "Example Clients" page was removed on 2026-05-27 and `/clients` redirects. The Tools pages cover only the official Inspector. There is no submission route. |
