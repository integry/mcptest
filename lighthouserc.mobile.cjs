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
        // Ratchet: mobile measured 0.57-0.66 on 2026-10-20 after code splitting (was 0.33-0.37). Raise as further work lands; never lower.
        // Mobile measured 0.46-0.66 across runs of identical code on 2026-10-20; 0.4 keeps headroom for
        // runner variance while still failing the pre-code-splitting 0.33-0.37 class.
        'categories:performance': ['error', { minScore: 0.4, aggregationMethod: 'median-run' }],
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
