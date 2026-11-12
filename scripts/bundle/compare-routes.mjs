#!/usr/bin/env node
/** Print the PR's before/after table from two measure-routes.mjs surveys.
 * node scripts/bundle/compare-routes.mjs /tmp/before/measurements.json /tmp/after/measurements.json
 */
import fs from 'node:fs';

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) throw new Error('Pass the before and after measurements.json paths.');
const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));
const median = values => [...values].sort((a, b) => a - b)[1];
const keys = ['performance', 'lcp', 'tbt', 'cls', 'transfer', 'js'];
const groups = measurements => {
  const grouped = new Map();
  for (const run of measurements) {
    const key = `${run.preset} ${run.route}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(run);
  }
  for (const [key, runs] of grouped) {
    if (runs.length !== 3 || new Set(runs.map(run => run.run)).size !== 3) {
      throw new Error(`${key} needs three distinct runs.`);
    }
    grouped.set(key, Object.fromEntries(keys.map(metric => [metric, median(runs.map(run => run[metric]))])));
  }
  return grouped;
};
const old = groups(before);
const current = groups(after);
if (old.size !== current.size) throw new Error('The route sets differ.');
const format = {
  performance: value => value.toFixed(2), lcp: value => `${(value / 1000).toFixed(2)} s`,
  tbt: value => `${Math.round(value)} ms`, cls: value => value.toFixed(3),
  transfer: value => `${Math.round(value / 1024)} KiB`, js: value => `${Math.round(value / 1024)} KiB`,
};
console.log('Median of three cold navigations per device and route; before → after. JS and total transfer are compressed wire bytes.');
console.log('\n| Device / route | Perf | LCP | TBT | CLS | Transfer | JS |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const [key, result] of current) {
  const previous = old.get(key);
  if (!previous) throw new Error(`Missing baseline for ${key}`);
  console.log(`| ${key} | ${keys.map(metric => `${format[metric](previous[metric])} → ${format[metric](result[metric])}`).join(' | ')} |`);
}
