// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import seoGenerator from '../generate-seo-pages.js';
import ogImages from './ogImages.js';
import catalogSeeds from '../../src/data/serverCatalog.json';
import catalogValidation from '../../src/data/catalogValidation.json';
import pageMetadata from '../../src/data/pageMetadata.json';

const { buildOgCards, loadArticles, mergeCatalogServers } = seoGenerator;
const { getOgCardHash, ogImageOutputPath, writeOgImages } = ogImages;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SIZE_BUDGET_BYTES = 200 * 1024;

const temporaryDirectories = [];
function temporaryDirectory(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterAll(() => {
  for (const directory of temporaryDirectories) fs.rmSync(directory, { recursive: true, force: true });
});

function pngDimensions(png) {
  expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

const articles = loadArticles({ reservedPaths: Object.keys(pageMetadata.docs).map(slug => `/docs/${slug}`) });
const servers = mergeCatalogServers(catalogSeeds, catalogValidation);
const cards = buildOgCards({ servers, articles, pageMetadata });

describe('Open Graph cards', () => {
  it('cover the home, catalog and learn index plus every content and server page, once each', () => {
    const paths = cards.map(card => card.pagePath);
    expect(paths).toEqual(expect.arrayContaining(['/', '/catalog', '/learn']));
    for (const article of articles) expect(paths).toContain(article.path);
    for (const server of servers) expect(paths).toContain(`/servers/${server.id}/`);
    expect(new Set(cards.map(ogImageOutputPath)).size).toBe(cards.length);
  });

  it('use the local server logo file for server pages', () => {
    for (const card of cards.filter(item => item.pagePath.startsWith('/servers/'))) {
      expect(card.logoFile || card.initials).toBeTruthy();
      if (card.logoFile) expect(fs.existsSync(card.logoFile)).toBe(true);
    }
  });

  it('change their cache key when the text or the logo changes', () => {
    const card = { pagePath: '/learn/sample', title: 'Sample', summary: 'One line.' };
    const hash = getOgCardHash(card);
    expect(getOgCardHash({ ...card })).toBe(hash);
    expect(getOgCardHash({ ...card, title: 'Sample 2' })).not.toBe(hash);
    expect(getOgCardHash({ ...card, logoFile: cards.find(item => item.logoFile).logoFile })).not.toBe(hash);
  });
});

describe('Open Graph image rendering', () => {
  it('renders every page as a 1200x630 PNG under the 200 KB budget', async () => {
    const distRoot = temporaryDirectory('og-dist-');
    // The shared build cache keeps this fast after the first run and warms it for `npm run build`.
    await writeOgImages(cards, { distRoot });

    for (const card of cards) {
      const png = fs.readFileSync(path.join(distRoot, ogImageOutputPath(card)));
      expect(pngDimensions(png), card.pagePath).toEqual({ width: 1200, height: 630 });
      expect(png.length, `${card.pagePath} is ${png.length} bytes`).toBeLessThan(SIZE_BUDGET_BYTES);
    }
  }, 180_000);

  it('skips rendering when the input hash is unchanged', async () => {
    const cacheDir = temporaryDirectory('og-cache-');
    const distRoot = temporaryDirectory('og-dist-');
    const sample = [cards.find(card => card.pagePath === '/'), cards.find(card => card.logoFile)];

    expect(await writeOgImages(sample, { distRoot, cacheDir })).toEqual({ rendered: 2, cached: 0 });
    expect(await writeOgImages(sample, { distRoot, cacheDir })).toEqual({ rendered: 0, cached: 2 });
    const changed = [{ ...sample[0], summary: `${sample[0].summary} Changed.` }, sample[1]];
    expect(await writeOgImages(changed, { distRoot, cacheDir })).toEqual({ rendered: 1, cached: 1 });
    expect(fs.existsSync(path.join(distRoot, 'og', 'home.png'))).toBe(true);
  }, 60_000);

  it('refuses two cards that would write the same file', async () => {
    const card = { pagePath: '/learn', title: 'Learn', summary: 'Guides.' };
    await expect(writeOgImages([card, { ...card, pagePath: '/learn/' }], {
      distRoot: temporaryDirectory('og-dist-'),
      cacheDir: temporaryDirectory('og-cache-'),
    })).rejects.toThrow('Duplicate Open Graph image path');
  });
});
