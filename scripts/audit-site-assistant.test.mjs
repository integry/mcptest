// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { applySiteAssistantToHtml, readSiteAssistantEnv } from '../src/siteAssistant/config.mts';
import { auditSiteAssistant, auditSiteAssistantPage, CHECK_FRAME_PATH, cspDirective, cspSourcesAllow } from './audit-site-assistant.mjs';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryDirectories = [];
afterAll(() => {
  for (const directory of temporaryDirectories) fs.rmSync(directory, { recursive: true, force: true });
});

/** The production config, read the way `vite build` reads it (.env.production, then the environment). */
const productionConfig = () => readSiteAssistantEnv(loadEnv('production', projectRoot, 'VITE_'));

const INDEX_HTML = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const CONFIG = { endpoint: 'https://app.solv.chat', assistantKey: 'pk_yk0rwe2xop2ocmaj5bky' };
/** index.html as a configured build writes it: the shared layout every prerendered page starts from. */
const BUILT = applySiteAssistantToHtml(INDEX_HTML, CONFIG);
const policyOf = html => html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)[1];

describe('the production site assistant config', () => {
  it('is the mcptest.io assistant on app.solv.chat', () => {
    expect(productionConfig()).toEqual(CONFIG);
  });

  it('extends the policy by exactly the widget origin, for scripts and connections only', () => {
    const before = policyOf(INDEX_HTML);
    const after = policyOf(BUILT);
    for (const name of ['script-src', 'connect-src']) {
      expect(cspDirective(after, name)).toEqual([...cspDirective(before, name), CONFIG.endpoint]);
    }
    // Every other directive is untouched (style-src included: the widget's styles are constructed stylesheets).
    const others = policy => policy.split(';').map(part => part.trim()).filter(part => !/^(script|connect)-src\b/.test(part));
    expect(others(after)).toEqual(others(before));
    expect(cspDirective(after, 'script-src')).not.toContain("'unsafe-inline'");
    expect(cspDirective(after, 'script-src')).not.toContain("'unsafe-eval'");
  });

  // solv.chat 0.1.8 runs its visitor check (Cloudflare Turnstile) in a frame from the endpoint (issue #699).
  it('allows the visitor check frame through the layout\'s existing frame-src, unchanged', () => {
    expect(cspDirective(policyOf(BUILT), 'frame-src')).toEqual(['https:']);
    expect(cspDirective(policyOf(BUILT), 'frame-src')).toEqual(cspDirective(policyOf(INDEX_HTML), 'frame-src'));
    expect(cspSourcesAllow(cspDirective(policyOf(BUILT), 'frame-src'), `${CONFIG.endpoint}${CHECK_FRAME_PATH}`)).toBe(true);
  });
});

describe('cspSourcesAllow', () => {
  const FRAME = 'https://app.solv.chat/v1/check/frame';
  it.each([
    [['https:'], true],
    [['*'], true],
    [['https://app.solv.chat'], true],
    [['app.solv.chat'], true],
    [['https://*.solv.chat'], true],
    [['https://app.solv.chat:443'], true],
    [['https://app.solv.chat/v1/check/'], true],
    [['https://app.solv.chat/v1/check/frame'], true],
    [["'self'"], false],
    [["'none'"], false],
    [['https://app.solv.chat', "'none'"], true],
    [["'none'", 'https:'], true],
    [["'NONE'"], false],
    [["'none'", 'https://challenges.cloudflare.com'], false],
    [['http://app.solv.chat'], true],
    [['https://challenges.cloudflare.com'], false],
    [['https://solv.chat'], false],
    [['https://*.app.solv.chat'], false],
    [['https://app.solv.chat:8443'], false],
    [['https://app.solv.chat/widget/'], false],
    [['data:', 'blob:'], false],
    [[], false],
  ])('%j allows the check frame: %s', (sources, allowed) => {
    expect(cspSourcesAllow(sources, FRAME)).toBe(allowed);
  });
});

