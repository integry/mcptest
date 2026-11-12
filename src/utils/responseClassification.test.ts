import { describe, expect, it } from 'vitest';
import {
  classifyFetchResponse,
  classifyHttpResponse,
  describeResponseClassification,
  describeResponseEvidence,
  isResponseClassification,
  pickClassificationHeaders,
  readClassificationBody,
  RESPONSE_CLASS_CONTENT,
  RESPONSE_CLASSIFICATION_HEADERS,
  responseLocation,
  type ResponseClassificationInput,
} from './responseClassification';

/**
 * Fixture responses, shaped like the real ones: the vendor headers and the
 * start of each vendor page as served (trimmed to the parts that matter).
 */
const CLOUDFLARE_MANAGED_CHALLENGE = '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="refresh" content="390"></head><body><script>(function(){window._cf_chl_opt={cvId: \'3\'};var a=document.createElement(\'script\');a.src=\'/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1?ray=8f\';document.getElementsByTagName(\'head\')[0].appendChild(a);}());</script></body></html>';
const CLOUDFLARE_1020 = '<!DOCTYPE html><html><head><title>Access denied | example.com used Cloudflare to restrict access</title></head><body><div id="cf-error-details"><h1>Access denied</h1><span class="cf-error-code">Error 1020</span><p>The site owner may have set restrictions that prevent you from accessing the site.</p><p>Performance &amp; security by Cloudflare</p></div></body></html>';
const CLOUDFLARE_1015 = '<!DOCTYPE html><html><head><title>Access denied | example.com used Cloudflare to restrict access</title></head><body><h1>Error 1015</h1><h2>You are being rate limited</h2><p>The owner of this website has banned you temporarily from accessing this website.</p><p>Cloudflare Ray ID: 8f</p></body></html>';
const VERCEL_CHECKPOINT = '<!DOCTYPE html><html lang="en"><head><title>Vercel Security Checkpoint</title></head><body><p>We\'re verifying your browser</p></body></html>';
const GENERIC_BLOCK_PAGE = '<html><head><title>403 Forbidden</title></head><body><h1>Request blocked</h1></body></html>';

const classify = (input: ResponseClassificationInput) => classifyHttpResponse(input);

describe('classifyHttpResponse: bot protection', () => {
  it('confirms a Cloudflare challenge from cf-mitigated alone, whatever the body', () => {
    const result = classify({
      status: 403,
      headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html; charset=UTF-8', server: 'cloudflare' },
    });
    expect(result).toEqual({
      kind: 'bot-protection',
      confidence: 'confirmed',
      signature: 'cloudflare.cf-mitigated',
      vendor: 'cloudflare',
      status: 403,
      headers: { 'content-type': 'text/html; charset=UTF-8', 'cf-mitigated': 'challenge' },
    });
  });

  it('confirms a Cloudflare challenge page served without the header (header stripped by a proxy)', () => {
    expect(classify({ status: 403, headers: { 'content-type': 'text/html' }, body: CLOUDFLARE_MANAGED_CHALLENGE }))
      .toMatchObject({ kind: 'bot-protection', confidence: 'confirmed', signature: 'cloudflare.challenge-platform', vendor: 'cloudflare' });
    // Cloudflare also challenges with 503 and 429 (Under Attack mode, rate-limit rules with a challenge action).
    expect(classify({ status: 503, headers: { 'content-type': 'text/html' }, body: CLOUDFLARE_MANAGED_CHALLENGE }))
      .toMatchObject({ kind: 'bot-protection', signature: 'cloudflare.challenge-platform' });
    expect(classify({ status: 429, headers: { 'content-type': 'text/html' }, body: CLOUDFLARE_MANAGED_CHALLENGE }))
      .toMatchObject({ kind: 'bot-protection', signature: 'cloudflare.challenge-platform' });
  });

  it('confirms the Cloudflare 1020 block page', () => {
    expect(classify({ status: 403, headers: { 'content-type': 'text/html' }, body: CLOUDFLARE_1020 }))
      .toMatchObject({ kind: 'bot-protection', signature: 'cloudflare.error-1020', bodyMarker: 'Cloudflare error 1020 (Access denied)' });
    // The plain-text variant Cloudflare serves to non-browser clients.
    expect(classify({ status: 403, headers: { 'content-type': 'text/plain' }, body: 'error code: 1020 cloudflare' }))
      .toMatchObject({ signature: 'cloudflare.error-1020' });
  });

  it('confirms the Vercel Security Checkpoint and x-vercel-mitigated', () => {
    expect(classify({ status: 429, headers: { 'content-type': 'text/html' }, body: VERCEL_CHECKPOINT }))
      .toMatchObject({ kind: 'bot-protection', confidence: 'confirmed', signature: 'vercel.security-checkpoint', vendor: 'vercel' });
    expect(classify({ status: 403, headers: new Headers({ 'x-vercel-mitigated': 'challenge' }) }))
      .toMatchObject({ kind: 'bot-protection', signature: 'vercel.x-vercel-mitigated', headers: { 'x-vercel-mitigated': 'challenge' } });
    expect(classify({ status: 403, headers: { 'X-Vercel-Mitigated': 'deny' } }))
      .toMatchObject({ kind: 'bot-protection', signature: 'vercel.x-vercel-mitigated' });
  });

  it('only suspects bot protection for an unbranded HTML 403 where JSON or SSE was expected', () => {
    expect(classify({ status: 403, headers: { 'content-type': 'text/html' }, body: GENERIC_BLOCK_PAGE }))
      .toMatchObject({ kind: 'bot-protection', confidence: 'suspected', signature: 'generic.html-403' });
    expect(classify({ status: 403, body: '<!doctype html><html><body>blocked</body></html>' }))
      .toMatchObject({ confidence: 'suspected' });
  });
});

