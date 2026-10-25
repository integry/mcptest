/**
 * Build-time critical CSS for the prerendered pages (issue #405).
 *
 * The production stylesheet (Bootstrap, the icon font, the app's own CSS) is
 * about 440 KB and used to block rendering on every page. Each prerendered
 * page now inlines only the rules its static first frame can match, and loads
 * the full stylesheet without blocking: a `rel="preload" as="style"` link that
 * public/theme-init.js turns into a stylesheet once it has arrived (the
 * Content-Security-Policy forbids inline `onload` handlers), with a
 * `<noscript>` stylesheet for visitors without JavaScript.
 *
 * Matching is deliberately conservative: a rule is kept when every class and
 * id its selector requires occurs somewhere in the page, ignoring combinators,
 * pseudo-classes and attribute selectors. Keeping a rule that does not apply
 * costs bytes; dropping one that does would repaint the page when the full
 * stylesheet lands, so the filter only ever errs towards keeping.
 */

/** At-rules whose block holds further rules, filtered recursively. */
const GROUPING_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'document', 'scope']);

/** Index just past a string that starts at `index`, honouring escapes. */
function skipString(css, index) {
  const quote = css[index];
  let cursor = index + 1;
  while (cursor < css.length && css[cursor] !== quote) {
    cursor += css[cursor] === '\\' ? 2 : 1;
  }
  return cursor + 1;
}

/** Index just past a comment that starts at `index`. */
function skipComment(css, index) {
  const end = css.indexOf('*/', index + 2);
  return end === -1 ? css.length : end + 2;
}

/** The index of the `}` that closes the block opened at `open`. */
function findBlockEnd(css, open) {
  let depth = 0;
  let cursor = open;
  while (cursor < css.length) {
    const char = css[cursor];
    if (char === '"' || char === "'") {
      cursor = skipString(css, cursor);
      continue;
    }
    if (char === '/' && css[cursor + 1] === '*') {
      cursor = skipComment(css, cursor);
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return cursor;
    }
    cursor += 1;
  }
  throw new Error(`Unclosed block at offset ${open} in the stylesheet.`);
}

/**
 * Splits a stylesheet into top-level nodes: style rules, at-rules with a
 * block, and block-less at-statements. Grouping at-rules are parsed into
 * their children.
 */
function parseCss(css) {
  const nodes = [];
  let cursor = 0;
  let preludeStart = 0;
  while (cursor < css.length) {
    const char = css[cursor];
    if (char === '"' || char === "'") {
      cursor = skipString(css, cursor);
      continue;
    }
    if (char === '/' && css[cursor + 1] === '*') {
      // Comments between rules are dropped; a comment inside a prelude is kept with it.
      const end = skipComment(css, cursor);
      if (!css.slice(preludeStart, cursor).trim()) preludeStart = end;
      cursor = end;
      continue;
    }
    if (char === ';') {
      const text = css.slice(preludeStart, cursor).trim();
      if (text) nodes.push({ type: 'statement', text: `${text};` });
      cursor += 1;
      preludeStart = cursor;
      continue;
    }
    if (char === '{') {
      const prelude = css.slice(preludeStart, cursor).trim();
      const close = findBlockEnd(css, cursor);
      const body = css.slice(cursor + 1, close);
      const atRule = prelude.match(/^@(-?[\w-]+)/);
      if (atRule && GROUPING_AT_RULES.has(atRule[1].toLowerCase())) {
        nodes.push({ type: 'group', prelude, children: parseCss(body) });
      } else if (atRule) {
        nodes.push({ type: 'at-rule', prelude, body });
      } else {
        nodes.push({ type: 'rule', selector: prelude, body });
      }
      cursor = close + 1;
      preludeStart = cursor;
      continue;
    }
    cursor += 1;
  }
  return nodes;
}

/** Splits a selector list on its top-level commas. */
function splitSelectorList(selectorList) {
  const selectors = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selectorList.length; index += 1) {
    const char = selectorList[index];
    if (char === '"' || char === "'") {
      index = skipString(selectorList, index) - 1;
      continue;
    }
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (char === ',' && depth === 0) {
      selectors.push(selectorList.slice(start, index));
      start = index + 1;
    }
  }
  selectors.push(selectorList.slice(start));
  return selectors.map(selector => selector.trim()).filter(Boolean);
}

