import { describe, expect, it, vi } from 'vitest';
import {
  SERVICE_PAGE_OFF,
  applyServicePageToHtml,
  isQuoteUrl,
  isServicePageFlagOn,
  normalizeServiceApi,
  resolveServicePageConfig,
  servicePageCspSources,
} from './config.mts';
import { fetchServiceOffer, formatPrice, offerUrl, parseServiceOffer } from './offer';

const CONTRACT_EXAMPLE = {
  ordersOpen: true,
  currency: 'USD',
  offers: [
    { id: 'basic-build', name: 'MCP server from your API', fromPrice: 49900, deliveryDays: 5 },
    { id: 'audit-fix', name: 'Audit and fix', fromPrice: 75000, deliveryDays: 5 },
  ],
  maintenance: { monthlyPrice: 3900 },
  updatedAt: '2026-11-18T00:00:00Z',
};

const INDEX_HTML = `<head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; connect-src 'self' https://proxy.example" />
  </head>`;

const enabled = (env: Record<string, string> = {}) => resolveServicePageConfig({ VITE_SERVICE_PAGE_ENABLED: 'true', ...env });

describe('the service page flag', () => {
  it('is on only for "true"', () => {
    expect(isServicePageFlagOn('true')).toBe(true);
    expect(isServicePageFlagOn(' true ')).toBe(true);
    for (const value of [undefined, '', 'false', '1', 'yes', 'TRUE']) expect(isServicePageFlagOn(value), String(value)).toBe(false);
  });

  it('ignores every other variable while it is off', () => {
    expect(resolveServicePageConfig({
      VITE_SERVICE_API: 'https://service.example.com',
      VITE_SOLV_ENDPOINT: 'https://chat.example.com',
      VITE_SOLV_QUOTE_ASSISTANT_KEY: 'pk_quote',
    })).toEqual(SERVICE_PAGE_OFF);
  });

  it('reads the service API and the quote assistant when on', () => {
    expect(enabled({
      VITE_SERVICE_API: 'https://service.example.com/',
      VITE_SOLV_ENDPOINT: 'https://chat.example.com',
      VITE_SOLV_QUOTE_ASSISTANT_KEY: 'pk_quote',
    })).toEqual({
      enabled: true,
      serviceApi: 'https://service.example.com',
      quoteAssistant: { endpoint: 'https://chat.example.com', assistantKey: 'pk_quote' },
    });
    expect(enabled()).toEqual({ enabled: true, serviceApi: null, quoteAssistant: null });
    // The quote assistant needs the shared solv.chat endpoint.
    expect(enabled({ VITE_SOLV_QUOTE_ASSISTANT_KEY: 'pk_quote' }).quoteAssistant).toBeNull();
  });
});

describe('normalizeServiceApi', () => {
  it.each([
    ['https://service.example.com', 'https://service.example.com'],
    ['https://service.example.com/', 'https://service.example.com'],
    ['https://example.com/service/', 'https://example.com/service'],
  ])('accepts %s', (value, expected) => {
    expect(normalizeServiceApi(value)).toBe(expected);
  });

  it.each([
    undefined, '', 'service.example.com', 'http://service.example.com', 'http://localhost:8787',
    'https://user:pass@service.example.com', 'https://service.example.com/?key=1', 'https://service.example.com/#x', 'javascript:alert(1)',
  ])('rejects %s', value => {
    expect(normalizeServiceApi(value)).toBeNull();
  });
});