describe('auditSiteAssistantPage on fixtures', () => {
  it('passes the built layout', () => {
    expect(auditSiteAssistantPage('index.html', BUILT, CONFIG)).toEqual([]);
  });

  it('passes a frame-src that lists the chat origin beside \'none\' (browsers ignore \'none\' there)', () => {
    const html = BUILT.replace('frame-src https:', "frame-src https://app.solv.chat 'none'");
    expect(auditSiteAssistantPage('index.html', html, CONFIG)).toEqual([]);
  });

  const meta = BUILT.match(/<meta name="mcptest-site-assistant"[^>]*>/)[0];
  it.each([
    ['a page without the config tag', BUILT.replace(meta, ''), 'index.html: 0 site assistant config tags (expected 1)'],
    ['a page with the config tag twice', BUILT.replace(meta, `${meta}\n${meta}`), 'index.html: 2 site assistant config tags (expected 1)'],
    ['another assistant key', BUILT.replace(CONFIG.assistantKey, 'pk_other'), 'index.html: site assistant key pk_other is not pk_yk0rwe2xop2ocmaj5bky'],
    ['a policy that no longer allows the widget script', BUILT.replace(/(script-src [^;]*) https:\/\/app\.solv\.chat/, '$1'), 'index.html: script-src does not allow https://app.solv.chat'],
    ['a policy that no longer allows the chat requests', BUILT.replace(/(connect-src [^;]*) https:\/\/app\.solv\.chat/, '$1'), 'index.html: connect-src does not allow https://app.solv.chat'],
    ['a page without the assistant (the build before #675)', INDEX_HTML, 'index.html: script-src does not allow https://app.solv.chat'],
    ['a policy whose frame-src no longer allows the check frame', BUILT.replace('frame-src https:', 'frame-src https://challenges.cloudflare.com'),
      'index.html: frame-src does not allow the visitor check frame https://app.solv.chat/v1/check/frame'],
    ['a policy that drops frame-src, leaving default-src \'self\'', BUILT.replace('; frame-src https:', ''),
      'index.html: frame-src does not allow the visitor check frame https://app.solv.chat/v1/check/frame'],
    ['a policy whose frame-src is \'none\'', BUILT.replace('frame-src https:', "frame-src 'none'"),
      'index.html: frame-src does not allow the visitor check frame https://app.solv.chat/v1/check/frame'],
    ['unsafe-eval for scripts', BUILT.replace('script-src ', "script-src 'unsafe-eval' "), "index.html: script-src allows 'unsafe-eval'"],
    ['a wildcard script host', BUILT.replace('script-src ', 'script-src https://*.solv.chat '), 'index.html: script-src allows https://*.solv.chat'],
    ['the snippet pasted into the page as well', BUILT.replace('</body>', '<script src="https://app.solv.chat/widget.js" defer></script>\n<solv-chat assistant="pk_yk0rwe2xop2ocmaj5bky"></solv-chat></body>'),
      'index.html: the static HTML has a <solv-chat> element'],
  ])('reports %s', (_label, html, problem) => {
    expect(auditSiteAssistantPage('index.html', html, CONFIG)).toContain(problem);
  });

  it('reports a production build without the assistant', () => {
    expect(auditSiteAssistant('/nonexistent', null).problems[0]).toMatch(/does not configure the site assistant/);
  });

  it('audits every HTML page in a site', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-site-assistant-'));
    temporaryDirectories.push(root);
    fs.mkdirSync(path.join(root, 'learn'));
    fs.writeFileSync(path.join(root, 'index.html'), BUILT);
    fs.writeFileSync(path.join(root, 'learn', 'index.html'), INDEX_HTML);
    fs.writeFileSync(path.join(root, 'routes.txt'), '/\n/learn\n');
    const { problems, pages } = auditSiteAssistant(root, CONFIG);
    expect(pages).toBe(2);
    expect(problems).toContain('learn/index.html: 0 site assistant config tags (expected 1)');
    expect(problems.filter(problem => problem.startsWith('index.html'))).toEqual([]);
  });
});

/**
 * The built site. Needs `npm run build` first, so it runs from
 * `npm run test:site-audit` (CI runs it after the build).
 */
describe.skipIf(!process.env.SITE_AUDIT)('site assistant audit of dist/', () => {
  it('every page carries the assistant once and a policy that allows it', () => {
    const { problems, pages } = auditSiteAssistant(path.join(projectRoot, 'dist'), productionConfig());
    expect(problems).toEqual([]);
    expect(pages).toBeGreaterThan(100);
  });
});
