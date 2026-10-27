#!/usr/bin/env node
/** Production-build route survey. Keep runs serial: competing Chromiums skew TBT.
 * npm run build && node scripts/bundle/measure-routes.mjs /tmp/performance-before
 * Repeat after changes, then use compare-routes.mjs for the PR table.
 */
import fs from 'node:fs';
import path from 'node:path';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import { launch } from 'chrome-launcher';
import { chromium } from '@playwright/test';
import { createStaticServer } from '../../tests/e2e/static-server.mjs';
import { createMockMcpServer } from '../../tests/e2e/mock-mcp-server.mjs';

const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/bundle/measure-routes.mjs <output-directory>');
fs.mkdirSync(output, { recursive: true });
const app = createStaticServer(process.env.PERF_DIST || 'dist');
const mock = createMockMcpServer().server;
await new Promise(resolve => app.listen(4175, '127.0.0.1', resolve));
await new Promise(resolve => mock.listen(4182, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:4175';
const routes = [
  '/', '/catalog', '/catalog/developer-tools', '/servers/context7/',
  '/learn/mcp-http-headers-reference', '/learn', '/clients', '/learn/mcp-clients-compared',
  '/tools/discovery', '/tools/breaking-changes', '/ci', '/submit',
  '/server/http:127.0.0.1:4182/2026/mcp',
];
const chromePath = process.env.CHROME_PATH || '/usr/bin/chromium';
let chrome;
process.once('SIGTERM', async () => {
  await chrome?.kill();
  app.close();
  mock.close();
  process.exit(143);
});
const results = [];
try {
  // A connected inspector is essential: measuring the landing page is insufficient.
  const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    for (const route of routes) {
      const response = await page.goto(origin + route);
      if (response.status() !== 200 && !(route === '/clients' && response.status() === 404)) {
        throw new Error(`Missing survey route: ${route}`);
      }
    }
    await page.getByRole('heading', { name: 'MCP connection ready' }).waitFor();
  } finally {
    await browser.close();
  }
  chrome = await launch({ chromePath, chromeFlags: ['--no-sandbox', '--headless=new'] });
  for (const preset of ['desktop', 'mobile']) {
    for (const route of routes) {
      for (let run = 1; run <= 3; run++) {
        const filename = `${preset}-${routes.indexOf(route)}-${run}.json`;
        const reportPath = path.join(output, filename);
        // Resume interrupted surveys without repeating completed measurements.
        let lhr;
        if (fs.existsSync(reportPath)) lhr = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        else {
          ({ lhr } = await lighthouse(origin + route, {
            port: chrome.port, ignoreStatusCode: route === '/clients',
            onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
          }, preset === 'desktop' ? desktopConfig : undefined));
          if (lhr.runtimeError) throw new Error(JSON.stringify(lhr.runtimeError));
          fs.writeFileSync(reportPath, JSON.stringify(lhr));
        }
        const resources = lhr.audits['resource-summary'].details.items;
        const requests = lhr.audits['network-requests'].details.items;
        const connectedMock = route.startsWith('/server/')
          ? requests.some(request => request.url === 'http://127.0.0.1:4182/2026/mcp' && request.statusCode === 200)
          : undefined;
        if (connectedMock === false) throw new Error('The playground did not connect to the mock MCP server.');
        const result = {
          preset, route, run, performance: lhr.categories.performance.score,
          accessibility: lhr.categories.accessibility.score,
          lcp: lhr.audits['largest-contentful-paint'].numericValue,
          tbt: lhr.audits['total-blocking-time'].numericValue,
          cls: lhr.audits['cumulative-layout-shift'].numericValue,
          transfer: resources.find(item => item.resourceType === 'total').transferSize,
          js: resources.find(item => item.resourceType === 'script')?.transferSize || 0,
          lighthouseVersion: lhr.lighthouseVersion,
          browser: lhr.environment.hostUserAgent,
          measuredAt: lhr.fetchTime,
          httpStatus: requests.find(request => request.resourceType === 'Document')?.statusCode,
          connectedMock,
        };
        results.push(result);
        console.log(JSON.stringify(result));
        fs.writeFileSync(path.join(output, 'measurements.json'), JSON.stringify(results, null, 2) + '\n');
      }
    }
  }
} finally {
  await chrome?.kill();
  app.close();
  mock.close();
}