/**
 * Removes the parts of a selector that never make a class or id required:
 * strings, attribute selectors, and the arguments of functional
 * pseudo-classes (`:not(.a)` matches without `.a`; `:is(.a, .b)` needs only one).
 */
function stripOptionalParts(selector) {
  let result = '';
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    if (char === '\\') {
      result += selector.slice(index, index + 2);
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      index = skipString(selector, index) - 1;
      continue;
    }
    if (char === '[' || char === '(') {
      const closing = char === '[' ? ']' : ')';
      let depth = 1;
      let cursor = index + 1;
      while (cursor < selector.length && depth > 0) {
        if (selector[cursor] === '\\') cursor += 1;
        else if (selector[cursor] === '"' || selector[cursor] === "'") cursor = skipString(selector, cursor) - 1;
        else if (selector[cursor] === char) depth += 1;
        else if (selector[cursor] === closing) depth -= 1;
        cursor += 1;
      }
      index = cursor - 1;
      continue;
    }
    result += char;
  }
  return result;
}

const SIMPLE_TOKEN = /([.#])((?:\\[0-9a-fA-F]{1,6}\s?|\\.|[\w -￿-])+)/g;

const unescapeIdentifier = value => value.replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, (_match, hex, char) => (
  hex ? String.fromCodePoint(parseInt(hex, 16)) : char
));

/** Names of the attribute selectors outside functional pseudo-classes, e.g. `[data-bs-theme=dark]`. */
function requiredAttributes(selector) {
  const names = [];
  let depth = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    if (char === '\\') {
      index += 1;
    } else if (char === '"' || char === "'") {
      index = skipString(selector, index) - 1;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
    } else if (char === '[' && depth === 0) {
      const name = selector.slice(index + 1).match(/^\s*([\w:-]+)/);
      if (name) names.push(name[1].toLowerCase());
    }
  }
  return names;
}

/** The classes, ids and attributes a single selector requires. */
function requiredTokens(selector) {
  const tokens = [];
  const required = stripOptionalParts(selector);
  for (const match of required.matchAll(SIMPLE_TOKEN)) {
    tokens.push({ kind: match[1] === '.' ? 'class' : 'id', name: unescapeIdentifier(match[2]) });
  }
  for (const name of requiredAttributes(selector)) tokens.push({ kind: 'attribute', name });
  // A type selector outside :is/:not/etc. must also exist in the page. This
  // excludes Bootstrap's unused tables, file inputs and headings, while
  // retaining universal selectors and optional functional alternatives.
  for (const match of required.matchAll(/(?:^|[\s>+~])([a-zA-Z][\w-]*)(?=[.#:\s>+~\[]|$)/g)) {
    tokens.push({ kind: 'tag', name: match[1].toLowerCase() });
  }
  return tokens;
}

const hasToken = (page, token) => {
  if (token.kind === 'class') return page.classes.has(token.name);
  if (token.kind === 'id') return page.ids.has(token.name);
  if (token.kind === 'tag') return page.tags.has(token.name);
  return page.attributes.has(token.name);
};

/** True when some selector in the list can match given the page's classes, ids and attributes. */
function selectorListMayMatch(selectorList, page) {
  return splitSelectorList(selectorList).some(selector => requiredTokens(selector).every(token => hasToken(page, token)));
}

const decodeAttribute = value => value
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

/**
 * Every class, id and attribute name that appears on an element in `html`.
 * Attribute names are collected loosely (any `name=` or bare word inside a
 * tag), which can only keep extra rules.
 */
function collectPageTokens(html, extraClasses = [], extraAttributes = []) {
  const classes = new Set(extraClasses);
  const ids = new Set();
  const tags = new Set();
  const attributes = new Set(extraAttributes.map(name => name.toLowerCase()));
  for (const tag of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    tags.add(tag[0].match(/^<([a-zA-Z][\w-]*)/)[1].toLowerCase());
    for (const match of tag[0].matchAll(/\s([a-zA-Z_:][\w:.-]*)/g)) attributes.add(match[1].toLowerCase());
  }
  for (const match of html.matchAll(/\s(class|id)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const value = decodeAttribute(match[3] ?? match[4] ?? '');
    if (match[1].toLowerCase() === 'id') {
      ids.add(value);
    } else {
      for (const name of value.split(/\s+/)) if (name) classes.add(name);
    }
  }
  return { classes, ids, attributes, tags };
}

function serialize(nodes, page) {
  let output = '';
  for (const node of nodes) {
    if (node.type === 'statement') {
      // @import has been inlined by the build; @charset is meaningless inside <style>.
      if (!/^@(import|charset)\b/i.test(node.text)) output += node.text;
    } else if (node.type === 'at-rule') {
      // @font-face, @keyframes, @property and the like are declarations, not matches.
      output += `${node.prelude}{${node.body}}`;
    } else if (node.type === 'group') {
      const inner = serialize(node.children, page);
      if (inner) output += `${node.prelude}{${inner}}`;
    } else {
      const selectors = splitSelectorList(node.selector)
        .filter(selector => selectorListMayMatch(selector, page));
      if (selectors.length) output += `${selectors.join(',')}{${node.body}}`;
    }
  }
  return output;
}

const parsedStylesheets = new Map();

/**
 * The rules of `css` that may apply to the elements in `html`, in their
 * original order. `extraClasses` and `extraAttributes` cover what scripts add
 * before the full stylesheet is guaranteed to have arrived (body state
 * classes, `data-theme` on <html>).
 */
function extractCriticalCss(css, html, { extraClasses = [], extraAttributes = [] } = {}) {
  // Every page of a build shares the stylesheet; parse it once.
  if (!parsedStylesheets.has(css)) parsedStylesheets.set(css, parseCss(css));
  return serialize(parsedStylesheets.get(css), collectPageTokens(html, extraClasses, extraAttributes));
}

const STYLESHEET_LINK = /<link\s+rel="stylesheet"((?:\s+crossorigin)?)\s+href="([^"]+)"\s*\/?>/g;
const CRITICAL_BLOCK = /<style data-critical-css>[\s\S]*?<\/style>\n\s*/g;
const DEFERRED_LINK = /<link rel="preload" as="style"((?:\s+crossorigin)?) href="([^"]+)" data-deferred-stylesheet>(?:<noscript><link rel="stylesheet"(?:\s+crossorigin)? href="[^"]+"><\/noscript>)?/g;

