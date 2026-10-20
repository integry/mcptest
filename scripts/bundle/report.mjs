#!/usr/bin/env node
/**
 * Prints the chunk graph of the last build: which chunks every page loads
 * before any dynamic import (the initial graph), what is in them, and which
 * chunks only load on demand. `npm run analyze` builds first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { initialGraphSummary, lazyChunks, staticClosure } from './route-graph.mjs';

const dist = process.argv[2] || 'dist';
const manifest = JSON.parse(fs.readFileSync(path.join(dist, '.vite/manifest.json'), 'utf8'));
const stats = JSON.parse(fs.readFileSync(path.join(dist, '.vite/bundle-stats.json'), 'utf8'));
const size = file => fs.statSync(path.join(dist, file)).size;
const kb = bytes => `${(bytes / 1024).toFixed(1)} KB`;

console.log('Initial graph (every page, before any dynamic import):');
let total = 0;
for (const file of staticClosure(manifest)) {
  total += size(file);
  console.log(`  ${file}  ${kb(size(file))}`);
}
console.log(`  total ${kb(total)} minified\n`);

const summary = initialGraphSummary(manifest, stats);
console.log('Initial graph by module group (source bytes before minification):');
for (const [group, bytes] of summary.groups.slice(0, 20)) console.log(`  ${kb(bytes).padStart(10)}  ${group}`);

console.log('\nLoaded on demand:');
for (const file of lazyChunks(manifest).sort((a, b) => size(b) - size(a))) console.log(`  ${file}  ${kb(size(file))}`);
