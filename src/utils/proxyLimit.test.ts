import { describe, expect, it, vi } from 'vitest';
import {
  PROXY_LIMIT_SIGNAL_HEADER,
  PROXY_LIMIT_TRAILER_PREFIX,
  ProxyCallerLimitError,
  decodeProxyLimitSignal,
  proxyCallerLimitMessage,
  readProxyCallerLimit,
} from './proxyLimit';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const token = 'signal-token';
const trailer = (limit: string) =>
  `${PROXY_LIMIT_TRAILER_PREFIX}${token}\n${JSON.stringify({ error: 'rate_limited', tier: 'anonymous', limit })}`;

const controlledResponse = (headers: Record<string, string> = { [PROXY_LIMIT_SIGNAL_HEADER]: token }) => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  }), { headers: { 'Content-Type': 'text/event-stream', ...headers } });
  return {
    response,
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  };
};

describe('decodeProxyLimitSignal', () => {
  it('delivers SSE events incrementally and turns a lifetime trailer into a caller limit', async () => {
    const upstream = controlledResponse();
    const onLimit = vi.fn();
    const reader = decodeProxyLimitSignal(upstream.response, onLimit).body!.getReader();

    upstream.push('event: message\ndata: {}\n\n');
    await expect(reader.read().then(({ value }) => decoder.decode(value))).resolves.toBe('event: message\ndata: {}\n\n');

    upstream.push(trailer('stream_duration'));
    upstream.close();
    const failure = await reader.read().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProxyCallerLimitError);
    expect((failure as ProxyCallerLimitError).limit).toEqual({ tier: 'anonymous', kind: 'stream_duration' });
    expect((failure as Error).message).toMatch(/time-limited.*Sign in with Google.*not an MCP server error/);
    expect(onLimit).toHaveBeenCalledWith({ tier: 'anonymous', kind: 'stream_duration' });
  });

  it('recognizes a byte-limit trailer split across chunks and strips it from the body', async () => {
    const upstream = controlledResponse();
    const decoded = decodeProxyLimitSignal(upstream.response);
    const full = `{"partial":${trailer('response_bytes')}`;
    for (const piece of [full.slice(0, 12), full.slice(12, 20), full.slice(20)]) upstream.push(piece);
    upstream.close();

    const failure = await decoded.text().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProxyCallerLimitError);
    expect((failure as ProxyCallerLimitError).limit.kind).toBe('response_bytes');
  });

  it('releases held-back bytes that only resembled the start of the trailer', async () => {
    const upstream = controlledResponse();
    const decoded = decodeProxyLimitSignal(upstream.response);
    upstream.push('a\u0000mcptest');
    upstream.push('-other');
    upstream.close();

    await expect(decoded.text()).resolves.toBe('a\u0000mcptest-other');
  });

  it('leaves responses without the signal header untouched', () => {
    const response = new Response('ok');
    expect(decodeProxyLimitSignal(response)).toBe(response);
  });

  it('reads the limit kind from a proxy-owned 429', () => {
    const limit = readProxyCallerLimit(new Response(null, {
      status: 429,
      headers: { 'X-MCP-Proxy-Limit': 'anonymous', 'X-MCP-Proxy-Limit-Kind': 'request_bytes' },
    }));
    expect(limit).toEqual({ tier: 'anonymous', kind: 'request_bytes' });
    expect(proxyCallerLimitMessage(limit!)).toMatch(/request bodies are size-limited.*Sign in with Google/);
  });
});
