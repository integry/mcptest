/**
 * Plain-language guidance for connection and call failures: what failed, the
 * most likely cause, what to try, and the Learn article that covers it. It is
 * read before the technical evidence in ConnectionErrorCard and the result
 * view, and maps the failures the error articles already document.
 */
import { getLearnArticle } from '../content/learnRegistry';
import type { ConnectionAttemptFact, ConnectionErrorDetails } from './connectionDiagnostics';
import { referencePathFor } from './referenceLinks';
import { detectedTransportDiagnostics } from './transportDiagnostics';

export interface LearnLink {
  path: string;
  title: string;
}

export interface FailureGuidance {
  /** Stable id for tests and analytics. */
  id: string;
  whatFailed: string;
  likelyCause: string;
  tryThis: string[];
  learn?: LearnLink;
}

/** Learn articles that document each failure, by slug in the article registry. */
export const GUIDANCE_ARTICLES = {
  cors: 'mcp-cors-headers-for-browser-clients',
  unauthorized: 'remote-mcp-server-401-unauthorized',
  oauthDiscovery: 'mcp-error-failed-to-discover-oauth-metadata',
  notFound: 'mcp-error-sse-non-200-404',
  sessionNotFound: 'mcp-session-not-found-after-deploy',
  mediaType: 'mcp-406-not-acceptable-415-and-405',
  posting: 'mcp-error-posting-to-endpoint',
  timeout: 'mcp-error-request-timed-out',
  closed: 'mcp-error-connection-closed',
  connect: 'connect-remote-mcp-server',
  errorCodes: 'mcp-json-rpc-error-codes',
  noTools: 'mcp-server-connected-but-no-tools',
} as const;

export type GuidanceArticle = keyof typeof GUIDANCE_ARTICLES;

/** Resolves a Learn link through the registry, so a renamed article cannot leave a dead link. */
export const learnLink = (article: GuidanceArticle): LearnLink | undefined => {
  const entry = getLearnArticle(GUIDANCE_ARTICLES[article]);
  return entry ? { path: entry.path, title: entry.navTitle || entry.title } : undefined;
};

const RATE_LIMIT_REFERENCE = (): LearnLink | undefined => {
  const path = referencePathFor('transport.target-rate-limited-429');
  return path ? { path, title: 'Transport diagnostics: rate limited (429)' } : undefined;
};

/** A readable HTTP error the target itself produced; proxy-owned responses are not target evidence. */
const isTargetHttpError = ({ route, status, authenticationSource, responseSource }: ConnectionAttemptFact): boolean => (
  status !== undefined && status >= 400
  && authenticationSource !== 'proxy'
  && responseSource !== 'proxy'
  // Through the proxy, only a response the proxy attributes to the target counts.
  && (route !== 'proxy' || responseSource === 'target')
);

/** A target response wins over a candidate the publisher never serves (404 on a guessed path). */
const preferNon404 = (attempts: readonly ConnectionAttemptFact[]): number | undefined => (
  (attempts.find(({ status }) => status !== 404) ?? attempts[0])?.status
);

/**
 * True when the direct browser read a successful initialize and a later request
 * for the same candidate and transport was unreadable: the session was reached,
 * so an earlier error on another candidate does not explain the failure.
 */
const laterRequestBrowserBlocked = (attempts: readonly ConnectionAttemptFact[]): boolean => {
  const direct = attempts.filter(({ route }) => route === 'direct');
  return direct.some((attempt, index) => attempt.browserUnreadable && direct.some((candidate, candidateIndex) => (
    candidateIndex < index
    && candidate.failureKind === 'success'
    && candidate.mcpMethod === 'initialize'
    && candidate.status !== undefined
    && candidate.candidateUrl === attempt.candidateUrl
    && candidate.transportType !== undefined
    && candidate.transportType === attempt.transportType
  )));
};

const textOf = (details: ConnectionErrorDetails): string => (
  `${details.error || ''} ${details.details || ''}`.toLowerCase()
);

