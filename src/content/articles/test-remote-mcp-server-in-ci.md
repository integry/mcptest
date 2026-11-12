---
title: Test your remote MCP server in CI with GitHub Actions
navTitle: GitHub Actions release gate
summary: Gate a remote MCP deploy on client compatibility and tool changes against the last release, with a readable PR comment and optional public report.
track: build
level: practitioner
order: 408
category: Testing
readingTimeMinutes: 6
lastReviewed: "2026-11-11"
metaTitle: Test Remote MCP Servers in GitHub Actions | mcptest.io
metaDescription: Add a remote MCP release gate to GitHub Actions. Check client readiness, compare tools against a baseline and post a PR summary alongside official conformance tests.
relatedSlugs:
  - test-mcp-server-before-deploying
  - which-mcp-tool-changes-break-clients
  - mcp-client-support-matrix
sourceLinks:
  - title: Official MCP conformance framework and action
    url: https://github.com/modelcontextprotocol/conformance
  - title: mcptest action inputs and release policy
    url: https://github.com/integry/mcptest/blob/master/docs/headless-release-gate.md
---

A successful connection does not tell you two things: whether a deploy is ready
for the clients your users run, and whether an agent that cached yesterday's
tool list can still call today's tools. The mcptest GitHub Action checks both
before you release. The [CI setup page](/ci) has a complete workflow and an
example PR comment.

## Start with a public preview endpoint

The action connects to a remote URL. It does not build or deploy your MCP
server, so deploy a reachable preview first, then add this workflow:

