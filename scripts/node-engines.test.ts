import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const semver = require('semver') as {
  satisfies: (version: string, range: string) => boolean;
  subset: (sub: string, dom: string) => boolean;
  validRange: (range: string) => string | null;
};

const repoRoot = path.resolve(__dirname, '..');
const readJson = (name: string) => JSON.parse(fs.readFileSync(path.join(repoRoot, name), 'utf8'));

interface LockedPackage {
  engines?: { node?: string };
  optional?: boolean;
}

const manifest = readJson('package.json') as { engines: { node: string } };
const lock = readJson('package-lock.json') as { packages: Record<string, LockedPackage> };
const declaredRange = manifest.engines.node;

describe('declared Node.js support', () => {
  it('keeps the lockfile root engines in sync with package.json', () => {
    expect(lock.packages[''].engines?.node).toBe(declaredRange);
  });

  it('only advertises Node versions that every required locked package accepts', () => {
    // Optional packages are skipped by npm when their engines do not match, so
    // only required packages can block installation on a declared runtime.
    const incompatible = Object.entries(lock.packages)
      .filter(([location, entry]) => location !== '' && !entry.optional && entry.engines?.node)
      .filter(([, entry]) => {
        const range = entry.engines!.node!;
        return semver.validRange(range) !== null && !semver.subset(declaredRange, range);
      })
      .map(([location, entry]) => `${location} (${entry.engines!.node})`);

    expect(incompatible).toEqual([]);
  });

  it('rejects Node 22 releases older than jsdom requires', () => {
    expect(semver.satisfies('22.22.1', declaredRange)).toBe(false);
    expect(semver.satisfies('22.22.2', declaredRange)).toBe(true);
    expect(semver.satisfies('24.15.0', declaredRange)).toBe(true);
    expect(semver.satisfies('24.14.9', declaredRange)).toBe(false);
  });
});