const unauthorized = (): FailureGuidance => ({
  id: 'unauthorized',
  whatFailed: 'The server needs you to sign in or send a credential (HTTP 401).',
  likelyCause: 'The endpoint is protected and no valid token or API key was sent.',
  tryThis: [
    'If the server uses OAuth, retry and complete the sign-in.',
    'If it uses an API key or bearer token, enter it and connect again.',
  ],
  learn: learnLink('unauthorized'),
});

export const getConnectionGuidance = (details: ConnectionErrorDetails): FailureGuidance => {
  const attempts = details.attempts || [];
  const text = textOf(details);

  if (details.failureStage === 'oauth') {
    return {
      id: 'oauth-failed',
      whatFailed: 'Signing in to the server did not finish.',
      likelyCause: 'The authorization server rejected the request, or its OAuth metadata could not be read from the browser.',
      tryThis: [
        'Retry the authorization; close any leftover sign-in window first.',
        'If it fails again, check the provider error in the technical detail below.',
      ],
      learn: learnLink('oauthDiscovery'),
    };
  }

  // The target's own challenge is the stronger evidence: an earlier proxy-login
  // refusal does not explain a request that later reached the target.
  if (attempts.some(({ authenticationSource, status }) => authenticationSource === 'target' && status === 401)) {
    return unauthorized();
  }
  if (attempts.some(({ authenticationSource, status }) => authenticationSource === 'proxy' && (status === 401 || status === 403))) {
    return {
      id: 'proxy-login',
      whatFailed: 'The mcptest proxy refused the request before it reached your server.',
      likelyCause: 'Your mcptest login expired. This is not a response from the MCP server.',
      tryThis: ['Sign in again, or sign out to use the proxy anonymously, then retry.'],
      learn: learnLink('connect'),
    };
  }

  const transportError = detectedTransportDiagnostics(details.transportDiagnostics)
    .find(({ severity }) => severity === 'error');
  if (transportError?.id === 'transport.target-rate-limited-429') {
    return {
      id: 'rate-limited',
      whatFailed: 'The server is rate limiting requests (HTTP 429).',
      likelyCause: 'Too many requests reached this endpoint recently, from mcptest or other clients.',
      tryThis: ['Wait for the retry time shown below, then retry once.'],
      learn: RATE_LIMIT_REFERENCE(),
    };
  }
  if (transportError?.id === 'transport.accept-header-406' || transportError?.id === 'transport.unsupported-media-type-415') {
    return {
      id: 'media-type',
      whatFailed: 'The server refused the request format the MCP spec requires.',
      likelyCause: 'It rejects the Accept or Content-Type header Streamable HTTP clients send, so every compliant client fails the same way.',
      tryThis: ['Fix the server to accept application/json and text/event-stream, then retry.'],
      learn: learnLink('mediaType'),
    };
  }

  // Same precedence as the technical diagnosis: a status the proxy read from the
  // target, then a browser block (after a successful initialize, or on any direct
  // attempt), and only then a status the browser read directly. Proxy-owned
  // responses never count as the target's status.
  const targetErrors = attempts.filter(isTargetHttpError);
  let status = preferNon404(targetErrors.filter(({ route }) => route === 'proxy'));
  const proxyReachedTarget = attempts.some(({ route, responseSource }) => route === 'proxy' && responseSource === 'target');
  if (status === undefined && !proxyReachedTarget) {
    if (laterRequestBrowserBlocked(attempts)) {
      return {
        id: 'browser-blocked-after-initialize',
        whatFailed: 'The server answered the handshake, then your browser blocked a later MCP request.',
        likelyCause: 'The server’s CORS policy allows the first request but not the headers later ones send, such as MCP-Protocol-Version.',
        tryThis: [
          'Retry through the mcptest proxy (it works without signing in).',
          'To fix it at the source, allow MCP-Protocol-Version and Mcp-Session-Id in the server’s CORS preflight response.',
        ],
        learn: learnLink('cors'),
      };
    }
    if (attempts.some(({ route, browserUnreadable }) => route === 'direct' && browserUnreadable)) {
      return {
        id: 'browser-blocked',
        whatFailed: 'Your browser blocked mcptest from reading the server response.',
        likelyCause: 'The server does not send the CORS headers browser clients need. Desktop clients are not affected.',
        tryThis: [
          'Retry through the mcptest proxy (it works without signing in).',
          'To fix it at the source, allow this origin and expose Mcp-Session-Id on the server.',
        ],
        learn: learnLink('cors'),
      };
    }
  }
  status ??= preferNon404(targetErrors.filter(({ route }) => route === 'direct'));
  if (status === 401) {
    return unauthorized();
  }
  if (status === 403) {
    return {
      id: 'forbidden',
      whatFailed: 'The server understood who you are but refused access (HTTP 403).',
      likelyCause: 'The token is missing a scope, or the account is not allowed to use this server.',
      tryThis: ['Check the scopes or permissions the server requires, then sign in again.'],
      learn: learnLink('unauthorized'),
    };
  }
  if (status === 404 && /session/.test(text)) {
    return {
      id: 'session-not-found',
      whatFailed: 'The server lost the session mcptest was using (HTTP 404).',
      likelyCause: 'The server restarted or a load balancer sent the request to a replica that does not know the session.',
      tryThis: ['Retry the connection to start a new session.'],
      learn: learnLink('sessionNotFound'),
    };
  }
  if (status === 404) {
    return {
      id: 'not-found',
      whatFailed: 'Nothing answers MCP at this address (HTTP 404).',
      likelyCause: 'The path is wrong; many servers serve MCP at /mcp or a provider-specific path.',
      tryThis: ['Check the exact endpoint in the server documentation and paste it in full.'],
      learn: learnLink('notFound'),
    };
  }
  if (status === 405 || status === 406 || status === 415) {
    return {
      id: 'media-type',
      whatFailed: `The server rejected the request method or format (HTTP ${status}).`,
      likelyCause: 'The endpoint is not a Streamable HTTP MCP endpoint, or it rejects the headers the spec requires.',
      tryThis: ['Confirm the URL is the MCP endpoint, not a website or REST API path.'],
      learn: learnLink('mediaType'),
    };
  }
  if (status !== undefined && status >= 500) {
    return {
      id: 'server-error',
      whatFailed: `The server failed while answering (HTTP ${status}).`,
      likelyCause: 'An error inside the server or its gateway, not in your request.',
      tryThis: ['Retry in a moment. If it persists, check the server logs for the request below.'],
      learn: learnLink('posting'),
    };
  }

  if (attempts.some(({ responseSource, status: s }) => responseSource === 'proxy' && s !== undefined && s >= 500)) {
    return {
      id: 'proxy-error',
      whatFailed: 'The mcptest proxy failed before your server answered.',
      likelyCause: 'The proxy reported an error of its own; this is not a response from the MCP server.',
      tryThis: ['Retry in a moment, or connect directly if the server allows browser clients.'],
      learn: learnLink('connect'),
    };
  }

  const kinds = new Set(attempts.map(({ failureKind }) => failureKind));
  if (kinds.has('timeout') || /timed? ?out|timeout/.test(text)) {
    return {
      id: 'timeout',
      whatFailed: 'The server did not answer in time.',
      likelyCause: 'It is slow to start, overloaded, or the address points at something that never replies.',
      tryThis: ['Retry once. If it times out again, check that the server is running and reachable.'],
      learn: learnLink('timeout'),
    };
  }
  if (kinds.has('refused') || kinds.has('network') || /failed to fetch|network|refused|enotfound|dns/.test(text)) {
    return {
      id: 'unreachable',
      whatFailed: 'mcptest could not reach the server.',
      likelyCause: 'The host name, port or protocol is wrong, or the server is offline. A localhost server must be running on this computer.',
      tryThis: ['Check the URL for typos and that it starts with https:// (or http:// for localhost).'],
      learn: learnLink('connect'),
    };
  }
  if (/connection closed|-32000/.test(text)) {
    return {
      id: 'closed',
      whatFailed: 'The server closed the connection during the handshake.',
      likelyCause: 'The server process exited or dropped the stream before answering.',
      tryThis: ['Retry, and check the server logs for a crash at startup.'],
      learn: learnLink('closed'),
    };
  }

  return {
    id: 'unknown',
    whatFailed: 'mcptest could not start an MCP session with this server.',
    likelyCause: 'The evidence below does not point at one cause.',
    tryThis: ['Check the URL, retry, and compare the terminal probe below with the browser attempts.'],
    learn: learnLink('connect'),
  };
};

