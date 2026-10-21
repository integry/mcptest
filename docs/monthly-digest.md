# Monthly digest: "What changed in MCP"

One post per month that lists what changed in the MCP specification, the official SDKs, the major clients and notable remote servers. Each item says what changed and links its source. This file is the brief to hand to whoever (or whatever agent) writes the next one.

## File, slug and order

- Path: `src/content/articles/mcp-changes-YYYY-MM.md`, for example `mcp-changes-2026-11.md`. The page is served at `/learn/mcp-changes-YYYY-MM`.
- Track `reference`, level `practitioner`, category `Monthly digest`.
- `order` 60 to 99 is reserved for digests, one per month, ascending: October 2026 is 60, November 2026 is 61, and so on. Use the previous digest's order plus the number of months since it, which is the order given in the digest issue.
- Window: from the 20th of the previous month to the 20th of the publication month, inclusive. Set `lastReviewed` to the publication date. The RSS feed uses `lastReviewed` as the item date.
- Add only the new article. Do not edit earlier digests or other articles, components, styles, scripts or data. Earlier digests stay as published.

## Frontmatter

```yaml
---
title: "What changed in MCP, November 2026"
navTitle: "MCP changes, Nov 2026"
summary: "One sentence naming the two or three most important changes in the window."
track: reference
level: practitioner
order: 61
category: Monthly digest
readingTimeMinutes: 6
lastReviewed: "2026-11-20"
metaTitle: "What changed in MCP, November 2026 | mcptest.io"
metaDescription: "Under 160 characters: the window and the main changes."
relatedSlugs:
  - mcp-changes-2026-10
  - mcp-protocol-versions-explained
  - mcp-clients-compared
sourceLinks:
  - title: "Every source linked inline, in the order it appears"
    url: "https://..."
---
```

The README section "Adding a content page" lists every field and the rules the build checks.

## Sections

Use these `##` headings, in this order:

1. **Specification.** Merged SEPs, SEP status changes and changelog entries in `modelcontextprotocol/modelcontextprotocol` within the window, one item each with a link to the PR or SEP page. Say whether a change touches a published revision, the draft, or only docs and governance.
2. **SDK releases.** Every official SDK with a release in the window: name, version, date, and the changes a server or client author would notice (behavior changes, new options, security fixes). Skip dependency bumps and internal refactors.
3. **Client changes.** Claude, ChatGPT, Cursor, VS Code, Windsurf, Gemini CLI and Codex. Only documented changes that affect remote servers (transport, sign-in, protocol versions, tool and result handling), each with its source. Leave out local (stdio) changes.
4. **Remote servers.** Remote servers launched or changed, from vendor announcements only. Cross-check each against `src/data/serverCatalog.json` and `src/data/catalogValidation.json` and say whether it is in the catalog.
5. **What to do about it.** A short list of concrete actions for server authors, each tied to an item above.
6. **Try it.** One call to action at the end, pointing to the protocol versions reference (`/learn/mcp-protocol-versions-explained`) or the playground (`/server/<url>`).

If a section has nothing verifiable, write "No documented changes in this window." Do not pad it.

## Sources to check

| Area | Where |
| --- | --- |
| Specification | Merged PRs: `gh api "search/issues?q=repo:modelcontextprotocol/modelcontextprotocol+is:pr+is:merged+merged:>=YYYY-MM-20"`. Commits under `seps/` and `docs/specification/`. [Draft changelog](https://modelcontextprotocol.io/specification/draft/changelog), [SEP index](https://modelcontextprotocol.io/seps), [releases](https://github.com/modelcontextprotocol/modelcontextprotocol/releases). |
| SDKs | GitHub releases of `typescript-sdk`, `python-sdk`, `go-sdk`, `java-sdk`, `kotlin-sdk`, `csharp-sdk`, `rust-sdk`, `ruby-sdk`, `php-sdk` and `swift-sdk` under `modelcontextprotocol`: `gh api "repos/modelcontextprotocol/<repo>/releases?per_page=40"`. Also the `inspector` and `registry` repos. The [SDK tier list](https://modelcontextprotocol.io/docs/sdk) for tier changes. |
| Clients | Claude: [release notes](https://support.claude.com/en/articles/12138966-release-notes) and the Claude Code `CHANGELOG.md`. ChatGPT: [release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) and the Apps SDK changelog. [Cursor changelog](https://cursor.com/changelog). [VS Code updates](https://code.visualstudio.com/updates) and the GitHub changelog. [Windsurf changelog](https://windsurf.com/changelog). Gemini CLI and Codex: GitHub releases of `google-gemini/gemini-cli` and `openai/codex`, filtered for MCP and OAuth entries. |
| Remote servers | Vendor blogs and changelogs. The [MCP Registry](https://registry.modelcontextprotocol.io) only to confirm endpoint URLs, not as an announcement. |

## Rules

- Every claim has an inline link and an entry in `sourceLinks`. If a claim cannot be verified from a primary source dated in the window, leave it out.
- Give release dates as `YYYY-MM-DD` and versions exactly as tagged.
- Plain, factual language. No marketing words, no predictions, no ranking of vendors.
- Run `npm test`, `npm run typecheck` and `npm run build`. Check that `dist/learn/mcp-changes-YYYY-MM/index.html` exists and that the page appears in `dist/llms.txt` and `dist/learn/feed.xml`.

## How it runs

- `.github/workflows/monthly-digest.yml` runs on the 2nd of each month at 06:00 UTC and opens one issue titled "Monthly digest: What changed in MCP, <Month YYYY>" with the `AI` label. The agent that picks up `AI` issues writes the article and opens a pull request; a maintainer reviews and merges it.
- By default the issue covers the previous calendar month: the run on 2026-12-02 asks for `mcp-changes-2026-11`, window 2026-10-20 to 2026-11-20. To open an issue by hand, run the workflow from the Actions tab and set `month` (`YYYY-MM`); a month whose window has not closed yet is refused (the window closes at midnight UTC after its last day, so November 2026 can be opened from 2026-11-21).
- `scripts/digest-issue.mjs` renders the body from `.github/digest-issue-template.md`: the window dates, the slug, the `order`, the previous digest for `relatedSlugs`, and this brief without this section. Preview it with `node scripts/digest-issue.mjs --month 2026-11`; add `--now 2026-12-02` to preview a month whose window has not closed yet.
- `order` is the latest digest's order plus the months since it, so it stays ascending while an earlier issue is still open. The script refuses a month that is not after the latest digest or an order outside 60 to 99.
- Nothing is opened when the article already exists or an open or closed issue has the same title. To redo a month, delete or rename the old issue and run the workflow again.
- Edit this file to change the brief; the next issue copies it. Edit the template to change the per-month instructions.