describe('the CSP additions', () => {
  it('add nothing while the page is off or the variables are unset', () => {
    expect(applyServicePageToHtml(INDEX_HTML, SERVICE_PAGE_OFF)).toBe(INDEX_HTML);
    expect(applyServicePageToHtml(INDEX_HTML, enabled())).toBe(INDEX_HTML);
    expect(applyServicePageToHtml(INDEX_HTML, resolveServicePageConfig({ VITE_SERVICE_API: 'https://service.example.com' }))).toBe(INDEX_HTML);
  });

  it('allow the service API origin in connect-src only', () => {
    const config = enabled({ VITE_SERVICE_API: 'https://example.com/service' });
    expect(servicePageCspSources(config)).toEqual({ 'script-src': [], 'connect-src': ['https://example.com'] });
    const html = applyServicePageToHtml(INDEX_HTML, config);
    expect(html).toContain('content="default-src \'self\'; script-src \'self\'; connect-src \'self\' https://proxy.example https://example.com"');
    expect(html).not.toContain('*');
  });

  it('allow the quote assistant origin for its script and chat requests', () => {
    const config = enabled({
      VITE_SERVICE_API: 'https://service.example.com',
      VITE_SOLV_ENDPOINT: 'https://chat.example.com',
      VITE_SOLV_QUOTE_ASSISTANT_KEY: 'pk_quote',
    });
    expect(applyServicePageToHtml(INDEX_HTML, config)).toContain(
      'content="default-src \'self\'; script-src \'self\' https://chat.example.com; connect-src \'self\' https://proxy.example https://service.example.com https://chat.example.com"',
    );
  });

  it('does not repeat a source the site assistant already added', () => {
    const html = INDEX_HTML.replace("script-src 'self'", "script-src 'self' https://chat.example.com").replace('https://proxy.example', 'https://proxy.example https://chat.example.com');
    const config = enabled({ VITE_SOLV_ENDPOINT: 'https://chat.example.com', VITE_SOLV_QUOTE_ASSISTANT_KEY: 'pk_quote' });
    expect(applyServicePageToHtml(html, config).match(/https:\/\/chat\.example\.com/g)).toHaveLength(2);
  });

  it('fails loudly when index.html has no policy to extend', () => {
    expect(() => applyServicePageToHtml('<head></head>', enabled({ VITE_SERVICE_API: 'https://service.example.com' }))).toThrow(/service page/);
  });
});

describe('isQuoteUrl', () => {
  const api = 'https://service.example.com';

  it('accepts quote pages on the service origin', () => {
    expect(isQuoteUrl('https://service.example.com/q/abc123', api)).toBe(true);
    expect(isQuoteUrl('https://service.example.com/q/abc123?step=pay#top', api)).toBe(true);
    expect(isQuoteUrl('https://example.com/service/q/abc', 'https://example.com/service')).toBe(true);
  });

  it.each([
    'https://evil.example/q/abc123',
    'https://service.example.com.evil.example/q/abc',
    'https://service.example.com:8443/q/abc',
    'http://service.example.com/q/abc',
    'https://user@service.example.com/q/abc',
    'https://service.example.com/admin',
    'https://service.example.com/q/',
    'https://service.example.com/quote/abc',
    'javascript:alert(1)',
    '/q/abc',
    '',
  ])('refuses %s', url => {
    expect(isQuoteUrl(url, api)).toBe(false);
  });

  it('refuses everything without a service API, and non-strings', () => {
    expect(isQuoteUrl('https://service.example.com/q/abc', null)).toBe(false);
    expect(isQuoteUrl(42, api)).toBe(false);
    expect(isQuoteUrl({ href: 'https://service.example.com/q/abc' }, api)).toBe(false);
    expect(isQuoteUrl('https://example.com/q/abc', 'https://example.com/service')).toBe(false);
  });
});

