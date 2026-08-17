import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import catalog from '../src/data/serverCatalog.json';
import validator from './validate-catalog-assets.js';

const { MAX_LOGO_BYTES, validateCatalogAssets, validateLogoFile, validateSvg } = validator;
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const temporaryDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcptest-logo-validation-'));
  temporaryDirectories.push(directory);
  return directory;
};

describe('catalog logo asset validation', () => {
  it('accepts all production assets and provenance records', () => {
    expect(validateCatalogAssets(catalog)).toEqual([]);
  });

  it('rejects unsafe SVG behaviors and external resources', () => {
    expect(validateSvg('<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>')).toContain(
      'contains unsafe <script element'
    );
    expect(validateSvg('<svg viewBox="0 0 1 1"><path onclick="go()" /></svg>')).toContain(
      'contains an event-handler attribute'
    );
    expect(validateSvg('<svg viewBox="0 0 1 1"><foreignObject /></svg>')).toContain(
      'contains unsafe <foreignObject element'
    );
    expect(validateSvg('<svg viewBox="0 0 1 1"><image href="https://remote.example/a.png" /></svg>')).toContain(
      'references an external or executable resource'
    );
  });

  it('rejects duplicate ids, non-local paths, and invalid provenance', () => {
    const first = catalog[0];
    const errors = validateCatalogAssets([
      first,
      {
        ...first,
        logoUrl: 'https://remote.example/logo.svg',
        logoSourceKind: 'unknown-kind',
        logoRetrievedAt: '2026-02-31',
        logoSourceUrl: 'http://insecure.example/logo.svg',
      },
    ]);

    expect(errors).toContain(`Duplicate catalog server id: ${first.id}`);
    expect(errors).toContain(`${first.id}: logoUrl must be a local path inside /server-logos/`);
    expect(errors).toContain(`${first.id}: logoSourceKind is invalid`);
    expect(errors).toContain(`${first.id}: logoRetrievedAt must be a valid ISO date (YYYY-MM-DD)`);
    expect(errors).toContain(`${first.id}: sourced logo requires an HTTPS logoSourceUrl`);
  });

  it('rejects missing files, generated fallbacks with fake sources, and oversized assets', () => {
    const publicRoot = temporaryDirectory();
    const logoDirectory = path.join(publicRoot, 'server-logos');
    fs.mkdirSync(logoDirectory);
    const oversizedPath = path.join(logoDirectory, 'oversized.svg');
    fs.writeFileSync(
      oversizedPath,
      `<svg viewBox="0 0 1 1">${' '.repeat(MAX_LOGO_BYTES)}</svg>`
    );

    expect(validateLogoFile(oversizedPath, '/server-logos/oversized.svg').some(
      error => error.includes('maximum')
    )).toBe(true);

    const errors = validateCatalogAssets([{
      id: 'missing',
      logoUrl: '/server-logos/missing.svg',
      logoSourceKind: 'generated-fallback',
      logoRetrievedAt: '2026-08-17',
      logoSourceUrl: 'https://fake.example/logo.svg',
      logoLicenseNote: 'Generated fallback, not an official mark.',
    }], { publicRoot, logoDirectory });

    expect(errors).toContain('missing: logo file is missing: /server-logos/missing.svg');
    expect(errors).toContain('missing: generated fallback must not declare a logoSourceUrl');
  });
});
