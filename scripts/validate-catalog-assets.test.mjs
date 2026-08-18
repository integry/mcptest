import fs from 'fs';
import os from 'os';
import path from 'path';
import { deflateSync } from 'zlib';
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

const crc32 = buffer => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data = Buffer.alloc(0)) => {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
};

const pngDataUri = ({ width, height, colorType }) => {
  const channels = colorType === 6 ? 4 : 3;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const scanlines = Buffer.alloc(height * (1 + width * channels));
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND'),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
};

const embeddedImageSvg = dataUri => (
  `<svg viewBox="0 0 128 128"><image href="${dataUri}" /></svg>`
);

describe('catalog logo asset validation', () => {
  it('accepts all production assets and provenance records', () => {
    expect(validateCatalogAssets(catalog)).toEqual([]);
  });

  it('rejects dead Simple Icons provenance URLs with v-prefixed version tags', () => {
    const canva = catalog.find(seed => seed.id === 'canva');
    const errors = validateCatalogAssets(catalog.map(seed => (
      seed.id === 'canva'
        ? {
            ...seed,
            logoSourceUrl: 'https://github.com/simple-icons/simple-icons/blob/v15.16.0/icons/canva.svg',
          }
        : seed
    )));

    expect(canva).toBeDefined();
    expect(errors).toContain('canva: Simple Icons version tags must not have a leading v');
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

  it('rejects character-reference-encoded external SVG URLs', () => {
    expect(validateSvg(
      '<svg viewBox="0 0 1 1"><image href="https&#58;//remote.example/a.png" /></svg>'
    )).toContain('references an external or executable resource');
  });

  it.each([
    ['undersized PNG', pngDataUri({ width: 64, height: 64, colorType: 6 })],
    ['non-square PNG', pngDataUri({ width: 128, height: 129, colorType: 6 })],
    ['opaque PNG', pngDataUri({ width: 128, height: 128, colorType: 2 })],
    ['malformed PNG', 'data:image/png;base64,not-valid-base64!'],
    ['WebP', 'data:image/webp;base64,UklGRgAAAABXRUJQ'],
    ['character-reference-encoded data URI', 'd&#97;ta:image/png;base64,not-valid-base64!'],
  ])('rejects embedded %s payloads', (_label, dataUri) => {
    expect(validateSvg(embeddedImageSvg(dataUri))).toContain(
      'contains an embedded data resource'
    );
  });

  it('rejects embedded data URIs from SVG CSS', () => {
    const dataUri = pngDataUri({ width: 128, height: 128, colorType: 6 });
    const svg = `<svg viewBox="0 0 128 128"><style>.logo { fill: url('${dataUri}') }</style></svg>`;

    expect(validateSvg(svg)).toContain('contains an embedded data resource');
  });

  it.each([
    [
      'an indirect href assignment',
      '<set attributeName="href" to="data:image/png;base64,AAAA" />',
    ],
    [
      'a data URI among srcset candidates',
      '<image srcset="#local 1x, data:image/png;base64,AAAA 2x" />',
    ],
    ['a data attribute', '<image data="data:image/png;base64,AAAA" />'],
    ['a poster attribute', '<image poster="DATA:image/png;base64,AAAA" />'],
    [
      'an XML-character-reference-encoded assignment',
      '<set attributeName="href" to="d&#97;ta&#58;image/png;base64,AAAA" />',
    ],
  ])('rejects data URLs from %s', (_label, element) => {
    expect(validateSvg(`<svg viewBox="0 0 1 1">${element}</svg>`)).toContain(
      'contains an embedded data resource'
    );
  });

  it('accepts self-contained vectors and fragment-only references', () => {
    const svg = '<svg viewBox="0 0 1 1"><defs><path id="mark" d="M0 0h1v1z" /></defs>'
      + '<use href="#mark" fill="url(#gradient)" /></svg>';

    expect(validateSvg(svg)).toEqual([]);
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

  it('rejects WebP logo files', () => {
    const directory = temporaryDirectory();
    const webpPath = path.join(directory, 'logo.webp');
    fs.writeFileSync(webpPath, Buffer.from('RIFF0000WEBP', 'ascii'));

    expect(validateLogoFile(webpPath, '/server-logos/logo.webp')).toContain(
      'must use SVG or PNG'
    );
  });
});
