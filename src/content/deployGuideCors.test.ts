// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformWithEsbuild } from 'vite';
import { describe, expect, it } from 'vitest';

type CorsWrapper = (request: Request, response: Response) => Response;

const article = readFileSync(resolve('src/content/articles/deploy-remote-mcp-server.md'), 'utf8');
const workersSection = article.slice(article.indexOf('### With the Agents SDK'), article.indexOf('### With the SDK alone'));

async function loadWorkersCorsWrapper(): Promise<{ wrapper: CorsWrapper; allowedOrigins: string[]; fixedOrigin: string }> {
  const allowlist = workersSection.match(/^const ALLOWED_ORIGINS = .*;$/m)?.[0];
  const wrapperSource = workersSection.match(/^function withRequestOrigin\([\s\S]*?^}$/m)?.[0];
  const fixedOrigin = workersSection.match(/^ {4}origin: '([^']+)',$/m)?.[1];
  const hostnames = workersSection.match(/allowedOriginHostnames: \[([^\]]+)\]/)?.[1];
  if (!allowlist || !wrapperSource || !fixedOrigin || !hostnames) {
    throw new Error('Cloudflare Agents example no longer contains the CORS wrapper');
  }
  const { code: js } = await transformWithEsbuild(`${allowlist}\n${wrapperSource}`, 'cors-wrapper.ts', {
    target: 'es2022',
  });
  const wrapper = new Function(`${js}\nreturn withRequestOrigin;`)() as CorsWrapper;
  const allowedOrigins = [...hostnames.matchAll(/'([^']+)'/g)].map(([, hostname]) => `https://${hostname}`);
  return { wrapper, allowedOrigins, fixedOrigin };
}

// Stand-in for createMcpHandler, which sends corsOptions.origin on every response.
function handlerResponse(fixedOrigin: string, status: number): Response {
  return new Response(status === 204 ? null : '{}', {
    status,
    headers: { 'Access-Control-Allow-Origin': fixedOrigin, 'Access-Control-Expose-Headers': 'Mcp-Session-Id' },
  });
}

describe('deploy guide Cloudflare Agents CORS example', () => {
  it('lets every origin in allowedOriginHostnames pass the browser CORS check', async () => {
    const { wrapper, allowedOrigins, fixedOrigin } = await loadWorkersCorsWrapper();
    expect(allowedOrigins).toEqual(['https://mcptest.io', 'https://app.example.com']);

    for (const origin of allowedOrigins) {
      for (const status of [204, 200, 429]) {
        const request = new Request('https://mcp.example.com/mcp', { method: 'POST', headers: { Origin: origin } });
        const response = wrapper(request, handlerResponse(fixedOrigin, status));
        expect(response.status).toBe(status);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
        expect(response.headers.get('Access-Control-Expose-Headers')).toBe('Mcp-Session-Id');
        expect(response.headers.get('Vary')).toContain('Origin');
      }
    }
  });

  it('does not echo an origin that is not on the allowlist', async () => {
    const { wrapper, fixedOrigin } = await loadWorkersCorsWrapper();
    const request = new Request('https://mcp.example.com/mcp', { headers: { Origin: 'https://evil.example' } });
    const response = wrapper(request, handlerResponse(fixedOrigin, 403));
    expect(response.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.example');
  });
});
