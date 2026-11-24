// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applySiteAssistantCsp,
  SITE_ASSISTANT_BOOT_SOURCE,
  isSiteAssistantPath,
  normalizeSolvEndpoint,
  readSiteAssistantEnv,
  SITE_ASSISTANT_META_NAME,
  widgetScriptUrl,
} from './config.mts';
import { siteAssistantHtmlTransform } from './html.mts';

const applySiteAssistantToHtml = siteAssistantHtmlTransform(readFileSync(resolve('src/siteAssistant/boot.js')));
const INDEX_HTML = readFileSync(resolve('index.html'), 'utf8');
const policyOf = (html: string) => html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
const directive = (policy: string, name: string) =>
  policy.split(';').map(part => part.trim()).find(part => part.split(' ')[0] === name)?.split(' ').slice(1) ?? [];

const CONFIGURED = { VITE_SOLV_ENDPOINT: 'https://chat.example.com', VITE_SOLV_ASSISTANT_KEY: 'pk_live_abc123' };

describe('site assistant gating', () => {
  it('is off unless both variables are set', () => {
    expect(readSiteAssistantEnv({})).toBeNull();
    expect(readSiteAssistantEnv({ VITE_SOLV_ENDPOINT: CONFIGURED.VITE_SOLV_ENDPOINT })).toBeNull();
    expect(readSiteAssistantEnv({ VITE_SOLV_ASSISTANT_KEY: CONFIGURED.VITE_SOLV_ASSISTANT_KEY })).toBeNull();
    expect(readSiteAssistantEnv({ VITE_SOLV_ENDPOINT: ' ', VITE_SOLV_ASSISTANT_KEY: ' ' })).toBeNull();
    expect(readSiteAssistantEnv(CONFIGURED)).toEqual({ endpoint: 'https://chat.example.com', assistantKey: 'pk_live_abc123' });
  });

  it('keeps only the origin of the endpoint and requires https outside loopback', () => {
    expect(normalizeSolvEndpoint('https://chat.example.com/some/path/?q=1')).toBe('https://chat.example.com');
    expect(normalizeSolvEndpoint('https://chat.example.com:8443')).toBe('https://chat.example.com:8443');
    expect(normalizeSolvEndpoint('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(normalizeSolvEndpoint('http://localhost:8787')).toBe('http://localhost:8787');
    expect(normalizeSolvEndpoint('http://chat.example.com')).toBeNull();
    expect(normalizeSolvEndpoint('https://user:pw@chat.example.com')).toBeNull();
    expect(normalizeSolvEndpoint('javascript:alert(1)')).toBeNull();
    expect(normalizeSolvEndpoint('chat.example.com')).toBeNull();
  });

  it('rejects keys that are not plain public-key ids', () => {
    expect(readSiteAssistantEnv({ ...CONFIGURED, VITE_SOLV_ASSISTANT_KEY: 'pk"><script>' })).toBeNull();
    expect(readSiteAssistantEnv({ ...CONFIGURED, VITE_SOLV_ASSISTANT_KEY: 'pk live' })).toBeNull();
  });

  it('loads the widget from the solv.chat install path', () => {
    expect(widgetScriptUrl(readSiteAssistantEnv(CONFIGURED)!)).toBe('https://chat.example.com/widget.js');
  });
});

describe('site assistant page exclusions', () => {
  it.each([
    '/oauth/callback',
    '/install-integration',
    '/space',
    '/space/',
    '/space/my-dashboard',
    '/report',
    '/report/',
    '/report/mcp.example.com/mcp',
    '/server/mcp.example.com/mcp',
    '/call/mcp.example.com/mcp/tool/x',
    '/r',
    '/r/abc123',
    '/mcp-server-development///',
  ])('is off on %s', pathname => {
    expect(isSiteAssistantPath(pathname)).toBe(false);
  });

  it.each([
    '/',
    '/catalog',
    '/catalog/developer-tools',
    '/servers/github',
    '/learn',
    '/learn/oauth-for-mcp-explained',
    '/docs/getting-started',
    '/tools/oauth-check',
    '/mcp-test-servers',
    '/reports-guide',
    '/mcp-server-development/guide',
    '/server',
    '/spaces',
    '/submit',
  ])('may show on %s', pathname => {
    expect(isSiteAssistantPath(pathname)).toBe(true);
  });
});

describe('site assistant Content-Security-Policy', () => {
  const config = readSiteAssistantEnv(CONFIGURED);

  it('leaves index.html byte-for-byte unchanged when the assistant is off', () => {
    expect(applySiteAssistantToHtml(INDEX_HTML, null)).toBe(INDEX_HTML);
    expect(applySiteAssistantCsp("default-src 'self'", null)).toBe("default-src 'self'");
  });

  it('allows exactly the configured origin for the script and its connections', () => {
    const before = policyOf(INDEX_HTML);
    const after = policyOf(applySiteAssistantToHtml(INDEX_HTML, config));
    expect(directive(after, 'script-src')).toEqual([...directive(before, 'script-src'), 'https://chat.example.com', SITE_ASSISTANT_BOOT_SOURCE]);
    expect(directive(after, 'connect-src')).toEqual([...directive(before, 'connect-src'), 'https://chat.example.com']);
    // Nothing else moves, and no wildcard appears.
    for (const name of ['default-src', 'style-src', 'img-src', 'font-src', 'frame-src', 'form-action', 'object-src', 'base-uri']) {
      expect(directive(after, name)).toEqual(directive(before, name));
    }
    expect(directive(after, 'script-src').some(source => source.includes('*'))).toBe(false);
  });

  it('adds the config meta tag after the policy, and nothing in the body', () => {
    const html = applySiteAssistantToHtml(INDEX_HTML, config);
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain(`<meta name="${SITE_ASSISTANT_META_NAME}" data-endpoint="https://chat.example.com" data-assistant="pk_live_abc123" />`);
    expect(html.slice(html.indexOf('<body>'))).toBe(INDEX_HTML.slice(INDEX_HTML.indexOf('<body>')));
    expect(head.indexOf('<script data-key="pk_live_abc123">')).toBeGreaterThan(head.indexOf('<meta name="viewport"'));
    expect(html).not.toContain('widget.js');
  });

  it('does not add the origin twice and starts a missing directive from default-src', () => {
    const once = applySiteAssistantCsp("default-src 'self'; script-src 'self' https://chat.example.com", config);
    expect(directive(once, 'script-src')).toEqual(["'self'", 'https://chat.example.com', SITE_ASSISTANT_BOOT_SOURCE]);
    expect(directive(once, 'connect-src')).toEqual(["'self'", 'https://chat.example.com']);
  });

  it('fails the build rather than ship a policy that blocks the widget', () => {
    expect(() => applySiteAssistantToHtml('<html><head></head></html>', config)).toThrow(/Content-Security-Policy/);
  });
});
