/**
 * Mobile Lighthouse budgets (Lighthouse's default mobile form factor with
 * simulated slow 4G), on the same search entry pages as desktop. Run after
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
        // Ratchet based on the production-build route survey (issue #468).
        // Recheck the median of three before raising this; never lower it.
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
