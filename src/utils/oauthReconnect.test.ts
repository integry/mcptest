import { beforeEach, describe, expect, it } from 'vitest';
import {
  OAUTH_RECONNECT_REQUEST_KEY,
  consumeOAuthReconnectRequest,
  storeOAuthReconnectRequest,
} from './oauthReconnect';

describe('OAuth reconnect request handoff', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('stores the exact authorized endpoint without storing a token', () => {
    const serverUrl = 'https://mcp.example/mcp?tenant=one';

    expect(storeOAuthReconnectRequest(serverUrl, sessionStorage)).toBe(true);
    expect(JSON.parse(sessionStorage.getItem(OAUTH_RECONNECT_REQUEST_KEY) || '{}')).toEqual({
      serverUrl,
    });
    expect(sessionStorage.getItem(OAUTH_RECONNECT_REQUEST_KEY)).not.toContain('accessToken');
  });

  it('consumes a reconnect request once only', () => {
    storeOAuthReconnectRequest('https://mcp.example/mcp', sessionStorage);

    expect(consumeOAuthReconnectRequest(sessionStorage)).toBe('https://mcp.example/mcp');
    expect(sessionStorage.getItem(OAUTH_RECONNECT_REQUEST_KEY)).toBeNull();
    expect(consumeOAuthReconnectRequest(sessionStorage)).toBeUndefined();
  });

  it('removes malformed requests instead of replaying them', () => {
    sessionStorage.setItem(OAUTH_RECONNECT_REQUEST_KEY, '{not-json');

    expect(consumeOAuthReconnectRequest(sessionStorage)).toBeUndefined();
    expect(sessionStorage.getItem(OAUTH_RECONNECT_REQUEST_KEY)).toBeNull();
  });
});
