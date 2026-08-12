# Headless CLI and CI release gate

The headless command evaluates one or more remote MCP endpoints with the same
evaluator, compatibility profiles, release-decision logic, and versioned report
serializers used by the web app. It automatically negotiates stateless and
stateful Streamable HTTP, then tries legacy HTTP+SSE when needed.

Requirements: Node.js 22 or newer and dependencies installed with `npm ci`.

## Commands

Evaluate a public endpoint:

```bash
npm run mcptest -- https://mcp.example/mcp
```

Evaluate more than one endpoint. Reports are numbered so endpoints on the same
host cannot overwrite each other:

```bash
npm run mcptest -- https://one.example/mcp https://two.example/sse
```

Supply a bearer token or API key through an environment variable. The secret is
read only after argument parsing, removed from the CLI's environment, sent only
to the MCP target, and never included in progress, errors, or artifacts.

```bash
export MCPTEST_BEARER_TOKEN='replace-me'
npm run mcptest -- --bearer-token-env MCPTEST_BEARER_TOKEN https://protected.example/mcp

export MCPTEST_API_KEY='replace-me'
npm run mcptest -- --api-key-env MCPTEST_API_KEY https://keyed.example/mcp
```

API keys are sent as `X-API-Key`. Bearer and API-key options are mutually
exclusive. Literal credential arguments are deliberately unsupported because
command arguments can appear in process listings and CI diagnostics. Userinfo
and credential-like URL query parameters are rejected for the same reason.

For CI, endpoints can also be newline-delimited in an environment variable:

```bash
export MCPTEST_ENDPOINTS=$'https://one.example/mcp\nhttps://two.example/sse'
npm run mcptest -- --endpoints-env MCPTEST_ENDPOINTS
```

Run `npm run mcptest -- --help` for the complete option list.

## Artifacts and OAuth

The default output directory is `mcptest-reports`. Each completed endpoint
produces both JSON and Markdown; select one with `--format json` or
`--format markdown`. JSON conforms to the published
`https://mcptest.io/schemas/report/v2.schema.json` schema and both formats are
generated from the same in-memory report object. Browser-only CORS evidence is
explicitly left unknown in a headless run and is not added to the headless
score; the CLI never claims that a Node connection proves browser access.

Browser OAuth is intentionally non-interactive. If a target challenges for
authorization and no supplied bearer token or API key completes the request,
the command still writes an `authorization-required` report and exits 2. It
does not open a browser, print an authorization URL containing credentials, or
wait for user interaction.

## Gate policy and exit codes

Defaults are deterministic:

- Fail when the shared release decision is `blocked` or `unknown`.
- Fail on release priorities at `high` or `critical` severity.
- Permit `ready` and `review` when no high/critical priority exists. `review`
  often represents browser-CORS or host behavior that a headless process cannot
  establish.

Override the overall result set with `--fail-on-result`, and the inclusive
severity threshold with `--fail-on-severity`. `none` disables that dimension.
For example, this strict gate also fails review decisions and medium findings:

```bash
npm run mcptest -- \
  --fail-on-result blocked,unknown,review \
  --fail-on-severity medium \
  https://mcp.example/mcp
```

Exit codes are stable:

| Code | Meaning |
| ---: | --- |
| 0 | Every endpoint passed the configured thresholds. |
| 1 | At least one completed evaluation failed a configured threshold. |
| 2 | At least one endpoint requires interactive/browser authorization. |
| 3 | Arguments, endpoint URLs, environment references, or thresholds are invalid. |
| 4 | The evaluator threw unexpectedly or artifacts could not be written. |

For multiple endpoints, every target is attempted. Precedence is infrastructure
failure (4), authorization required (2), threshold failure (1), then pass (0).
Invalid configuration is rejected before evaluation with exit 3.

## Minimal GitHub Actions job

Pass inputs through environment variables so workflow data is not evaluated by
the shell. Upload artifacts with `if: always()` so failed gates remain
inspectable.

```yaml
jobs:
  mcp-release-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Evaluate remote MCP endpoints
        env:
          MCPTEST_ENDPOINTS: |
            https://one.example/mcp
            https://two.example/sse
        run: npm run mcptest -- --endpoints-env MCPTEST_ENDPOINTS
      - name: Upload mcptest reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: mcptest-reports
          path: mcptest-reports/
```

For a protected endpoint, map a repository or environment secret into the run
step and reference its name:

```yaml
env:
  MCPTEST_BEARER_TOKEN: ${{ secrets.MCPTEST_BEARER_TOKEN }}
run: npm run mcptest -- --bearer-token-env MCPTEST_BEARER_TOKEN https://protected.example/mcp
```

## Reusable workflow

This repository includes
`.github/workflows/mcptest-release-gate.yml`, callable with `workflow_call`.
Endpoints are newline-delimited and `credential_mode` is `public`, `bearer`, or
`api-key`.

```yaml
jobs:
  gate:
    uses: integry/mcptest/.github/workflows/mcptest-release-gate.yml@master
    with:
      endpoints: |
        https://protected.example/mcp
      credential_mode: bearer
      fail_on_result: blocked,unknown
      fail_on_severity: high
    secrets:
      MCPTEST_BEARER_TOKEN: ${{ secrets.REMOTE_MCP_TOKEN }}
```

Public callers omit `secrets`. API-key callers set `credential_mode: api-key`
and pass `MCPTEST_API_KEY`. The workflow checks out the exact mcptest commit
that contains the invoked reusable workflow, including for cross-repository
callers. Pin the `uses` value to a commit SHA when the calling repository
requires immutable third-party workflow dependencies.
