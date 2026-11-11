/** Shared static CI landing-page copy. It adds no dependency to the app entry. */
export const CI_PATH = '/ci';
export const CI_TITLE = 'Gate your MCP deploy in GitHub Actions';
export const CI_DESCRIPTION = 'Check client compatibility and breaking tool changes before you release a remote MCP server. Copy the workflow and read the result in a PR comment.';
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
/** The action's comment for this example (renderActionSummary in src/cli/githubAction.ts), without its hidden marker. */
export const CI_EXAMPLE_COMMENT = `## mcptest: blocked — gate failed

[Remote MCP release gate](https://mcptest.io/ci)

### https://mcp.example.com/mcp

Decision: **blocked**

| Client | Compatibility |
| --- | --- |
| claude-ai | compatible-with-caveats |
| chatgpt | compatible |
| cursor | compatible |
| codex-cli | compatible |

Browser CORS and interactive OAuth remain unverified in headless CI; these are evidence-based verdicts, not client application launches.

Changes: 1 breaking, 1 safe

- **search** (breaking)
  - [Input "filter" is now required](https://mcptest.io/learn/which-mcp-tool-changes-break-clients#adding-a-required-input) — breaking
- **lookup** (safe)
  - [Tool added](https://mcptest.io/learn/which-mcp-tool-changes-break-clients#changes-that-are-safe) — safe

- Output schemas were not recorded in both snapshots, so output contracts were not compared.
- Tool annotations were not recorded in both snapshots, so behavior hints were not compared.
`;
