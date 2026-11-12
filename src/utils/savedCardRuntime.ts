/**
 * Everything a saved dashboard card needs to run: the MCP SDK transports, the
 * OAuth flow and trace, and the App-level helpers that classify their
 * failures. App.tsx loads this module with a dynamic import when a card runs,
 * so none of it is in the bundle a content page downloads.
 */
import {
  TransportConnectionError,
  attemptParallelConnections,
  getObservedAuthenticationChallenge,
  type ObservedAuthenticationChallenge,
} from './transportDetection';
import {
  beginOAuthFlow,
  getHostedOAuthTokenProxyUrl,
} from './oauthFlow';
import { resumePendingAuthenticatedMcpRetry, type PendingAuthenticatedMcpRetry } from './oauthTrace';

export {
  attemptParallelConnections,
  getObservedAuthenticationChallenge,
  TransportConnectionError,
} from './transportDetection';
export {
  getSavedCardConnectionPlan,
  getSavedResourceUri,
  SavedResourceCardMigrationError,
} from './savedCardConnection';
export {
  beginOAuthFlow,
  clearOAuthTokens,
  getHostedOAuthTokenProxyUrl,
  getOAuthPrerequisite,
  isOAuthClientConfigurationRequired,
  loadOAuthAuthorization,
  type OAuthPrerequisite,
} from './oauthFlow';
export {
  recordOAuthAuthenticationChallenge,
  resumePendingAuthenticatedMcpRetry,
  type PendingAuthenticatedMcpRetry,
} from './oauthTrace';
export type { ObservedAuthenticationChallenge } from './transportDetection';

const getAuthenticationHttpStatus = (
  error: unknown,
  seen = new Set<object>()
): 401 | 403 | undefined => {
  if (!error || typeof error !== 'object' || seen.has(error)) return undefined;
  seen.add(error);

  const value = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
    cause?: unknown;
  };
  const status = [
    value.status,
    value.statusCode,
    value.response?.status,
  ].find(candidate => candidate === 401 || candidate === 403);
  if (status === 401 || status === 403) return status;

  if (error instanceof TransportConnectionError) {
    for (const nestedError of error.errors) {
      const nestedStatus = getAuthenticationHttpStatus(nestedError, seen);
      if (nestedStatus) return nestedStatus;
    }
  }

  const causeStatus = getAuthenticationHttpStatus(value.cause, seen);
  if (causeStatus) return causeStatus;
  return undefined;
};

export const classifySavedCardAuthenticationFailure = (
  error: unknown,
  usesProxy: boolean,
  observedChallenge?: ObservedAuthenticationChallenge
): ObservedAuthenticationChallenge | undefined => {
  const proxiedChallenge = observedChallenge || getObservedAuthenticationChallenge(error);
  if (proxiedChallenge) return proxiedChallenge;

  // A generic proxied 401/403 has ambiguous provenance. Never turn it into a
  // target OAuth prompt unless the proxy transport identified the responder.
  if (usesProxy) return undefined;

  const status = getAuthenticationHttpStatus(error);
  return status ? { status, source: 'target' } : undefined;
};

export const resumeSavedCardAuthenticatedMcpRetry = (
  serverUrl: string,
  oauthToken: string | undefined,
  storage: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage,
  startedAt = Date.now()
): PendingAuthenticatedMcpRetry | undefined => oauthToken
  ? resumePendingAuthenticatedMcpRetry({
      targetUrl: serverUrl,
      storage,
      operation: 'saved-card execution',
      startedAt,
    })
  : undefined;

export type SavedCardOAuthUser = {
  getIdToken: () => Promise<string>;
};

export type SavedCardOAuthChallenge = Pick<
  ObservedAuthenticationChallenge,
  'resourceMetadataUrl' | 'scope' | 'targetUrl'
>;

export const attachSavedCardOAuthChallenge = <T extends object>(
  value: T,
  challenge?: SavedCardOAuthChallenge
): T & SavedCardOAuthChallenge => {
  if (challenge?.targetUrl) {
    Object.defineProperty(value, 'targetUrl', { value: challenge.targetUrl, enumerable: false });
  }
  if (challenge?.resourceMetadataUrl) {
    Object.defineProperty(value, 'resourceMetadataUrl', {
      value: challenge.resourceMetadataUrl,
      enumerable: false,
    });
  }
  if (challenge?.scope) {
    Object.defineProperty(value, 'scope', {
      value: challenge.scope,
      enumerable: false,
    });
  }
  return value;
};

export const beginSavedCardOAuthFlow = async ({
  serverUrl,
  challenge,
  proxyUrl,
  currentUser,
  discoveryProxyApplicable,
  startFlow = beginOAuthFlow,
}: {
  serverUrl: string;
  challenge?: SavedCardOAuthChallenge;
  proxyUrl?: string;
  currentUser?: SavedCardOAuthUser | null;
  discoveryProxyApplicable: boolean;
  startFlow?: typeof beginOAuthFlow;
}) => {
  const tokenProxyUrl = getHostedOAuthTokenProxyUrl(proxyUrl);
  const proxyApplicable = Boolean(
    (discoveryProxyApplicable && proxyUrl) || tokenProxyUrl
  );
  // Optional: a login only lifts the proxy's anonymous limits.
  const discoveryProxyToken = proxyApplicable && currentUser
    ? await currentUser.getIdToken()
    : undefined;

  return startFlow(challenge?.targetUrl || serverUrl, {
    forceReauthorization: true,
    ...(challenge?.resourceMetadataUrl
      ? { resourceMetadataUrl: challenge.resourceMetadataUrl }
      : {}),
    ...(challenge?.scope ? { scope: challenge.scope } : {}),
    ...(discoveryProxyApplicable && proxyUrl
      ? {
          discoveryProxy: {
            url: proxyUrl,
            authorizationToken: discoveryProxyToken,
          },
        }
      : {}),
    ...(tokenProxyUrl
      ? {
          tokenProxy: {
            url: tokenProxyUrl,
            authorizationToken: discoveryProxyToken,
          },
        }
      : {}),
    deferAuthorizedTraceOutcome: true,
  });
};
