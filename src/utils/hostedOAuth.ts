const HOSTED_STORE_PREFIX = 'mcp_hosted_oauth_v1:';
const HOSTED_START_PATH = '/oauth/hosted/start';
const HOSTED_AUTHORIZE_PATH = '/oauth/hosted/authorize';
const HOSTED_EXCHANGE_PATH = '/oauth/hosted/exchange';

type HostedOAuthStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type HostedOAuthProviderId = 'slack' | 'github';

export interface HostedOAuthProviderClassification {
  provider: HostedOAuthProviderId;
  providerName: string;
}

export interface HostedOAuthAuthorization {
  grant: string;
  issuer: string;
}

const normalizedResource = (serverUrl: string): string => {
  const url = new URL(serverUrl);
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return `${url.origin}${url.pathname}`;
};

const storageKey = (serverUrl: string): string => (
  `${HOSTED_STORE_PREFIX}${encodeURIComponent(normalizedResource(serverUrl))}`
);

export const classifyHostedOAuthProvider = (
  serverUrl: string,
  issuer?: string
): HostedOAuthProviderClassification | undefined => {
  try {
    const target = new URL(serverUrl);
    target.pathname = target.pathname.replace(/\/+$/, '') || '/';
    if (
      target.protocol !== 'https:' || target.username || target.password || target.search || target.hash
    ) return undefined;
    const normalized = `${target.origin}${target.pathname}`;
    if (normalized === 'https://mcp.slack.com/mcp' && issuer === 'https://mcp.slack.com') {
      return { provider: 'slack', providerName: 'Slack' };
    }
    if (
      normalized === 'https://api.githubcopilot.com/mcp'
      && issuer === 'https://github.com/login/oauth'
    ) return { provider: 'github', providerName: 'GitHub' };
  } catch {
    // An invalid or attacker-controlled URL is never eligible.
  }
  return undefined;
};

export const loadHostedOAuthAuthorization = (
  serverUrl: string,
  storage: HostedOAuthStorage = sessionStorage
): HostedOAuthAuthorization | undefined => {
  try {
    const value = JSON.parse(storage.getItem(storageKey(serverUrl)) || 'null') as unknown;
    if (!value || typeof value !== 'object') return undefined;
    const authorization = value as Record<string, unknown>;
    return typeof authorization.grant === 'string' && typeof authorization.issuer === 'string'
      ? { grant: authorization.grant, issuer: authorization.issuer }
      : undefined;
  } catch {
    return undefined;
  }
};

export const clearHostedOAuthAuthorization = (
  serverUrl: string,
  storage: HostedOAuthStorage = sessionStorage
): void => storage.removeItem(storageKey(serverUrl));

const endpoint = (proxyUrl: string, path: string): URL => {
  const url = new URL(proxyUrl);
  url.pathname = path;
  url.search = '';
  url.hash = '';
  return url;
};

const responseError = async (response: Response): Promise<Error> => {
  try {
    const body = await response.json() as { message?: unknown };
    if (typeof body.message === 'string') return new Error(body.message);
  } catch {
    // Use the status-only error below for malformed responses.
  }
  return new Error(`Hosted OAuth request failed with HTTP ${response.status}.`);
};

export const beginHostedOAuthFlow = async ({
  serverUrl,
  issuer,
  resourceMetadataUrl,
  scope,
  proxyUrl,
  firebaseToken,
  redirect = (url) => window.location.assign(url.toString()),
}: {
  serverUrl: string;
  issuer: string;
  resourceMetadataUrl?: string;
  scope?: string;
  proxyUrl: string;
  firebaseToken: string;
  redirect?: (url: URL) => void;
}): Promise<void> => {
  if (!classifyHostedOAuthProvider(serverUrl, issuer)) {
    throw new Error('This target and issuer are not eligible for operator-hosted OAuth.');
  }
  const response = await fetch(endpoint(proxyUrl, HOSTED_START_PATH), {
    method: 'POST',
    headers: { Authorization: `Bearer ${firebaseToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: serverUrl, issuer, resourceMetadataUrl, scope }),
    credentials: 'omit',
  });
  if (!response.ok) throw await responseError(response);
  const body = await response.json() as { transaction?: unknown };
  if (typeof body.transaction !== 'string') throw new Error('Hosted OAuth start returned an invalid result.');
  const authorizationUrl = endpoint(proxyUrl, HOSTED_AUTHORIZE_PATH);
  authorizationUrl.searchParams.set('transaction', body.transaction);
  redirect(authorizationUrl);
};

export const completeHostedOAuthFlow = async ({
  result,
  proxyUrl,
  firebaseToken,
  storage = sessionStorage,
}: {
  result: string;
  proxyUrl: string;
  firebaseToken: string;
  storage?: HostedOAuthStorage;
}): Promise<{ serverUrl: string; issuer: string }> => {
  const response = await fetch(endpoint(proxyUrl, HOSTED_EXCHANGE_PATH), {
    method: 'POST',
    headers: { Authorization: `Bearer ${firebaseToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ result }),
    credentials: 'omit',
  });
  if (!response.ok) throw await responseError(response);
  const body = await response.json() as Record<string, unknown>;
  if (
    typeof body.grant !== 'string'
    || typeof body.serverUrl !== 'string'
    || typeof body.issuer !== 'string'
    || !classifyHostedOAuthProvider(body.serverUrl, body.issuer)
  ) throw new Error('Hosted OAuth exchange returned an invalid result.');
  storage.setItem(storageKey(body.serverUrl), JSON.stringify({
    grant: body.grant,
    issuer: body.issuer,
  }));
  return { serverUrl: body.serverUrl, issuer: body.issuer };
};
