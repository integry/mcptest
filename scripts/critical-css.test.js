import { describe, expect, it } from 'vitest';
import criticalCss from './critical-css.js';

const {
  extractCriticalCss,
  findStylesheetHrefs,
  inlineCriticalCss,
  parseCss,
  requiredTokens,
  restoreStylesheetLinks,
} = criticalCss;

const STYLESHEET = [
  '@charset "UTF-8";',
  ':root{--accent:#047857}',
  ":root[data-theme='dark']{--accent:#34d399}",
  '[data-bs-theme=dark]{--bs-body-bg:#000}',
  '@font-face{font-family:Inter;src:url(/assets/inter.woff2?v=1) format("woff2")}',
  'body,h1{margin:0}',
  '.app-header{display:flex}',
  '.unused-widget{color:red}',
  '.reading-prose pre:not(.plain){overflow:auto}',
  '.bi-copy:before{content:"\\f759"}',
  '.bi-alarm:before{content:"\\f102"}',
  '#root>.shell{height:100%}',
  '.a,.b .c{color:blue}',
  '.sidenav-collapsed .desktop-sidebar{width:4rem}',
  '/* a comment with { braces } */',
  '@media (min-width:768px){.app-header{gap:1rem}.unused-widget{gap:0}}',
  '@supports (display:grid){@media print{.unused-widget{display:none}}}',
  '@keyframes spin{to{transform:rotate(1turn)}}',
  '.content:after{content:"} not a block"}',
].join('');

const PAGE = '<body><div id="root"><header class="app-header"><h1>T</h1></header>'
  + '<div class="reading-prose"><pre><code>x</code></pre><button class="reading-code-copy"><i class="bi bi-copy"></i></button></div>'
  + '<div class="desktop-sidebar"></div><p class="b"><span class="c">c</span></p></div></body>';

describe('critical CSS extraction', () => {
  it('parses nested at-rules, strings and comments without losing rules', () => {
    const nodes = parseCss(STYLESHEET);
    expect(nodes.map(node => node.type)).toEqual([
      'statement', 'rule', 'rule', 'rule', 'at-rule', 'rule', 'rule', 'rule', 'rule', 'rule', 'rule', 'rule', 'rule', 'rule',
      'group', 'group', 'at-rule', 'rule',
    ]);
    expect(nodes.at(-1)).toEqual({ type: 'rule', selector: '.content:after', body: 'content:"} not a block"' });
    expect(nodes[15].children[0].children).toHaveLength(1);
  });

  it('requires only the classes, ids and attributes a match cannot do without', () => {
    expect(requiredTokens('.reading-prose pre:not(.plain)')).toEqual([{ kind: 'class', name: 'reading-prose' }]);
    expect(requiredTokens(':is(.a, .b) > #root.x[data-y="a.b"]')).toEqual([
      { kind: 'id', name: 'root' },
      { kind: 'class', name: 'x' },
      { kind: 'attribute', name: 'data-y' },
    ]);
    expect(requiredTokens('.g-col-md-1,.\\31 0')).toEqual([
      { kind: 'class', name: 'g-col-md-1' },
      { kind: 'class', name: '10' },
    ]);
  });

  it('keeps the rules the page can match, in order, and every declaration at-rule', () => {
    const css = extractCriticalCss(STYLESHEET, PAGE, { extraAttributes: ['data-theme'] });
    expect(css).toBe([
      ':root{--accent:#047857}',
      ":root[data-theme='dark']{--accent:#34d399}",
      '@font-face{font-family:Inter;src:url(/assets/inter.woff2?v=1) format("woff2")}',
      'body,h1{margin:0}',
      '.app-header{display:flex}',
      '.reading-prose pre:not(.plain){overflow:auto}',
      '.bi-copy:before{content:"\\f759"}',
      '.a,.b .c{color:blue}',
      '@media (min-width:768px){.app-header{gap:1rem}}',
      '@keyframes spin{to{transform:rotate(1turn)}}',
    ].join(''));
  });

  it('keeps rules for state scripts add before the stylesheet has applied', () => {
    expect(extractCriticalCss(STYLESHEET, PAGE)).not.toContain('.sidenav-collapsed');
    expect(extractCriticalCss(STYLESHEET, PAGE)).not.toContain("data-theme='dark'");
    const css = extractCriticalCss(STYLESHEET, PAGE, { extraClasses: ['sidenav-collapsed'], extraAttributes: ['data-theme'] });
    expect(css).toContain('.sidenav-collapsed .desktop-sidebar{width:4rem}');
    expect(css).toContain(":root[data-theme='dark']");
  });
});

describe('inlining into a page', () => {
  const head = '<html><head><script type="module" crossorigin src="/assets/index.js"></script>\n'
    + '    <link rel="stylesheet" crossorigin href="/assets/style.css">\n  </head>';
  const html = `${head}${PAGE}</html>`;
  const read = href => {
    expect(href).toBe('/assets/style.css');
    return STYLESHEET;
  };

  it('inlines the critical rules and preloads the stylesheet with a no-script fallback', () => {
    const output = inlineCriticalCss(html, read);
    const document = new DOMParser().parseFromString(output, 'text/html');

    // Only the <noscript> fallback is a stylesheet link.
    expect(document.querySelectorAll('link[rel="stylesheet"]:not(noscript *)')).toHaveLength(0);
    const preload = document.querySelector('link[rel="preload"][as="style"]');
    expect(preload.getAttribute('href')).toBe('/assets/style.css');
    expect(preload.hasAttribute('data-deferred-stylesheet')).toBe(true);
    expect(preload.hasAttribute('crossorigin')).toBe(true);
    expect(output).toContain('<noscript><link rel="stylesheet" crossorigin href="/assets/style.css"></noscript>');
    const style = document.querySelector('style[data-critical-css]');
    expect(style.textContent).toContain('.app-header{display:flex}');
    expect(style.textContent).not.toContain('.unused-widget');
    // Before the preload, so it applies to the first paint.
    expect(output.indexOf('<style data-critical-css>')).toBeLessThan(output.indexOf('rel="preload" as="style"'));
  });

  it('is stable when run on its own output and reversible', () => {
    const once = inlineCriticalCss(html, read);
    expect(inlineCriticalCss(once, read)).toBe(once);
    expect(restoreStylesheetLinks(once)).toBe(html);
    expect(findStylesheetHrefs(once)).toEqual(['/assets/style.css']);
  });

  it('cannot close its own style element', () => {
    const output = inlineCriticalCss(html, () => '.app-header:after{content:"</style><script>x</script>"}');
    expect(output).toContain('content:"<\\/style><script>x<\\/script>"');
    expect(output.match(/<\/style>/g)).toHaveLength(1);
  });

  it('leaves a page without stylesheets untouched', () => {
    const plain = `<html><head></head>${PAGE}</html>`;
    expect(inlineCriticalCss(plain, read)).toBe(plain);
  });
});