/** Undoes `inlineCriticalCss`, so rerunning the generator on its own output is stable. */
function restoreStylesheetLinks(html) {
  return html
    .replace(CRITICAL_BLOCK, '')
    .replace(DEFERRED_LINK, (_match, crossorigin, href) => `<link rel="stylesheet"${crossorigin} href="${href}">`);
}

/** Stylesheet URLs the page links, in document order. */
function findStylesheetHrefs(html) {
  return Array.from(restoreStylesheetLinks(html).matchAll(STYLESHEET_LINK), match => match[2]);
}

/**
 * Inlines the page's critical CSS ahead of its first stylesheet link and turns
 * every stylesheet link into a non-blocking preload. `readStylesheet(href)`
 * returns the CSS text a link points at.
 */
function inlineCriticalCss(html, readStylesheet, options = {}) {
  const source = restoreStylesheetLinks(html);
  const hrefs = Array.from(source.matchAll(STYLESHEET_LINK), match => match[2]);
  if (!hrefs.length) return source;
  const css = hrefs.map(readStylesheet).join('\n');
  const body = source.slice(source.indexOf('<body'));
  // `</` cannot appear in CSS outside a string, and inside one `<\/` is the same string.
  const critical = extractCriticalCss(css, body, options).replace(/<\//g, '<\\/');
  let inserted = false;
  return source.replace(STYLESHEET_LINK, (_match, crossorigin, href) => {
    const deferred = `<link rel="preload" as="style"${crossorigin} href="${href}" data-deferred-stylesheet>`
      + `<noscript><link rel="stylesheet"${crossorigin} href="${href}"></noscript>`;
    if (inserted) return deferred;
    inserted = true;
    return `<style data-critical-css>${critical}</style>\n    ${deferred}`;
  });
}

module.exports = {
  collectPageTokens,
  extractCriticalCss,
  findStylesheetHrefs,
  inlineCriticalCss,
  parseCss,
  requiredTokens,
  restoreStylesheetLinks,
};
