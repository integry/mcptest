import { readFileSync, appendFileSync } from 'node:fs';

// Playwright's JSON reporter includes annotations from every worker, including
// failed tests. CI runs this with always() so moderate findings remain visible.
const report = JSON.parse(readFileSync('test-results/accessibility.json', 'utf8'));
const rows = [];
function visit(suite, parents = []) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      for (const annotation of test.annotations ?? []) {
        if (annotation.type === 'a11y-moderate') {
          rows.push(`- ${[...parents, spec.title].join(' / ')}: ${annotation.description}`);
        }
      }
    }
  }
  for (const child of suite.suites ?? []) visit(child, [...parents, child.title]);
}
for (const suite of report.suites) visit(suite);
appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  `## Accessibility: moderate findings\n\n${rows.length ? [...new Set(rows)].join('\n') : 'No moderate violations found.'}\n`);
