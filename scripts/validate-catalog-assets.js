#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const MAX_LOGO_BYTES = 256 * 1024;
const LOGO_SOURCE_KINDS = new Set([
  'official-brand',
  'official-site',
  'publisher-repository',
  'simple-icons',
  'generated-fallback',
]);

const projectRoot = path.join(__dirname, '..');
const defaultCatalogPath = path.join(projectRoot, 'src', 'data', 'serverCatalog.json');
const defaultPublicRoot = path.join(projectRoot, 'public');

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function hasInvalidSimpleIconsVersionTag(value) {
  try {
    const url = new URL(value);
    return url.hostname === 'github.com'
      && /^\/simple-icons\/simple-icons\/blob\/v\d[^/]*\/icons\/[^/]+\.svg$/.test(url.pathname);
  } catch {
    return false;
  }
}

function validateSvg(contents) {
  const errors = [];
  const forbiddenElements = contents.match(/<(?:script|foreignObject|iframe|object|embed)\b/i);
  if (forbiddenElements) errors.push(`contains unsafe <${forbiddenElements[0].slice(1)} element`);
  const hasEntityDeclaration = /<!DOCTYPE|<!ENTITY/i.test(contents);
  if (hasEntityDeclaration) errors.push('contains a DOCTYPE or entity declaration');
  if (/\son[a-z0-9_-]+\s*=/i.test(contents)) errors.push('contains an event-handler attribute');

  if (!hasEntityDeclaration) {
    try {
      const document = new JSDOM(contents, { contentType: 'image/svg+xml' }).window.document;
      let hasExternalResource = false;
      let hasEmbeddedDataResource = false;
      let hasExternalCssResource = false;

      for (const element of document.querySelectorAll('*')) {
        for (const attribute of element.attributes) {
          const value = attribute.value.trim();
          if (containsDataUrl(value)) hasEmbeddedDataResource = true;

          if (['href', 'src'].includes(attribute.localName.toLowerCase())) {
            if (value.startsWith('#')) continue;
            if (containsDataUrl(value)) hasEmbeddedDataResource = true;
            else hasExternalResource = true;
          }

          if (containsExternalCssResource(value)) hasExternalCssResource = true;
          if (containsEmbeddedCssResource(value)) hasEmbeddedDataResource = true;
        }

        if (element.localName.toLowerCase() === 'style'
          && containsExternalCssResource(element.textContent || '')) {
          hasExternalCssResource = true;
        }
        if (element.localName.toLowerCase() === 'style'
          && containsEmbeddedCssResource(element.textContent || '')) {
          hasEmbeddedDataResource = true;
        }
      }

      if (hasExternalResource) errors.push('references an external or executable resource');
      if (hasExternalCssResource) errors.push('loads an external resource from CSS');
      if (hasEmbeddedDataResource) errors.push('contains an embedded data resource');
    } catch {
      errors.push('must be well-formed XML');
    }
  }
  if (!/<svg\b/i.test(contents) || !/\bviewBox\s*=/.test(contents)) {
    errors.push('must contain an SVG root with a viewBox');
  }
  return errors;
}

function containsDataUrl(value) {
  return /(?:^|[^a-z0-9+.-])data:/i.test(value);
}

