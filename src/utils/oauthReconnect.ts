export const OAUTH_RECONNECT_REQUEST_KEY = 'oauth_reconnect_request';

type OAuthReconnectStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface OAuthReconnectRequest {
  serverUrl: string;
}

/**
 * Persists the endpoint that should be reconnected after the OAuth redirect.
 * OAuth credentials remain in their endpoint-scoped OAuth storage and are
 * deliberately not included in this handoff.
 */
export const storeOAuthReconnectRequest = (
  serverUrl: string,
  storage: OAuthReconnectStorage = sessionStorage
): boolean => {
  try {
    storage.setItem(
      OAUTH_RECONNECT_REQUEST_KEY,
      JSON.stringify({ serverUrl } satisfies OAuthReconnectRequest)
    );
    return true;
  } catch {
    // Navigation state provides the fallback when session storage is blocked.
    return false;
  }
};

/**
 * Reads and removes the pending request before returning it. Removing first
 * keeps refreshes and back navigation from replaying a successful OAuth flow.
 */
export const consumeOAuthReconnectRequest = (
  storage: OAuthReconnectStorage = sessionStorage
): string | undefined => {
  let serialized: string | null;
  try {
    serialized = storage.getItem(OAUTH_RECONNECT_REQUEST_KEY);
    storage.removeItem(OAUTH_RECONNECT_REQUEST_KEY);
  } catch {
    return undefined;
  }

  if (!serialized) return undefined;

  try {
    const request = JSON.parse(serialized) as Partial<OAuthReconnectRequest>;
    return typeof request.serverUrl === 'string' && request.serverUrl.length > 0
      ? request.serverUrl
      : undefined;
  } catch {
    return undefined;
  }
};
