/**
 * Build-time Open Graph images: one 1200x630 PNG per prerendered page,
 * rendered without a browser (satori lays the card out as SVG, resvg
 * rasterizes it). Inputs are hashed so unchanged cards are copied from
 * node_modules/.cache/og instead of being rendered again.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, getOgImageSlug } = require('../../src/utils/ogImage.ts');

const projectRoot = path.join(__dirname, '..', '..');
const DEFAULT_CACHE_DIR = path.join(projectRoot, 'node_modules', '.cache', 'og');
const FONT_DIR = path.join(projectRoot, 'node_modules', '@fontsource-variable', 'inter', 'files');
// Latin first so its metrics win; latin-ext supplies the remaining glyphs.
const FONT_FILES = ['inter-latin-wght-normal.woff2', 'inter-latin-ext-wght-normal.woff2'];
const FONT_WEIGHTS = [400, 600, 700];

const COLORS = {
  background: '#0f1115',
  border: '#232833',
  text: '#f5f7fa',
  muted: '#a3acb9',
  accent: '#36e0aa',
};

/**
 * @typedef {object} OgCard
 * @property {string} pagePath Canonical page path; decides the output file.
 * @property {string} title
 * @property {string} summary
 * @property {string} [eyebrow] Short label above the title, such as the track. Rendered as
 *   written, in sentence case: the design rules forbid small uppercase labels.
 * @property {string} [logoFile] Absolute path to a local server logo (SVG or PNG).
 * @property {string} [initials] Shown in place of a logo when there is no local file.
 */

const ACCENT_BAR_HEIGHT = 8;
const CARD_PADDING_X = 72;
const CARD_PADDING_TOP = 52;
const CARD_PADDING_BOTTOM = 56;
const LOGO_TILE_SIZE = 128;
const LOGO_GAP = 48;

const TEMPLATE_PROBE_CARD = {
  pagePath: '/',
  eyebrow: 'Eyebrow',
  title: 'Title',
  summary: 'Summary',
  initials: 'T',
};

let fontsPromise;
let rendererFingerprint;

function sha256(...parts) {
  const hash = crypto.createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest('hex');
}

function loadFonts() {
  fontsPromise ||= Promise.resolve().then(() => {
    const files = FONT_FILES.map(file => fs.readFileSync(path.join(FONT_DIR, file)));
    return files.flatMap(data => FONT_WEIGHTS.map(weight => ({ name: 'Inter', data, weight, style: 'normal' })));
  });
  return fontsPromise;
}

/**
 * Changes whenever the template, the fonts or the renderer versions change.
 * The template is covered twice: by this file's bytes and by the element tree
 * of a probe card with every optional slot filled, so a style change (such as
 * the eyebrow casing) always invalidates the cached PNGs.
 */
function getRendererFingerprint() {
  if (!rendererFingerprint) {
    const versions = ['satori', '@resvg/resvg-js'].map(name => (
      `${name}@${require(`${name}/package.json`).version}`
    ));
    rendererFingerprint = sha256(
      fs.readFileSync(__filename),
      JSON.stringify(buildOgCardTree(TEMPLATE_PROBE_CARD)),
      versions.join(','),
      ...FONT_FILES.map(file => fs.readFileSync(path.join(FONT_DIR, file)))
    );
  }
  return rendererFingerprint;
}

/** Cache key for one card: its text, its logo bytes and the renderer fingerprint. */
function getOgCardHash(card) {
  const logo = card.logoFile ? fs.readFileSync(card.logoFile) : Buffer.alloc(0);
  return sha256(
    getRendererFingerprint(),
    JSON.stringify([card.pagePath, card.eyebrow || '', card.title, card.summary, card.initials || '']),
    logo
  );
}

function element(type, style, children, extraProps = {}) {
  return { type, props: { style, children, ...extraProps } };
}

function logoDataUri(logoFile) {
  const extension = path.extname(logoFile).toLowerCase();
  const mime = extension === '.svg' ? 'image/svg+xml' : extension === '.png' ? 'image/png' : undefined;
  if (!mime) throw new Error(`Unsupported logo format for Open Graph image: ${logoFile}`);
  return `data:${mime};base64,${fs.readFileSync(logoFile).toString('base64')}`;
}

function renderLogoTile(card) {
  if (!card.logoFile && !card.initials) return null;
  const tileStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: LOGO_TILE_SIZE,
    height: LOGO_TILE_SIZE,
    borderRadius: 24,
    background: '#ffffff',
    flexShrink: 0,
  };
  if (card.logoFile) {
    return element('div', tileStyle, element('img', { width: 88, height: 88, objectFit: 'contain' }, undefined, {
      src: logoDataUri(card.logoFile),
      width: 88,
      height: 88,
    }));
  }
  return element('div', { ...tileStyle, background: COLORS.border, color: COLORS.text, fontSize: 48, fontWeight: 700 }, card.initials);
}

