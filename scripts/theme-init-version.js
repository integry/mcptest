/**
 * public/theme-init.js is not content-hashed (it must load synchronously from a
 * fixed same-origin URL under the CSP), so caches would keep an old copy after a
 * deploy. The build appends a content hash as a query string instead; a changed
 * script then has a new URL for browsers and the CDN alike.
 */
const crypto = require('node:crypto');

const THEME_INIT_TAG = /<script src="\/theme-init\.js(?:\?v=[0-9a-f]+)?"><\/script>/;

const themeInitVersion = source => crypto.createHash('sha256').update(source).digest('hex').slice(0, 10);

/** index.html with the theme-init script URL versioned by the script's content. */
const versionThemeInitTag = (html, source) => {
  if (!THEME_INIT_TAG.test(html)) throw new Error('index.html has no <script src="/theme-init.js"></script> to version.');
  return html.replace(THEME_INIT_TAG, `<script src="/theme-init.js?v=${themeInitVersion(source)}"></script>`);
};

module.exports = { themeInitVersion, versionThemeInitTag };
