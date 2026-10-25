---
title: Test your remote MCP server in CI with GitHub Actions
navTitle: GitHub Actions release gate
summary: Gate a remote MCP deploy on client compatibility and tool changes against the last release, with a readable PR comment and optional public report.
track: build
level: practitioner
order: 408
category: Testing
readingTimeMinutes: 5
lastReviewed: "2026-10-25"
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

A successful connection does not tell you whether a deploy is ready for your
users' clients, or whether an agent holding yesterday's tool list can still call
today's tools. Add mcptest to your release pipeline to check both questions.
The [CI setup page](/ci) has a complete workflow and an example PR comment.

## Start with a public preview endpoint

Deploy a reachable preview server before running the gate. The action connects
to a remote URL; it does not build or deploy your MCP server.

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

The maintainer creates `v1` when publishing the action. Before then, use a
reviewed commit SHA. Pin a full SHA for reproducible production workflows.
You do not need to check out or install mcptest yourself. The action installs
its dependencies under Node 22, evaluates the endpoint, writes the job summary
and updates a single sticky PR comment. Fork PRs without write permission skip
the comment while keeping evaluation and artifacts.

## Require the clients your users run

Set `clients: claude-ai,chatgpt,cursor,vscode-copilot,claude-code,codex-cli` to
require those client ids in addition to the shared release decision. These
verdicts use the compatibility engine's sourced client profiles, including
transport and OAuth assumptions. They do not launch Claude, ChatGPT or an IDE.
An incompatible required client blocks the gate; unknown evidence fails it;
caveats need review.

Node cannot establish browser CORS or complete an interactive OAuth login.
Headless reports keep those limitations visible. Use the browser tester for
browser evidence, and confirm the integration in your actual target clients.
See the [client support matrix](/learn/mcp-client-support-matrix).

`fail-on: blocked` permits review decisions but fails blocked, unknown and
authorization-required runs. `fail-on: review` also fails review decisions.

## Compare against the last release

Start with `baseline: none`. For later runs choose one of:

- A previous release's JSON report, for example `baseline: baselines/release.json`.
  Check out your own repository or download that artifact first. The report's
  endpoint must match the endpoint being evaluated.
- `baseline: published`, which reads the latest report published for that
  endpoint at mcptest.io before this run publishes anything. No previous report
  means an unknown failure, so bootstrap with `none` first.

Use a stable endpoint or a local baseline captured for that same preview URL.
Do not compare unrelated endpoint identities. With published history, only
publish from trusted release jobs if the baseline must mean the last release;
publishing every PR would instead compare against the last published PR run.

The classifier blocks removed tools, new required inputs and narrowed input
schemas. Description and behavior changes can be risky and require review;
additive changes can be safe. The summary groups findings by tool and links to
[why each change matters](/learn/which-mcp-tool-changes-break-clients).
Current JSON report snapshots omit output schemas and annotations, so those
contracts cannot be compared; the summary states that limitation. An incomplete
tool list is unknown, never proof of backward compatibility.

## Secrets, resilience and publishing

Pass the name of a secret environment variable, never its value:

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

For API keys, use `api-key: REMOTE_MCP_KEY` and provide that environment variable.
Bearer and API-key modes are mutually exclusive. Credentials are redacted from
reports and sent only to the MCP target. Never put tokens in endpoint URLs.

Optional session resilience probes use temporary sessions and pings, never
execute tools, and report stateless endpoints as not applicable. A short clean
sample cannot guarantee restart durability.

Publishing is off by default. `publish: 'true'` makes the redacted endpoint and
report public and adds a permalink to the summary/comment. Review whether that
is appropriate for your endpoint. The `decision`, `breaking-count`, `report-path`
and `report-url` outputs let later steps consume the result. Keep artifact uploads
on `if: always()` so failed gates remain inspectable.

## Run official conformance alongside readiness

The [official conformance framework and GitHub Action](https://github.com/modelcontextprotocol/conformance)
exercise client and server implementations against the MCP specification.
mcptest focuses on client-profile readiness and deploy risk: OAuth evidence,
browser-readiness limits, tool changes against a baseline and optional session
resilience. A green release gate is not a conformance certification, and
conformance alone does not tell you whether a cached tool contract broke.
Run both, using the official action's documented inputs for its current setup.

The [action reference](https://github.com/integry/mcptest/blob/master/docs/headless-release-gate.md)
lists every input and explains the existing CLI and reusable workflow, which
remain supported for callers with custom threshold policies.
