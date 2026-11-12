import { describe, expect, it } from 'vitest';
import { getCatalogBadgeVariant } from '../src/utils/badges';
import validator from './validate-catalog.js';

const { probeStreamableEndpoint, validateSeed } = validator;

const seed = (id) => ({
  id,
  url: 'https://example.com/mcp',
  transport: 'streamable-http',
  authType: 'none',
  listingSource: { kind: 'community' },
});

const CLOUDFLARE_CHALLENGE = () => new Response(
  '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script></body></html>',
  { status: 403, headers: { 'Content-Type': 'text/html; charset=UTF-8', 'cf-mitigated': 'challenge' } }
);

describe('catalog validation response classes', () => {
  it('records bot protection instead of treating the 403 as an authentication challenge', async () => {
    const result = await validateSeed(seed('cf-blocked'), { fetchImpl: async () => CLOUDFLARE_CHALLENGE(), timeoutMs: 1_000 });

    expect(result).toMatchObject({
      status: 'unknown',
      transport: 'unknown',
      authType: 'none',
      responseClass: 'bot-protection',
      errorCode: 'bot_protection',
    });
    expect(result.message).toContain('Bot protection is blocking MCP clients on /mcp (Cloudflare). Observed HTTP 403');
    expect(result.message).toContain('cf-mitigated: challenge');
    expect(getCatalogBadgeVariant(result)).toBe('unknown');
  });

  it('keeps an x402 server online with payment-required evidence and badge, not broken', async () => {
    const fetchImpl = async () => new Response('{"error":"Payment required"}', {
      status: 402,
      headers: { 'Content-Type': 'application/json', 'PAYMENT-REQUIRED': 'eyJ4NDAyVmVyc2lvbiI6Mn0=' },
    });
    const result = await validateSeed(seed('paid'), { fetchImpl, timeoutMs: 1_000 });

    expect(result).toMatchObject({
      status: 'online',
      responseClass: 'payment-required',
      validatedUrl: 'https://example.com/mcp',
    });
    expect(result.errorCode).toBeUndefined();
    expect(result.message).toMatch(/^Payment required on \/mcp \(x402\)/);
    expect(getCatalogBadgeVariant(result)).toBe('payment-required');
  });

  it('records a plain rate limit as rate limited', async () => {
    const fetchImpl = async () => new Response('{"error":"slow down"}', {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
    });
    const result = await validateSeed(seed('limited'), { fetchImpl, timeoutMs: 1_000 });

    expect(result).toMatchObject({ status: 'unknown', responseClass: 'rate-limited', errorCode: 'rate_limited' });
  });

  it('keeps a 403 with WWW-Authenticate an authentication challenge', async () => {
    const fetchImpl = async () => new Response('<html>Forbidden</html>', {
      status: 403,
      headers: { 'Content-Type': 'text/html', 'WWW-Authenticate': 'Bearer realm="example"' },
    });
    const result = await probeStreamableEndpoint(
      { url: 'https://example.com/mcp', transport: 'streamable-http' },
      { fetchImpl, timeoutMs: 1_000 }
    );

    expect(result).toMatchObject({ authChallenge: true, reachable: true, statusCode: 403 });
    expect(result.responseClass).toBeUndefined();
  });

  it('leaves a real 404 as an unexpected response', async () => {
    const result = await validateSeed(seed('missing'), {
      fetchImpl: async () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } }),
      timeoutMs: 1_000,
    });

    expect(result).toMatchObject({ status: 'unknown', errorCode: 'unexpected_response' });
    expect(result.responseClass).toBeUndefined();
  });
});
