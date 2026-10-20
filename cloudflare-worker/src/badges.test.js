import { describe, expect, it } from 'vitest';
import worker from './index.js';
import {
  KNOWN_BADGE_CACHE_CONTROL,
  UNKNOWN_BADGE_CACHE_CONTROL,
  handleBadgeRequest,
} from './badges.js';

const env = {
  FIREBASE_PROJECT_ID: 'test-project',
  USER_STATE: {
    idFromName: () => { throw new Error('badge requests must not reach the Durable Object'); },
  },
};

const get = (path, init) => worker.fetch(new Request(`https://mcptest.io${path}`, init), env, {});

describe('worker catalog badge route', () => {
  it('serves the result badge for a known catalog id without authentication', async () => {
    const response = await get('/badge/server/context7.svg');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe(KNOWN_BADGE_CACHE_CONTROL);
    expect(response.headers.get('X-Badge-Result')).toBe('ready');
    const body = await response.text();
    expect(body).toContain('<title>mcptest.io: ready</title>');
  });

  it('serves the authorization-required badge for an OAuth catalog server', async () => {
    const response = await get('/badge/server/github.svg');
    expect(response.headers.get('X-Badge-Result')).toBe('authorization-required');
    expect(await response.text()).toContain('auth required');
  });

  it.each([
    '/badge/server/not-a-catalog-server.svg',
    '/badge/server/context7',
    '/badge/server/a/b.svg',
    '/badge/server/%E0%A4%A.svg',
  ])('returns the neutral badge with a 200 for %s', async (path) => {
    const response = await get(path);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe(UNKNOWN_BADGE_CACHE_CONTROL);
    expect(await response.text()).toContain('<title>tested on: mcptest.io</title>');
  });

  it('answers HEAD without a body and rejects other methods', async () => {
    const head = await get('/badge/server/context7.svg', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const post = await get('/badge/server/context7.svg', { method: 'POST' });
    expect(post.status).toBe(405);
  });

  it('never fetches the MCP server and leaves other routes to the state API', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('badge requests must not fetch'); };
    try {
      await get('/badge/server/context7.svg');
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(handleBadgeRequest(new Request('https://mcptest.io/api/state'))).toBeUndefined();
    const stateResponse = await get('/api/state');
    expect(stateResponse.status).toBe(401);
  });
});
