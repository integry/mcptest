# Gate a remote MCP deploy with GitHub Actions

Add mcptest to CI to answer two release questions: will this endpoint work with
clients such as Claude, ChatGPT, Cursor, VS Code, Claude Code and Codex, and
would this deploy break agents holding the previous tool list?

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
        id: mcp
        with:
          endpoints: https://mcp.example.com/mcp
          fail-on: blocked
          comment: 'true'
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: mcptest-reports
          path: mcptest-reports/
```

The maintainer creates `v1` when publishing; until then use a reviewed commit
SHA. Pin a full commit SHA for reproducible production gates. No checkout or
npm install is needed in your workflow: the composite action sets up Node 22,
caches npm downloads, and installs and runs from its own action directory.
Report artifacts are written into the caller's workspace, including on gate
failure. Linux runners are recommended.

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `endpoints` | required | Newline-delimited HTTP(S) remote MCP URLs. |
| `bearer-token` | empty | **Environment variable name**, never a literal token. |
| `api-key` | empty | **Environment variable name**, sent as `X-API-Key`. Mutually exclusive with bearer. |
| `fail-on` | `blocked` | Fail blocked, unknown or authorization-required runs. `review` also fails review decisions. |
| `clients` | empty | Comma or newline separated client ids to require in addition to the shared release decision. Incompatible blocks; unknown fails; caveats require review. |
| `baseline` | `none` | `none`, a previous JSON report path relative to the caller workspace, or `published`. |
| `session-resilience` | `false` | Opt in to bounded active session probes. |
| `comment` | `true` | Post/update one sticky bot comment on a PR using the caller's GitHub token. Permission denial or missing token skips gracefully. |
| `publish` | `false` | Publicly publish redacted JSON to mcptest.io and include its permalink. |

Client ids include `claude-ai`, `claude-desktop`, `claude-code`, `chatgpt`,
`codex-cli`, `cursor`, `vscode-copilot`, `windsurf`, and `gemini-cli`; the
supported ids and their sourced assumptions live in
[src/data/clientCompatibility.json](../src/data/clientCompatibility.json).
Verdicts come from the compatibility engine, not automated runs of those apps.
Headless Node access cannot establish browser CORS or complete interactive OAuth.
Unknown evidence stays unknown; it is never advertised as passing.

```yaml
- uses: integry/mcptest@v1
  env:
    REMOTE_MCP_TOKEN: ${{ secrets.REMOTE_MCP_TOKEN }}
  with:
    endpoints: |
      https://mcp.example.com/mcp
      https://mcp.example.com/secondary/mcp
    bearer-token: REMOTE_MCP_TOKEN
    clients: claude-ai,chatgpt,cursor,codex-cli
    baseline: published
    session-resilience: 'true'
    publish: 'true'
```

Credentials reuse the CLI's validation and redaction. Authenticated endpoints
must use HTTPS and share an origin. Userinfo, URL fragments and credential query parameters
are rejected. Credentials go only to the MCP target, never the publishing or
GitHub APIs. Fork PRs usually lack write permission and secrets; public endpoint
gates still work, while comments skip gracefully. Use `pull_request`, not
`pull_request_target` with an untrusted checkout, to test fork contributions.

## Baselines and release policy

`baseline: published` reads the endpoint's latest published report from
`https://mcptest.io/r` **before** publishing this run. Missing published history
fails the gate with an unknown decision; use `none` to bootstrap the first
release. Publishing is optional and makes the redacted endpoint and report
public. A published baseline is the latest published snapshot, so only publish
from trusted release jobs if you want it to represent the last release.

For a controlled last-release baseline, download the previous release's JSON
artifact into the caller workspace (checkout is needed only for files in your
own repository) and set `baseline: baselines/production.json`. A single local
report applies only to that endpoint; mismatched endpoint identities fail.
For multiple distinct endpoints use `published` or separate action invocations.