/** The satori element tree for one card. Exported for tests. */
function buildOgCardTree(card) {
  const logoTile = renderLogoTile(card);
  // Explicit pixel sizes: satori lays out content-box, so percentages and
  // padding on the root would overflow the 1200x630 canvas.
  const contentWidth = OG_IMAGE_WIDTH - 2 * CARD_PADDING_X;
  return element('div', {
    display: 'flex',
    flexDirection: 'column',
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    background: COLORS.background,
    color: COLORS.text,
    fontFamily: 'Inter',
  }, [
    element('div', { display: 'flex', width: OG_IMAGE_WIDTH, height: ACCENT_BAR_HEIGHT, background: COLORS.accent }),
    element('div', {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      width: contentWidth,
      height: OG_IMAGE_HEIGHT - ACCENT_BAR_HEIGHT - CARD_PADDING_TOP - CARD_PADDING_BOTTOM,
      marginTop: CARD_PADDING_TOP,
      marginLeft: CARD_PADDING_X,
    }, [
      element('div', { display: 'flex', alignItems: 'center', fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }, [
        element('span', { color: COLORS.text }, 'mcptest'),
        element('span', { color: COLORS.accent }, '.io'),
      ]),
      element('div', { display: 'flex', alignItems: 'center', width: contentWidth }, [
        element('div', {
          display: 'flex',
          flexDirection: 'column',
          width: logoTile ? contentWidth - LOGO_TILE_SIZE - LOGO_GAP : contentWidth,
        }, [
          ...(card.eyebrow ? [element('div', {
            display: 'flex',
            fontSize: 26,
            fontWeight: 600,
            color: COLORS.accent,
            marginBottom: 18,
          }, card.eyebrow)] : []),
          element('div', {
            display: 'block',
            fontSize: 60,
            fontWeight: 700,
            lineHeight: 1.12,
            letterSpacing: -1,
            lineClamp: 3,
          }, card.title),
        ]),
        ...(logoTile ? [element('div', { display: 'flex', marginLeft: LOGO_GAP }, logoTile)] : []),
      ]),
      element('div', {
        display: 'flex',
        flexDirection: 'column',
        width: contentWidth,
        borderTop: `1px solid ${COLORS.border}`,
        paddingTop: 24,
      }, element('div', {
        display: 'block',
        fontSize: 28,
        lineHeight: 1.4,
        color: COLORS.muted,
        lineClamp: 2,
      }, card.summary)),
    ]),
  ]);
}

/** Renders one card to PNG bytes. */
async function renderOgImage(card) {
  const satori = require('satori').default;
  const { Resvg } = require('@resvg/resvg-js');
  const svg = await satori(buildOgCardTree(card), {
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    fonts: await loadFonts(),
  });
  return new Resvg(svg, { fitTo: { mode: 'width', value: OG_IMAGE_WIDTH } }).render().asPng();
}

/** Output path (relative to dist) for a card's image. */
function ogImageOutputPath(card) {
  return path.join('og', ...`${getOgImageSlug(card.pagePath)}.png`.split('/'));
}

/**
 * Writes every card to `<distRoot>/og/<slug>.png`, rendering only cards whose
 * input hash is not already in the cache.
 * @param {OgCard[]} cards
 * @returns {Promise<{ rendered: number, cached: number }>}
 */
async function writeOgImages(cards, { distRoot, cacheDir = DEFAULT_CACHE_DIR }) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const seen = new Set();
  let rendered = 0;
  let cached = 0;
  for (const card of cards) {
    const relativePath = ogImageOutputPath(card);
    if (seen.has(relativePath)) throw new Error(`Duplicate Open Graph image path: ${relativePath}`);
    seen.add(relativePath);

    const cachePath = path.join(cacheDir, `${getOgCardHash(card)}.png`);
    const outputPath = path.join(distRoot, relativePath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    if (fs.existsSync(cachePath)) {
      fs.copyFileSync(cachePath, outputPath);
      cached += 1;
      continue;
    }
    const png = await renderOgImage(card);
    // Write to a temporary name first so an interrupted build never leaves a truncated cache entry.
    const temporaryPath = `${cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, png);
    fs.renameSync(temporaryPath, cachePath);
    fs.copyFileSync(cachePath, outputPath);
    rendered += 1;
  }
  return { rendered, cached };
}

module.exports = {
  DEFAULT_CACHE_DIR,
  buildOgCardTree,
  getOgCardHash,
  ogImageOutputPath,
  renderOgImage,
  writeOgImages,
};