describe('classifyHttpResponse: rate limiting', () => {
  it('classifies any 429 as rate limited, with or without Retry-After', () => {
    expect(classify({ status: 429, headers: { 'retry-after': '30' } }))
      .toMatchObject({ kind: 'rate-limited', confidence: 'confirmed', signature: 'http.429', headers: { 'retry-after': '30' } });
    expect(classify({ status: 429 })).toMatchObject({ kind: 'rate-limited', signature: 'http.429' });
  });

  it('names the Cloudflare 1015 rate-limit page as a rate limit, not a challenge', () => {
    expect(classify({ status: 429, headers: { 'content-type': 'text/html' }, body: CLOUDFLARE_1015 }))
      .toMatchObject({ kind: 'rate-limited', signature: 'cloudflare.error-1015', vendor: 'cloudflare' });
  });

  it('keeps a JSON 429 from the MCP server itself a plain rate limit', () => {
    const result = classify({
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '5' },
      // A JSON error body that happens to mention a vendor marker is still JSON.
      body: '{"jsonrpc":"2.0","error":{"code":-32000,"message":"Rate limited: Vercel Security Checkpoint quota"},"id":null}',
    });
    expect(result).toMatchObject({ kind: 'rate-limited', signature: 'http.429' });
    expect(result?.vendor).toBeUndefined();
  });
});

describe('classifyHttpResponse: payment required', () => {
  it('classifies x402 v2 from the PAYMENT-REQUIRED header', () => {
    expect(classify({ status: 402, headers: { 'PAYMENT-REQUIRED': 'eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0cyI6W119' } }))
      .toMatchObject({
        kind: 'payment-required',
        confidence: 'confirmed',
        signature: 'x402.payment-required',
        vendor: 'x402',
        headers: { 'payment-required': 'eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0cyI6W119' },
      });
  });

  it('classifies x402 v1 from its JSON body', () => {
    expect(classify({
      status: 402,
      headers: { 'content-type': 'application/json' },
      body: '{"x402Version":1,"error":"X-PAYMENT header is required","accepts":[{"scheme":"exact","network":"base-sepolia"}]}',
    })).toMatchObject({ signature: 'x402.payment-required', bodyMarker: 'x402Version in the response body' });
  });

  it('classifies any other 402 as payment required', () => {
    expect(classify({ status: 402, headers: { 'content-type': 'text/plain' }, body: 'Payment Required' }))
      .toMatchObject({ kind: 'payment-required', signature: 'http.402' });
  });
});