Removed tools, new required inputs and narrowed schemas block the gate.
Risky description or behavior changes require review; safe additions do not.
Changes are grouped by tool in the job summary and PR comment, with links to the
[breaking changes reference](https://mcptest.io/learn/which-mcp-tool-changes-break-clients).
Report snapshots currently omit output schemas and annotations, so the summary
explicitly lists those comparison limitations. Incomplete tool lists produce an
unknown result rather than an assertion that nothing broke.

The job summary and sticky PR comment include the release decision, a client
compatibility table, grouped tool changes, and top findings with reference
anchors. Comment failures never override the gate decision. Re-running updates
the existing `github-actions[bot]` comment. Multiple action invocations on one PR
share that comment; use a single invocation with newline endpoints for an
aggregate comment.

## Outputs

| Output | Meaning |
| --- | --- |
| `decision` | Worst `ready`, `review`, `blocked`, `unknown` or `authorization-required` decision. |
| `breaking-count` | Total breaking findings across endpoints. |
| `report-path` | Absolute directory for this invocation's JSON, Markdown and `summary.md`. |
| `report-url` | First public permalink when publishing; otherwise empty. All links appear in the summary. |

Each invocation uses a separate directory under `mcptest-reports/`. Outputs and
summaries are emitted before failing a completed gate. Configuration, baseline,
publishing or infrastructure errors fail closed. Keep artifact-upload steps on
`if: always()`.

## Run both release readiness and official conformance

The [official MCP conformance suite](https://github.com/modelcontextprotocol/conformance)
checks implementations against the specification. mcptest adds client-profile
readiness, OAuth evidence, browser-readiness limitations, last-release tool
comparison and optional session resilience. These answer different questions;
run both. mcptest is not a spec conformance certification or a load test.
See the official project's action inputs for its supported configuration.

## Existing CLI and reusable workflow

The existing `.github/workflows/mcptest-release-gate.yml` remains supported with
its original `credential_mode`, `fail_on_result`, `fail_on_severity`, and
`session_resilience` inputs. Cross-repository callers must pin `uses` to a full
commit SHA and pass that identical SHA as `mcptest_ref`. It retains its broader
CLI threshold controls; adopting the composite action is optional.

The CLI remains available with Node 22 and `npm ci`:

```bash
npm run mcptest -- https://mcp.example.com/mcp
npm run mcptest -- --bearer-token-env REMOTE_MCP_TOKEN https://mcp.example.com/mcp
npm run mcptest -- --session-resilience --client-compatibility https://mcp.example.com/mcp
npm run mcptest -- --help
```

CLI options include `--endpoints-env`, `--api-key-env`, `--output-dir`,
`--format json|markdown|both`, `--fail-on-result`, `--fail-on-severity`,
`--max-context-tokens <n>` and `--context-cost-top <n>` (see
[Context cost](#context-cost)).
The default CLI policy remains blocked/unknown results and high/critical
priorities. CLI exit codes remain 0 pass, 1 threshold failure, 2 browser
authorization required, 3 invalid configuration, 4 infrastructure/artifact failure.
The composite action exposes success/failure as exit 0/1 and the decision output.

Session probes never execute tools. They use isolated temporary sessions,
check unknown-id 404 and reinitialization, eight sequential and four parallel
pings, then DELETE invalidation. They send at most 22 requests with five-second
deadlines. Stateless servers are not applicable; a clean sample does not prove
restart durability. DELETE 405 is permitted. Credentials and session ids are
not retained.

## Maintainer publishing

Before publishing, run typecheck, unit tests, build and e2e (including the local
composite-action CI smoke job). Review `action.yml` branding, this documentation
and `/ci`. The maintainer can then create the release and the `v1` major tag and
choose Marketplace distribution in GitHub's release UI. This change creates no
tags or Marketplace listing.

## Context cost

Every report estimates how much context the tool definitions take up, in total,
per tool and, within a tool, per part: name and description, each top-level
input parameter, the rest of the input schema, the output schema and
annotations. The parts add up to the tool, and the tools add up to the total.
The CLI prints the total, the median per tool and the heaviest tools with their
share (`--context-cost-top <n>`, default 5); the JSON report stores the
breakdown under `toolSurfaceAnalysis.contextCost` (optional: reports made before
it have only `metrics.estimatedContextTokens`, computed as bytes / 4).

The numbers are estimates, not exact counts for any model. The method
(`lexical-json-v1`) counts word pieces, digit groups and punctuation in the
compact JSON of each definition, with weights calibrated against two public BPE
tokenizers on MCP tool schemas; on that corpus it is within about 5–10%. A
bundled tokenizer was rejected: it adds megabytes of vocabulary data and still
would not match every model.

Findings flag a total at or above 4,000 (low), 8,000 (medium) or 20,000 (high)
estimated tokens, a tool holding at least 25% of a total of 1,000 or more
(servers with three or more tools), a tool of 2,000 or more on its own, a
parameter of 300 or more that is half its tool or a tenth of the total, and
descriptions that repeat three or more of their enum values. Each comes with
advice: shorten descriptions, drop enum lists the prose repeats, split or defer
rarely used tools.

`--max-context-tokens <n>` (Action input `max-context-tokens`) fails the gate
with exit code 1 when the estimated total is above `n`. Report history, the
published-report diff, the breaking-change checker and the Action baseline
comparison show the before/after change overall and per changed tool.

## Tool list consistency check

Every evaluation lists tools two more times, each on a fresh connection to the
same route, transport and credentials, about 250 ms apart. Servers behind
blue/green deploys or stale replicas can return different `tools/list` results
from request to request; a single snapshot cannot see that, and drift checks
turn it into noise.

Each complete result (all pages, following `nextCursor`) gets a canonical hash
covering the full definition: name, title, description, `inputSchema`,
`outputSchema` and annotations, with sorted keys, so key or tool order never
changes the hash. When hashes differ the report has the finding
`tools.list-nondeterministic` ("Tool list is not deterministic (likely mixed
deploy or stale replica)", medium priority, review), listing which tools appear
in only some responses and which fields changed. Any `cf-ray`,
`fly-request-id`, `x-vercel-id`, `x-served-by`, `via` and `server` response
headers are recorded for each request. In the browser, CORS hides headers the
server does not list in `Access-Control-Expose-Headers`, and the report says so.
A matching result is shown as a passed check.

The check sends no extra requests when the first `tools/list` fails, stops at
the first failed repeat, and never calls tools. Disable it with
`--no-tool-list-consistency`, `tool-list-consistency: 'false'` in the Action, or
`tool_list_consistency: false` in the reusable workflow.

Reports record whether tools were listed authenticated or unauthenticated
(`capabilityInventory.authentication`, also in the consistency evidence). Report
history, the published-report diff, the breaking-change checker and the Action
baseline comparison do not count a tool missing after a change between
authenticated and unauthenticated runs as a breaking removal; they show it as
not comparable instead.