describe('parseServiceOffer', () => {
  it('reads the contract example', () => {
    expect(parseServiceOffer(CONTRACT_EXAMPLE)).toEqual({
      ordersOpen: true,
      currency: 'USD',
      offers: [
        { id: 'basic-build', name: 'MCP server from your API', fromPrice: 49900, deliveryDays: 5 },
        { id: 'audit-fix', name: 'Audit and fix', fromPrice: 75000, deliveryDays: 5 },
      ],
      maintenanceMonthlyPrice: 3900,
      paymentMethod: 'invoice',
      updatedAt: '2026-11-18T00:00:00Z',
    });
  });

  it('ignores unknown fields, drops malformed offers and accepts no maintenance', () => {
    const offer = parseServiceOffer({
      ...CONTRACT_EXAMPLE,
      extra: 'ignored',
      maintenance: null,
      offers: [
        { id: 'basic-build', name: 'Build', fromPrice: 49900, tier: 'ignored' },
        { id: 'bad-price', name: 'Bad', fromPrice: 12.5 },
        { id: '', name: 'No id', fromPrice: 1 },
        'not an object',
      ],
    });
    expect(offer?.offers).toEqual([{ id: 'basic-build', name: 'Build', fromPrice: 49900, deliveryDays: null }]);
    expect(offer?.maintenanceMonthlyPrice).toBeNull();
  });

  it.each([
    ['absent', undefined, 'invoice'],
    ['"invoice"', 'invoice', 'invoice'],
    ['"polar"', 'polar', 'polar'],
    ['unknown', 'stripe', 'invoice'],
    ['not a string', 1, 'invoice'],
  ])('reads an optional paymentMethod (%s)', (_label, paymentMethod, expected) => {
    expect(parseServiceOffer({ ...CONTRACT_EXAMPLE, paymentMethod })?.paymentMethod).toBe(expected);
  });

  it.each([
    ['not an object', 'offer'],
    ['no ordersOpen', { ...CONTRACT_EXAMPLE, ordersOpen: undefined }],
    ['a string ordersOpen', { ...CONTRACT_EXAMPLE, ordersOpen: 'yes' }],
    ['no offers', { ...CONTRACT_EXAMPLE, offers: undefined }],
    ['an unknown currency', { ...CONTRACT_EXAMPLE, currency: 'XYZ1' }],
    ['a malformed maintenance', { ...CONTRACT_EXAMPLE, maintenance: { monthlyPrice: '39' } }],
  ])('rejects %s', (_label, json) => {
    expect(parseServiceOffer(json)).toBeNull();
  });
});

describe('formatPrice', () => {
  it('formats minor units in the currency', () => {
    expect(formatPrice(49900, 'USD')).toBe('$499');
    expect(formatPrice(49950, 'USD')).toBe('$499.50');
    expect(formatPrice(3900, 'EUR')).toBe('€39');
    expect(formatPrice(5000, 'JPY')).toBe('¥5,000');
  });
});

describe('fetchServiceOffer', () => {
  const api = 'https://service.example.com';
  const respond = (body: unknown, init: ResponseInit = {}) => vi.fn<typeof fetch>(async () => new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    { status: 200, headers: { 'content-type': 'application/json' }, ...init },
  ));

  it('reads the public offer without cookies', async () => {
    const fetchImpl = respond(CONTRACT_EXAMPLE);
    const offer = await fetchServiceOffer(api, { fetchImpl });
    expect(offer?.offers.map(item => item.id)).toEqual(['basic-build', 'audit-fix']);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(offerUrl(api));
    expect(url).toBe('https://service.example.com/public/offer');
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit' });
  });

  it('requests nothing when the service API is unset', async () => {
    const fetchImpl = respond(CONTRACT_EXAMPLE);
    await expect(fetchServiceOffer(null, { fetchImpl })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['a network error', vi.fn<typeof fetch>(async () => { throw new TypeError('Failed to fetch'); })],
    ['a 500', respond({ error: 'down' }, { status: 500 })],
    ['a 404', respond('not found', { status: 404 })],
    ['a body that is not JSON', respond('<html>')],
    ['a body outside the contract', respond({ prices: [] })],
  ])('is null on %s', async (_label, fetchImpl) => {
    await expect(fetchServiceOffer(api, { fetchImpl })).resolves.toBeNull();
  });

  it('gives up after its timeout', async () => {
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    await expect(fetchServiceOffer(api, { fetchImpl, timeoutMs: 5 })).resolves.toBeNull();
  });
});
