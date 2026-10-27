// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformWithEsbuild } from 'vite';
import { describe, expect, it } from 'vitest';

type Format = 'both' | 'json' | 'sse';
type Request = { method: string; headers: { accept?: string }; body?: unknown };
type Served = { format: Format; responseMode: string | undefined; accept: string | undefined };

const article = readFileSync(resolve('src/content/articles/mcp-406-not-acceptable-415-and-405.md'), 'utf8');
const serverFixes = article.slice(article.indexOf('### Server-side fixes'), article.indexOf('## 415 Unsupported'));

// Runs the Express adapter from the article against stand-ins for the SDK, recording which pinned handler served each request.
async function loadExpressAdapter(): Promise<(request: Request) => Served> {
  const source = serverFixes.match(/```typescript\n([\s\S]*?)```/)?.[1];
  if (!source) throw new Error('406 article no longer contains the Express adapter');
  const { code: js } = await transformWithEsbuild(source, 'adapter.ts', { target: 'es2022' });
  let route: ((req: Request, res: unknown) => void) | undefined;
  let served: Served | undefined;
  const createMcpHandler = (_factory: unknown, options?: { responseMode?: string }) => options?.responseMode;
  const toNodeHandler = (responseMode: string | undefined) => (req: Request) => {
    served = { format: responseMode === undefined ? 'both' : (responseMode as Format), responseMode, accept: req.headers.accept };
  };
  const app = { all: (_path: string, handler: typeof route) => (route = handler) };
  new Function('app', 'createMcpHandler', 'toNodeHandler', 'buildServer', js)(app, createMcpHandler, toNodeHandler, () => ({}));
  return (request) => {
    served = undefined;
    route?.(request, {});
    if (!served) throw new Error('adapter did not dispatch the request');
    return served;
  };
}

describe('406 article Accept adapter', () => {
  it('pins the response to the only format a one-sided client accepts', async () => {
    const serve = await loadExpressAdapter();
    expect(serve({ method: 'POST', headers: { accept: 'application/json' } }).responseMode).toBe('json');
    expect(serve({ method: 'POST', headers: { accept: 'text/event-stream' } }).responseMode).toBe('sse');
    expect(serve({ method: 'POST', headers: { accept: '*/*' } }).responseMode).toBe('json');
    expect(serve({ method: 'POST', headers: {} }).responseMode).toBe('json');
  });

  it('widens the header only for a pinned handler', async () => {
    const serve = await loadExpressAdapter();
    expect(serve({ method: 'POST', headers: { accept: 'application/json' } }).accept).toBe(
      'application/json, text/event-stream',
    );
    const full = 'text/event-stream;q=0.9, application/json';
    expect(serve({ method: 'POST', headers: { accept: full } })).toEqual({
      format: 'both',
      responseMode: undefined,
      accept: full,
    });
    expect(serve({ method: 'GET', headers: { accept: 'text/event-stream' } })).toEqual({
      format: 'both',
      responseMode: undefined,
      accept: 'text/event-stream',
    });
  });

  it('wraps only a JSON-pinned Python app and leaves SSE-only headers for the SDK to reject', () => {
    const python = serverFixes.match(/```python\n([\s\S]*?)```/)?.[1] ?? '';
    expect(python).toMatch(/^app = \w+\(mcp\.streamable_http_app\(json_response=True\)\)$/m);
    expect(python).toContain('if b"text/event-stream" not in accept:');
  });
});
