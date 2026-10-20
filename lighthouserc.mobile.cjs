/**
 * Mobile Lighthouse budgets (Lighthouse's default mobile form factor with
 * simulated slow 4G), on the same four pages as the desktop run. Run after
 * `npm run test:lighthouse`, which owns the desktop budgets.
 */

const desktop = require('./lighthouserc.cjs');

module.exports = {
  ci: {
    collect: {
      ...desktop.ci.collect,
      settings: {
        chromeFlags: desktop.ci.collect.settings.chromeFlags,
      },
    },
    assert: {
      assertions: {
        // Ratchet: 0.33-0.42 before route-level code splitting (issue #401, 2026-10-20).
        // Raise this as further performance work lands; never lower it.
        'categories:performance': ['error', { minScore: 0.7, aggregationMethod: 'median-run' }],
        'categories:accessibility': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.05, aggregationMethod: 'median-run' }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci/mobile',
    },
  },
};