describe('classifyHttpResponse: look-alikes that must not be classified', () => {
  it('leaves a legitimate 403 with WWW-Authenticate as an authentication challenge', () => {
    expect(classify({
      status: 403,
      headers: { 'www-authenticate': 'Bearer error="insufficient_scope", scope="files:read"', 'content-type': 'text/html' },
      body: GENERIC_BLOCK_PAGE,
    })).toBeUndefined();
    expect(classify({ status: 403, hasWwwAuthenticate: true, contentType: 'text/html', body: GENERIC_BLOCK_PAGE })).toBeUndefined();
  });

  it('leaves every 401 alone, even an HTML one', () => {
    expect(classify({ status: 401, headers: { 'content-type': 'text/html' }, body: VERCEL_CHECKPOINT })).toBeUndefined();
  });

  it('leaves a real 404, including an HTML 404 page, alone', () => {
    expect(classify({ status: 404, headers: { 'content-type': 'text/html' }, body: '<html><body>Not Found</body></html>' })).toBeUndefined();
    expect(classify({ status: 404, headers: { 'content-type': 'application/json' }, body: '{"error":"not_found"}' })).toBeUndefined();
  });

  it('leaves a JSON 403 from the MCP server, a plain 503 page and successful responses alone', () => {
    expect(classify({ status: 403, headers: { 'content-type': 'application/json' }, body: '{"error":"Invalid Origin"}' })).toBeUndefined();
    // Hibernating or cold-starting hosts are deliberately not classified.
    expect(classify({ status: 503, headers: { 'content-type': 'text/html' }, body: '<html><body>Service Unavailable</body></html>' })).toBeUndefined();
    expect(classify({ status: 200, headers: { 'cf-mitigated': 'challenge' } })).toBeUndefined();
  });

  it('does not take Server: cloudflare or cf-ray as evidence', () => {
    expect(classify({ status: 403, headers: { server: 'cloudflare', 'cf-ray': '8f-AMS', 'content-type': 'application/json' } })).toBeUndefined();
  });

  it('needs the vendor name for the Cloudflare error-code pages', () => {
    expect(classify({ status: 403, headers: { 'content-type': 'text/plain' }, body: 'Error 1020 in our billing system' })).toBeUndefined();
  });

  it('ignores x-vercel-mitigated outside 403 and 429', () => {
    expect(classify({ status: 404, headers: { 'x-vercel-mitigated': 'deny' } })).toBeUndefined();
  });
});

describe('evidence and content', () => {
  it('keeps only the documented classification headers, bounded', () => {
    expect(pickClassificationHeaders({
      'Content-Type': 'text/html',
      'Set-Cookie': '__cf_bm=secret',
      Authorization: 'Bearer secret',
      'cf-mitigated': `challenge${' '.repeat(10)}`,
      'payment-required': 'x'.repeat(500),
    })).toEqual({
      'content-type': 'text/html',
      'cf-mitigated': 'challenge',
      'payment-required': 'x'.repeat(128),
    });
    expect(RESPONSE_CLASSIFICATION_HEADERS).not.toContain('set-cookie');
  });

  it('describes the observed evidence and the location instead of a generic failure', () => {
    const result = classify({ status: 403, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' } })!;
    expect(describeResponseEvidence(result)).toBe('HTTP 403, content-type: text/html, cf-mitigated: challenge');
    expect(describeResponseClassification(result, 'https://example.com/.well-known/oauth-protected-resource/mcp'))
      .toBe('Bot protection is blocking MCP clients on /.well-known/oauth-protected-resource/mcp (Cloudflare). Observed HTTP 403, content-type: text/html, cf-mitigated: challenge.');
    const suspected = classify({ status: 403, contentType: 'text/html', body: GENERIC_BLOCK_PAGE })!;
    expect(describeResponseClassification(suspected, 'https://example.com/mcp')).toMatch(/^Possibly: Bot protection is blocking MCP clients on \/mcp\./);
    expect(responseLocation('https://example.com/')).toBe('example.com');
    expect(responseLocation(undefined)).toBe('this endpoint');
  });

  it('has plain-language content with a Learn link for every class', () => {
    for (const content of Object.values(RESPONSE_CLASS_CONTENT)) {
      expect(content.title('/mcp')).toContain('/mcp');
      expect(content.explanation.length).toBeGreaterThan(40);
      expect(content.fix.length).toBeGreaterThan(40);
      expect(content.learnMore.path).toMatch(/^\/learn\//);
    }
  });

  it('recognizes stored classifications', () => {
    expect(isResponseClassification(classify({ status: 429 }))).toBe(true);
    expect(isResponseClassification({ kind: 'offline', confidence: 'confirmed', status: 0, signature: 'x' })).toBe(false);
    expect(isResponseClassification(null)).toBe(false);
  });
});

describe('reading responses', () => {
  it('classifies a fetch Response from a bounded body prefix without consuming it', async () => {
    const response = new Response(`${CLOUDFLARE_MANAGED_CHALLENGE}${'x'.repeat(100_000)}`, {
      status: 403,
      headers: { 'Content-Type': 'text/html' },
    });
    await expect(classifyFetchResponse(response)).resolves.toMatchObject({ signature: 'cloudflare.challenge-platform' });
    expect((await response.text()).startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('reads at most the requested number of bytes', async () => {
    const body = await readClassificationBody(new Response('abcdefghij'), 4);
    expect(body).toBe('abcd');
    await expect(readClassificationBody(new Response(null, { status: 204 }))).resolves.toBeUndefined();
  });

  it('does not read bodies for statuses that cannot be classified', async () => {
    await expect(classifyFetchResponse(new Response('<html>Not found</html>', { status: 404 }))).resolves.toBeUndefined();
    await expect(classifyFetchResponse(new Response('{}', { status: 200 }))).resolves.toBeUndefined();
  });
});
