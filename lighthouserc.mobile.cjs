/**
 * Informational mobile Lighthouse run (Lighthouse's default mobile form factor
 * with simulated slow 4G). One run per URL, no assertions: it records the
 * mobile numbers for follow-up performance work without gating CI. Run after
 * `npm run test:lighthouse`, which owns the desktop budgets.
 */

const desktop = require('./lighthouserc.cjs');

module.exports = {
  ci: {
    collect: {
      ...desktop.ci.collect,
      numberOfRuns: 1,
      settings: {
        chromeFlags: desktop.ci.collect.settings.chromeFlags,
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci/mobile',
    },
  },
};
