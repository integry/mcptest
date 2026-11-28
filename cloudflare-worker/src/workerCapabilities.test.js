// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  capabilitiesPath,
  workerCapabilitiesPath,
  projectWorkerCapabilities,
  serializeWorkerCapabilities,
} = require('../../scripts/worker-capabilities.cjs');

describe('worker capability projection', () => {
  it('matches catalogCapabilities.json (run `npm run generate-worker-capabilities` after editing it)', () => {
    const full = JSON.parse(readFileSync(capabilitiesPath, 'utf8'));
    expect(readFileSync(workerCapabilitiesPath, 'utf8')).toBe(serializeWorkerCapabilities(full));
  });

  it('keeps only the fields the catalog index reads', () => {
    const projected = projectWorkerCapabilities({
      example: {
        version: 1,
        observedAt: '2026-11-28T00:00:00.000Z',
        provenance: { source: 'anonymous' },
        authentication: 'unauthenticated',
        tools: {
          status: 'complete', observedCount: 3, retainedCount: 2, omittedCount: 1,
          items: [{ name: 'search', description: 'Search', inputSchema: { type: 'object' } }, { title: 'unnamed' }],
        },
        resources: { status: 'complete', items: [{ uri: 'file:///a', name: 'a' }] },
        resourceTemplates: { status: 'complete', items: [] },
      },
    });
    expect(projected).toEqual({
      example: {
        observedAt: '2026-11-28T00:00:00.000Z',
        authentication: 'unauthenticated',
        tools: { observedCount: 3, retainedCount: 2, items: [{ name: 'search' }, {}] },
        resources: { items: [{ name: 'a' }] },
      },
    });
  });

  it('is the only capability inventory the worker bundles', () => {
    const directory = new URL('.', import.meta.url);
    const sources = readdirSync(directory).filter((file) => file.endsWith('.js') && !file.endsWith('.test.js'));
    for (const file of sources) {
      expect(readFileSync(new URL(file, directory), 'utf8'), file).not.toMatch(/data\/catalogCapabilities\.json/);
    }
  });
});