/** JSON-RPC error code in an error message such as "MCP error -32602: ...". */
const rpcCodeOf = (message: string): number | undefined => {
  const match = message.match(/(-32\d{3})/);
  return match ? Number(match[1]) : undefined;
};

/**
 * Guidance for a tools/call that failed. `isError` results are the tool's own
 * answer; protocol and transport failures mean the call never completed.
 */
export const getCallGuidance = (failure: { isError?: boolean; message?: string }): FailureGuidance => {
  if (failure.isError) {
    return {
      id: 'tool-error-result',
      whatFailed: 'The tool ran and reported an error in its result (isError: true).',
      likelyCause: 'The tool rejected the arguments or a service behind it failed. The connection itself is fine.',
      tryThis: ['Read the content below for the tool’s own explanation, adjust the arguments and run it again.'],
      learn: learnLink('errorCodes'),
    };
  }
  const message = (failure.message || '').toLowerCase();
  const code = rpcCodeOf(message);
  if (code === -32602 || /invalid (params|arguments)|must contain valid json|must be a json/.test(message)) {
    return {
      id: 'invalid-params',
      whatFailed: 'The server rejected the arguments (invalid params).',
      likelyCause: 'A value does not match the tool’s input schema: a wrong type, a missing field or malformed JSON.',
      tryThis: ['Compare each field with the input schema under the form and run it again.'],
      learn: learnLink('errorCodes'),
    };
  }
  if (code === -32601) {
    return {
      id: 'method-not-found',
      whatFailed: 'The server does not offer this method or tool any more.',
      likelyCause: 'The tool list changed since it was loaded.',
      tryThis: ['Refresh the capabilities list and pick the tool again.'],
      learn: learnLink('errorCodes'),
    };
  }
  if (code === -32001 || /timed? ?out|timeout/.test(message)) {
    return {
      id: 'call-timeout',
      whatFailed: 'The tool did not answer in time.',
      likelyCause: 'The work behind it is slow, or the server stalled.',
      tryThis: ['Run it again; if it keeps timing out, try smaller inputs.'],
      learn: learnLink('timeout'),
    };
  }
  if (/session/.test(message) && /not found|404/.test(message)) {
    return {
      id: 'call-session-lost',
      whatFailed: 'The server no longer recognises this session.',
      likelyCause: 'It restarted or routed the call to another replica.',
      tryThis: ['Disconnect and connect again to start a new session.'],
      learn: learnLink('sessionNotFound'),
    };
  }
  if (/401|403|unauthori[sz]ed|forbidden/.test(message)) {
    return {
      id: 'call-unauthorized',
      whatFailed: 'The server refused the call for lack of permission.',
      likelyCause: 'The token expired or lacks the scope this tool needs.',
      tryThis: ['Reconnect to sign in again, then retry the call.'],
      learn: learnLink('unauthorized'),
    };
  }
  if (/connection closed|-32000|failed to fetch|network/.test(message)) {
    return {
      id: 'call-connection-lost',
      whatFailed: 'The connection dropped before the tool answered.',
      likelyCause: 'The server closed the stream or the network failed.',
      tryThis: ['Reconnect and run the call again.'],
      learn: learnLink('closed'),
    };
  }
  return {
    id: 'call-failed',
    whatFailed: 'The call did not complete.',
    likelyCause: 'The server returned a protocol error rather than a tool result.',
    tryThis: ['Read the error below, then check the Logs & Events tab for the full exchange.'],
    learn: learnLink('errorCodes'),
  };
};
