/**
 * Lighthouse CI budgets for the built site (issue #390), desktop preset. Runs
 * against dist/ served by tests/e2e/static-server.mjs; `npm run test:lighthouse`
 * after `npm run build`. Any budget below fails the run. lighthouserc.mobile.cjs
 * holds the mobile budgets.
 */

const PORT = Number(process.env.LHCI_PORT) || 4174;
const origin = `http://127.0.0.1:${PORT}`;

module.exports = {
  ci: {
    collect: {
      startServerCommand: `node tests/e2e/static-server.mjs --dist dist --port ${PORT}`,
      startServerReadyPattern: 'Serving dist',
      url: [
        `${origin}/`,
        `${origin}/catalog`,
        `${origin}/servers/context7/`,
        `${origin}/learn/mcp-http-headers-reference`,
      ],
      // The median of three runs per URL is what the assertions see.
      numberOfRuns: 3,
      settings: {
        preset: 'desktop',
        chromeFlags: '--no-sandbox --headless=new',
      },
    },
    assert: {
      assertions: {
        // Ratchet: 0.65-0.77 before route-level code splitting (issue #401, 2026-10-20),
        // 0.9+ after. Raise this as further performance work lands; never lower it.
        'categories:performance': ['error', { minScore: 0.9, aggregationMethod: 'median-run' }],
        // Ratchet: 0.92 before the tab-strip, brand-link and footer-contrast fixes (issue #401).
        'categories:accessibility': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
        'categories:best-practices': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
        'categories:seo': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.05, aggregationMethod: 'median-run' }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci/desktop',
    },
  },
};
