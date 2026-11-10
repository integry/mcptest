// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const configPath = path.join(import.meta.dirname, '..', '.github', 'dependabot.yml');
const config = (yaml.safeLoad || yaml.load)(fs.readFileSync(configPath, 'utf8'));
const npmUpdates = config.updates.filter(update => update['package-ecosystem'] === 'npm');

describe('.github/dependabot.yml', () => {
  it('covers npm in the root and both workers, plus GitHub Actions', () => {
    expect(config.version).toBe(2);
    expect(npmUpdates.map(update => update.directory).sort()).toEqual(['/', '/cloudflare-worker', '/cors-proxy-worker']);
    expect(config.updates.some(update => update['package-ecosystem'] === 'github-actions' && update.directory === '/')).toBe(true);
    for (const update of npmUpdates) {
      const packageJson = path.join(import.meta.dirname, '..', update.directory, 'package.json');
      expect(fs.existsSync(packageJson), packageJson).toBe(true);
    }
  });

  it('runs weekly on Monday with an open-PR limit', () => {
    for (const update of config.updates) {
      expect(update.schedule).toEqual({ interval: 'weekly', day: 'monday' });
      expect(update['open-pull-requests-limit']).toBeGreaterThan(0);
    }
  });

  it('keeps TypeScript compiler updates eligible in the root and workers', () => {
    for (const update of npmUpdates) {
      const compilerIgnores = (update.ignore || []).filter(rule => (
        rule['dependency-name'] === 'typescript' || rule['dependency-name'] === '*'
      ));
      expect(compilerIgnores, update.directory).toEqual([]);
    }
  });

  it('groups minor and patch updates, with vitest, wrangler and MCP packages on their own', () => {
    for (const update of config.updates) {
      expect(Object.values(update.groups).some(group => (
        [...(group['update-types'] || [])].sort().join() === 'minor,patch' && !group.patterns
      ))).toBe(true);
    }
    for (const update of npmUpdates) {
      expect(update.groups.vitest.patterns).toContain('vitest');
      expect(update.groups.wrangler.patterns).toContain('wrangler');
      expect(update.groups.modelcontextprotocol.patterns).toContain('@modelcontextprotocol/*');
    }
  });
});
