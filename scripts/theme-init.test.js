import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { themeInitVersion, versionThemeInitTag } from './theme-init-version.js';

const projectRoot = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(projectRoot, 'public', 'theme-init.js'), 'utf8');

/** Runs public/theme-init.js against a fake window and returns the theme it set. */
const runThemeInit = ({ saved = null, prefersDark = false, storageThrows = false, matchMedia = true } = {}) => {
  const attributes = {};
  const document = {
    documentElement: { setAttribute: (name, value) => { attributes[name] = value; } },
  };
  const window = {
    localStorage: {
      getItem: (key) => {
        if (storageThrows) throw new Error('SecurityError');
        return key === 'theme' ? saved : null;
      },
    },
    ...(matchMedia ? {
      matchMedia: (query) => ({ matches: query === '(prefers-color-scheme: dark)' && prefersDark }),
    } : {}),
  };
  new Function('window', 'document', source)(window, document);
  return attributes['data-theme'];
};

describe('theme-init.js', () => {
  it('uses a saved theme over the system preference', () => {
    expect(runThemeInit({ saved: 'dark', prefersDark: false })).toBe('dark');
    expect(runThemeInit({ saved: 'light', prefersDark: true })).toBe('light');
  });

  it('falls back to prefers-color-scheme when nothing valid is saved', () => {
    expect(runThemeInit({ prefersDark: true })).toBe('dark');
    expect(runThemeInit({ saved: 'sepia', prefersDark: true })).toBe('dark');
    expect(runThemeInit({ prefersDark: false })).toBe('light');
  });

  it('defaults to light without matchMedia', () => {
    expect(runThemeInit({ matchMedia: false })).toBe('light');
  });

  it('still follows the system preference when storage is unavailable', () => {
    expect(runThemeInit({ storageThrows: true, prefersDark: true })).toBe('dark');
    expect(runThemeInit({ storageThrows: true })).toBe('light');
  });

  it('loads synchronously from index.html before any stylesheet or module script', () => {
    const indexHtml = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
    const head = indexHtml.slice(0, indexHtml.indexOf('</head>'));
    const tag = head.match(/<script[^>]*src="\/theme-init\.js"[^>]*><\/script>/);
    expect(tag).not.toBeNull();
    expect(tag[0]).not.toMatch(/\b(async|defer|type=)/);
    const position = head.indexOf(tag[0]);
    const firstStylesheet = head.search(/<link[^>]*rel="stylesheet"/);
    expect(firstStylesheet === -1 || position < firstStylesheet).toBe(true);
    expect(indexHtml.indexOf('type="module"')).toBeGreaterThan(position);
    // CSP: script-src 'self' covers a same-origin file, so no hash is needed.
    expect(head).toMatch(/script-src 'self'/);
  });
});

describe('theme-init.js versioning', () => {
  const indexHtml = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');

  it('adds a content hash to the script URL so caches fetch a changed script', () => {
    const versioned = versionThemeInitTag(indexHtml, source);
    expect(versioned).toContain(`<script src="/theme-init.js?v=${themeInitVersion(source)}"></script>`);
    expect(versioned).not.toContain('<script src="/theme-init.js"></script>');
    expect(themeInitVersion(source)).not.toBe(themeInitVersion(`${source}\n// changed`));
  });

  it('is idempotent and fails loudly when the tag is missing', () => {
    const once = versionThemeInitTag(indexHtml, source);
    expect(versionThemeInitTag(once, source)).toBe(once);
    expect(() => versionThemeInitTag('<html></html>', source)).toThrow(/theme-init/);
  });
});
