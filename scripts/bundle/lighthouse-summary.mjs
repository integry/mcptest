#!/usr/bin/env node
/**
 * Summarizes Lighthouse CI reports (.lighthouseci/<preset>/*.json) as one
 * Markdown table per preset: median performance and accessibility per URL,
 * with the metrics behind the score. For PR descriptions.
 *
 *   node scripts/bundle/lighthouse-summary.mjs [.lighthouseci]
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || '.lighthouseci';
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const ms = value => `${(value / 1000).toFixed(1)} s`;
const kb = value => `${Math.round(value / 1024)} KB`;

for (const preset of fs.readdirSync(root).filter(name => fs.statSync(path.join(root, name)).isDirectory())) {
  const reports = fs.readdirSync(path.join(root, preset))
    .filter(name => name.endsWith('.report.json'))
    .map(name => JSON.parse(fs.readFileSync(path.join(root, preset, name), 'utf8')));
  const byUrl = new Map();
  for (const report of reports) {
    const url = new URL(report.finalDisplayedUrl || report.requestedUrl).pathname;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(report);
  }
  console.log(`\n### ${preset}\n`);
  console.log('| Page | Perf | A11y | FCP | LCP | TBT | CLS | Total transfer | Script bytes | Unused JS |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [url, runs] of byUrl) {
    const pick = (fn) => median(runs.map(fn));
    const perf = pick(r => r.categories.performance.score);
    const a11y = pick(r => r.categories.accessibility.score);
    const fcp = pick(r => r.audits['first-contentful-paint'].numericValue);
    const lcp = pick(r => r.audits['largest-contentful-paint'].numericValue);
    const tbt = pick(r => r.audits['total-blocking-time'].numericValue);
    const cls = pick(r => r.audits['cumulative-layout-shift'].numericValue);
    const transfer = pick(r => (r.audits['resource-summary']?.details?.items || []).find(i => i.resourceType === 'total')?.transferSize || 0);
    const script = pick(r => (r.audits['resource-summary']?.details?.items || []).find(i => i.resourceType === 'script')?.transferSize || 0);
    const unused = pick(r => r.audits['unused-javascript']?.details?.overallSavingsBytes || 0);
    console.log(`| ${url} | ${perf.toFixed(2)} | ${a11y.toFixed(2)} | ${ms(fcp)} | ${ms(lcp)} | ${Math.round(tbt)} ms | ${cls.toFixed(3)} | ${kb(transfer)} | ${kb(script)} | ${kb(unused)} |`);
  }
}