To try the workflow before you have a preview, point `endpoints` at the
[public echo test server](/mcp-test-servers#fixture-echo),
`https://mcptest.io/fixtures/echo/mcp`. Its responses never change, so it is
also a stable target for testing an MCP client in CI.

```yaml
name: MCP release gate
on: [pull_request, workflow_dispatch]
permissions:
  contents: read
  pull-requests: write
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: integry/mcptest@v1
        with:
          endpoints: https://mcp.example.com/mcp
          baseline: none
          fail-on: blocked
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: mcptest-reports
          path: mcptest-reports/
```

The `v1` tag is created by the maintainer when the action is published. On
11 November 2026 the repository had no tags yet, so `@v1` does not resolve.
Until it does, replace `v1` with the full SHA of a commit you have reviewed.
A full SHA is also the safest pin for production workflows.

You do not need to check out or install mcptest. The action:

1. sets up Node 22 and installs its own dependencies in the action directory;
2. evaluates each endpoint and writes JSON and Markdown reports to a new
   directory under `mcptest-reports/`;
3. writes the job summary;
4. creates or updates one sticky PR comment. Set `comment: 'false'` to turn
   this off. On fork PRs the token usually cannot write, so the comment is
   skipped, while the evaluation, summary and artifacts still run.

## Require the clients your users run

Set `clients` to a comma- or newline-separated list of client ids, for example
`clients: claude-ai,chatgpt,cursor,vscode-copilot,claude-code,codex-cli`. The
supported ids are `claude-ai`, `claude-desktop`, `claude-code`, `chatgpt`,
`codex-cli`, `cursor`, `vscode-copilot`, `windsurf` and `gemini-cli`. An unknown
id fails the run as a configuration error.

Each listed client is checked in addition to the overall release decision:

| Client verdict | Effect on the gate |
| --- | --- |
| Incompatible | `blocked` |
| Unknown evidence | `unknown`, which fails |
| Compatible with caveats | `review` |
| Compatible | No change |

These verdicts come from the compatibility engine's sourced client profiles,
including their transport and OAuth assumptions. The action does not launch
Claude, ChatGPT or an IDE. A Node process also cannot test browser CORS or
complete an interactive OAuth login, and the report says so. Use the browser
tester for browser evidence, and confirm the integration in your target
clients. See the [client support matrix](/learn/mcp-client-support-matrix).

`fail-on: blocked` (the default) lets `review` decisions pass and fails
`blocked`, `unknown` and `authorization-required` runs. `fail-on: review` also
fails `review` decisions.

## Compare against the last release

Start with `baseline: none`. For later runs, choose one of:

- **A previous release's JSON report**, for example
  `baseline: baselines/release.json`. The path is relative to your workspace,
  so check out your repository or download that artifact first. The report's
  endpoint must match the endpoint being evaluated, or the run fails.
- **`baseline: published`**, which reads the latest report published for that
  endpoint on mcptest.io, before this run publishes anything. If none exists
  the run fails with `unknown`, so bootstrap with `none` first.

Compare a stable endpoint, or a local baseline captured for the same preview
URL. With published history, the baseline is simply the latest published run.
If it must mean "the last release", publish only from trusted release jobs.

What the comparison reports:

- **Breaking, blocks the gate:** removed or renamed tools, removed prompts and
  resources, new required inputs and narrowed input schemas.
- **Risky, needs review:** rewritten descriptions and input changes mcptest
  cannot classify.
- **Safe:** additive changes, such as a new tool.

The summary groups findings by tool and links to
[why each change matters](/learn/which-mcp-tool-changes-break-clients).
Report snapshots do not record output schemas or annotations, so those
contracts are not compared, and the summary states that limitation. If either
report has an incomplete tool list, or only tool names could be compared, the
decision is `unknown`. It never counts as proof of backward compatibility.

## Secrets, resilience and publishing

Pass the **name** of an environment variable that holds the secret, never the
value:

```yaml
- uses: integry/mcptest@v1
  env:
    REMOTE_MCP_TOKEN: ${{ secrets.REMOTE_MCP_TOKEN }}
  with:
    endpoints: https://mcp.example.com/mcp
    bearer-token: REMOTE_MCP_TOKEN
    baseline: published
    session-resilience: 'true'
    publish: 'true'
```

For an API key sent as `X-API-Key`, use `api-key: REMOTE_MCP_KEY` and set that
variable instead. You cannot set both `bearer-token` and `api-key`. With a
credential, every endpoint must use HTTPS and share one origin. Endpoint URLs
with userinfo, fragments or credential-like query parameters are rejected.
Credentials are redacted from reports and sent only to the MCP target, never to
the publishing or GitHub APIs.

`session-resilience: 'true'` adds bounded session probes. They use temporary
sessions and pings, never call tools, and mark stateless endpoints as not
applicable. A short clean sample does not prove the server survives restarts.

Publishing is off by default. `publish: 'true'` makes the redacted endpoint and
report public and adds a permalink to the summary and comment. Decide whether
that is acceptable for your endpoint first.

Later steps can read four outputs:

| Output | Value |
| --- | --- |
| `decision` | Worst decision across endpoints: `ready`, `review`, `blocked`, `unknown` or `authorization-required` |
| `breaking-count` | Number of breaking findings, or `unknown` when the comparison could not run |
| `report-path` | Absolute directory with this run's JSON, Markdown and `summary.md` |
| `report-url` | First published permalink, or empty when publishing is off |

Keep the artifact upload on `if: always()` so a failed gate stays inspectable.

## Run official conformance alongside readiness

The [official MCP conformance framework](https://github.com/modelcontextprotocol/conformance)
tests client and server implementations against the MCP specification. It
ships its own GitHub Action. For a server, it takes `mode: server` and the
server `url`; see its README for the current release tag and other inputs.

mcptest answers different questions: client-profile readiness, OAuth evidence,
browser limits, tool changes against a baseline and optional session
resilience. A green release gate is not a conformance certification, and
conformance alone does not tell you whether a cached tool contract broke. Run
both.

The [action reference](https://github.com/integry/mcptest/blob/master/docs/headless-release-gate.md)
lists every input. It also covers the CLI and the reusable workflow, which
remain supported for callers who need custom threshold policies.
