import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CatalogValidationResult } from '../src/types/catalog';
import {
  diffCatalogEvidence,
  main,
  summarizeCatalogDiff,
  USAGE,
  type CapabilitySnapshots,
} from './summarize-catalog-diff';

const fixtureDirectory = path.join(__dirname, 'fixtures', 'catalog-diff');
const fixturePath = (name: string): string => path.join(fixtureDirectory, name);
const fixture = <T>(name: string): T => JSON.parse(fs.readFileSync(fixturePath(name), 'utf8')) as T;

const input = () => ({
  beforeValidation: fixture<CatalogValidationResult[]>('before-validation.json'),
  afterValidation: fixture<CatalogValidationResult[]>('after-validation.json'),
  beforeCapabilities: fixture<CapabilitySnapshots>('before-capabilities.json'),
  afterCapabilities: fixture<CapabilitySnapshots>('after-capabilities.json'),
});

describe('catalog revalidation diff summary', () => {
  it('classifies status, protocol, transport, auth and tool changes per server', () => {
    const diff = diffCatalogEvidence(input());

    expect(diff.wentOnline.map(({ serverId }) => serverId)).toEqual(['bravo']);
    expect(diff.wentOffline).toEqual([
      { serverId: 'charlie', from: 'online', to: 'offline', detail: 'timeout' },
    ]);
    expect(diff.protocol).toEqual([
      { serverId: 'alpha', from: '2025-11-25 (stateful)', to: '2026-07-28 (stateless)' },
    ]);
    expect(diff.transport).toEqual([{ serverId: 'echo', from: 'streamable-http', to: 'both' }]);
    expect(diff.auth).toEqual([
      { serverId: 'delta', from: 'none', to: 'oauth via https://auth.delta.example' },
    ]);
    expect(diff.tools).toEqual([
      { serverId: 'alpha', from: 2, to: 3, added: ['summarize'], removed: [] },
      { serverId: 'bravo', from: undefined, to: 1, added: ['lookup'], removed: [] },
    ]);
    expect(diff.added).toEqual(['golf']);
    expect(diff.removed).toEqual(['retired']);
    expect(diff.unchanged).toBe(1);
  });

  it('renders the synthetic fixture into the checked-in pull request body', () => {
    expect(summarizeCatalogDiff(input())).toBe(
      fs.readFileSync(fixturePath('expected-summary.md'), 'utf8')
    );
  });

  it('ignores checkedAt and observedAt churn when nothing observable changed', () => {
    const { beforeValidation, beforeCapabilities } = input();
    const afterValidation = beforeValidation.map((result) => ({
      ...result,
      checkedAt: '2027-01-01T00:00:00.000Z',
    }));
    const afterCapabilities = Object.fromEntries(Object.entries(beforeCapabilities).map(
      ([serverId, inventory]) => [serverId, { ...inventory, observedAt: '2027-01-01T00:00:00.000Z' }]
    ));
    const body = summarizeCatalogDiff({
      beforeValidation, afterValidation, beforeCapabilities, afterCapabilities,
    });

    expect(body).toContain(`| No observable change | ${beforeValidation.length} |`);
    expect(body).toContain('No observable change since the last snapshot.');
  });

  it('reports message-only changes and removed tools, and uses catalog names', () => {
    const { beforeValidation, beforeCapabilities } = input();
    const afterValidation = beforeValidation.map((result) => (
      result.serverId === 'foxtrot' ? { ...result, message: 'different wording' } : result
    ));
    const afterCapabilities = {
      ...beforeCapabilities,
      foxtrot: {
        ...beforeCapabilities.foxtrot,
        tools: { ...beforeCapabilities.foxtrot.tools, observedCount: 0, retainedCount: 0, items: [] },
      },
    };
    const body = summarizeCatalogDiff({
      beforeValidation, afterValidation, beforeCapabilities, afterCapabilities,
      names: { foxtrot: 'Foxtrot | Docs' },
    });

    expect(body).toContain('| Foxtrot \\| Docs (`foxtrot`) | 1 | 0 | — | `ping` |');
    expect(body).toContain('**Other evidence changed** (message, validated URL or error code): Foxtrot \\| Docs (`foxtrot`)');
  });

  it('reads files from the command line and treats a missing before file as empty', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcptest-catalog-diff-'));
    const output = path.join(directory, 'body.md');
    try {
      const body = main([
        '--before-validation', path.join(directory, 'missing.json'),
        '--after-validation', fixturePath('after-validation.json'),
        '--before-capabilities', fixturePath('before-capabilities.json'),
        '--after-capabilities', fixturePath('after-capabilities.json'),
        '--output', output,
      ]);
      expect(fs.readFileSync(output, 'utf8')).toBe(body);
      expect(body).toContain('**New in the validation file:** `alpha`, `bravo`');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    expect(() => main(['--after-validation', 'x.json'])).toThrow(USAGE);
  });
});
