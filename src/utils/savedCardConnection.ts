export interface SavedCardConnectionOptions {
  serverUrl: string;
  useProxy?: boolean;
  oauthToken?: string | null;
  proxyUrl?: string;
  proxyAuthToken?: string;
}

export interface SavedCardConnectionPlan {
  connectionUrl: string;
  authToken?: string;
  targetHeaders?: HeadersInit;
  usesProxy: boolean;
}

/**
 * Builds the connection inputs for a saved dashboard card. Legacy cards did
 * not persist `useProxy`, so they retain the old proxy-by-default behavior
 * when no target OAuth token is available.
 */
export const getSavedCardConnectionPlan = ({
  serverUrl,
  useProxy,
  oauthToken,
  proxyUrl,
  proxyAuthToken,
}: SavedCardConnectionOptions): SavedCardConnectionPlan => {
  const targetUrl = new URL(serverUrl).toString();
  const usesProxy = Boolean(
    proxyUrl && (useProxy !== undefined ? useProxy : !oauthToken)
  );

  if (!usesProxy) {
    return {
      connectionUrl: targetUrl,
      authToken: oauthToken || undefined,
      usesProxy: false,
    };
  }

  if (!proxyAuthToken) {
    throw new Error('Sign in is required to execute a saved card through the CORS proxy.');
  }

  const connectionUrl = new URL(proxyUrl as string);
  connectionUrl.searchParams.set('target', targetUrl);

  return {
    connectionUrl: connectionUrl.toString(),
    authToken: proxyAuthToken,
    targetHeaders: oauthToken
      ? { Authorization: `Bearer ${oauthToken}` }
      : undefined,
    usesProxy: true,
  };
};
