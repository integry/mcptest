/** Shared static CI landing-page copy. It adds no dependency to the app entry. */
export const CI_PATH = '/ci';
export const CI_TITLE = 'Gate your MCP deploy in GitHub Actions';
export const CI_DESCRIPTION = 'Check client compatibility and breaking tool changes before releasing a remote MCP server. Copy a workflow and review the PR summary.';
export const CI_WORKFLOW = `name: MCP release gate
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
          comment: 'true'
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: mcptest-reports
          path: mcptest-reports/
`;
export const CI_EXAMPLE_COMMENT = `## mcptest: blocked — gate failed

| Client | Compatibility |
| --- | --- |
| claude-ai | compatible-with-caveats |
| chatgpt | compatible |
| cursor | compatible |
| codex-cli | compatible |

Changes: 1 breaking, 1 safe

- **search** (breaking): Required input "filter" added.
- **lookup** (safe): Tool added.

Browser CORS and interactive OAuth remain unverified in headless CI.
Output schemas and annotations were not recorded in both snapshots.

Full report: a public mcptest.io/r permalink appears when publishing is enabled.
`;