function containsExternalCssResource(value) {
  if (/@import\b/i.test(value)) return true;

  for (const match of value.matchAll(/\burl\(\s*(?:(["'])(.*?)\1|([^)]*))\s*\)/gi)) {
    const reference = (match[2] ?? match[3] ?? '').trim();
    if (!reference.startsWith('#') && !/^data:/i.test(reference)) {
      return true;
    }
  }
  return false;
}

function containsEmbeddedCssResource(value) {
  for (const match of value.matchAll(/\burl\(\s*(?:(["'])(.*?)\1|([^)]*))\s*\)/gi)) {
    const reference = (match[2] ?? match[3] ?? '').trim();
    if (/^data:/i.test(reference)) return true;
  }
  return false;
}

function readPngMetadata(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature)) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25],
    hasTransparencyChunk: buffer.includes(Buffer.from('tRNS')),
  };
}

function validateLogoFile(filePath, logoUrl) {
  const errors = [];
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) return ['must resolve to a regular, non-symlink file'];
  if (stat.size > MAX_LOGO_BYTES) {
    errors.push(`is ${stat.size} bytes; maximum is ${MAX_LOGO_BYTES}`);
  }

  const extension = path.extname(logoUrl).toLowerCase();
  if (!['.svg', '.png'].includes(extension)) {
    errors.push('must use SVG or PNG');
    return errors;
  }

  const contents = fs.readFileSync(filePath);
  if (extension === '.svg') {
    errors.push(...validateSvg(contents.toString('utf8')));
  } else if (extension === '.png') {
    const metadata = readPngMetadata(contents);
    if (!metadata) return [...errors, 'is not a valid PNG'];
    if (metadata.width !== metadata.height || metadata.width < 128 || metadata.width > 512) {
      errors.push(`must be a square 128-512px canvas; found ${metadata.width}x${metadata.height}`);
    }
    if (![4, 6].includes(metadata.colorType) && !metadata.hasTransparencyChunk) {
      errors.push('must support transparency');
    }
  }
  return errors;
}

function validateCatalogAssets(
  seeds,
  { publicRoot = defaultPublicRoot, logoDirectory = path.join(publicRoot, 'server-logos') } = {}
) {
  const errors = [];
  const ids = new Set();
  const referencedFiles = new Set();
  const resolvedLogoDirectory = path.resolve(logoDirectory);

  for (const seed of seeds) {
    const label = seed.id || '<missing id>';
    if (!seed.id || ids.has(seed.id)) {
      errors.push(seed.id ? `Duplicate catalog server id: ${seed.id}` : 'Catalog server is missing an id');
    } else {
      ids.add(seed.id);
    }

    if (typeof seed.logoUrl !== 'string' || !seed.logoUrl.startsWith('/server-logos/')) {
      errors.push(`${label}: logoUrl must be a local path inside /server-logos/`);
    } else if (/[?#]/.test(seed.logoUrl) || seed.logoUrl.includes('\\')) {
      errors.push(`${label}: logoUrl must not contain a query, fragment, or backslash`);
    } else {
      const relativePath = seed.logoUrl.slice(1);
      const filePath = path.resolve(publicRoot, relativePath);
      const expectedName = `${seed.id}${path.extname(seed.logoUrl).toLowerCase()}`;
      if (path.basename(seed.logoUrl) !== expectedName) {
        errors.push(`${label}: logo filename must match the server id (${expectedName})`);
      }
      if (filePath !== resolvedLogoDirectory && !filePath.startsWith(`${resolvedLogoDirectory}${path.sep}`)) {
        errors.push(`${label}: logoUrl resolves outside /server-logos/`);
      } else if (!fs.existsSync(filePath)) {
        errors.push(`${label}: logo file is missing: ${seed.logoUrl}`);
      } else {
        referencedFiles.add(path.resolve(filePath));
        for (const fileError of validateLogoFile(filePath, seed.logoUrl)) {
          errors.push(`${label}: ${seed.logoUrl} ${fileError}`);
        }
      }
    }

    if (!LOGO_SOURCE_KINDS.has(seed.logoSourceKind)) {
      errors.push(`${label}: logoSourceKind is invalid`);
    }
    if (!isIsoDate(seed.logoRetrievedAt)) {
      errors.push(`${label}: logoRetrievedAt must be a valid ISO date (YYYY-MM-DD)`);
    }
    if (seed.logoSourceKind === 'generated-fallback') {
      if (seed.logoSourceUrl !== undefined) {
        errors.push(`${label}: generated fallback must not declare a logoSourceUrl`);
      }
      if (!seed.logoLicenseNote || !/generated|not an official/i.test(seed.logoLicenseNote)) {
        errors.push(`${label}: generated fallback needs an explicit provenance note`);
      }
    } else if (!isHttpsUrl(seed.logoSourceUrl)) {
      errors.push(`${label}: sourced logo requires an HTTPS logoSourceUrl`);
    } else if (seed.logoSourceKind === 'simple-icons'
      && hasInvalidSimpleIconsVersionTag(seed.logoSourceUrl)) {
      errors.push(`${label}: Simple Icons version tags must not have a leading v`);
    }
  }

  if (!fs.existsSync(resolvedLogoDirectory)) {
    errors.push('Logo directory is missing: /server-logos/');
  } else {
    for (const entry of fs.readdirSync(resolvedLogoDirectory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const filePath = path.resolve(resolvedLogoDirectory, entry.name);
      if (!referencedFiles.has(filePath)) {
        errors.push(`Unreferenced catalog logo asset: /server-logos/${entry.name}`);
      }
    }
  }

  return errors;
}

function main() {
  const seeds = JSON.parse(fs.readFileSync(defaultCatalogPath, 'utf8'));
  const errors = validateCatalogAssets(seeds);
  if (errors.length) {
    console.error(`Catalog asset validation failed with ${errors.length} error(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Validated ${seeds.length} catalog logo assets and provenance records.`);
}

if (require.main === module) main();

module.exports = {
  LOGO_SOURCE_KINDS,
  MAX_LOGO_BYTES,
  isIsoDate,
  validateCatalogAssets,
  validateLogoFile,
  validateSvg,
};
