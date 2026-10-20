/**
 * Browser-side "Check endpoint" step for /submit. It reuses the playground's
 * transport negotiation (attemptParallelConnections), the evaluator's
 * direct-then-proxy fallback and the catalog liveness auth classification, then
 * condenses the outcome into CatalogSubmissionEvidence for the submission.
 */
import { discoverOAuthProtectedResourceMetadata } from '@modelcontextprotocol/client';
import type { CatalogSubmissionAuthChallenge, CatalogSubmissionEvidence } from './catalogSubmission';
import { requestCapabilityDiscoveryPage } from './mcpClient';
import {
  attemptParallelConnections,
  getObservedAuthenticationChallenge,
  shouldRetryMcpConnectionThroughProxy,
  type ObservedAuthenticationChallenge,
} from './transportDetection';

export const SUBMISSION_PROBE_TIMEOUT_MS = 20_000;
const TOOL_PAGE_LIMIT = 20;

type Connection = Awaited<ReturnType<typeof attemptParallelConnections>>;

export interface SubmissionProbeDependencies {
  connect: typeof attemptParallelConnections;
  discoverResourceMetadata: (url: string) => Promise<unknown>;
  proxyUrl: string | undefined;
}

const defaultDependencies = (): SubmissionProbeDependencies => ({
  connect: attemptParallelConnections,
  discoverResourceMetadata: (url) => discoverOAuthProtectedResourceMetadata(url),
  proxyUrl: import.meta.env.VITE_PROXY_URL,
});

const targetOf = (connectionUrl: string, proxied: boolean): string => {
  if (!proxied) return connectionUrl;
  return new URL(connectionUrl).searchParams.get('target') || connectionUrl;
};

/** Counts tools across pages; undefined when the server does not answer tools/list. */
const countTools = async (connection: Connection): Promise<number | undefined> => {
  if (connection.client.getServerCapabilities?.()?.tools === undefined) return 0;
  let total = 0;
  let cursor: string | undefined;
  try {
    for (let page = 0; page < TOOL_PAGE_LIMIT; page += 1) {
      const result = await requestCapabilityDiscoveryPage(connection.client, 'tools/list', cursor) as {
        tools?: unknown[];
        nextCursor?: unknown;
      };
      total += Array.isArray(result?.tools) ? result.tools.length : 0;
      if (typeof result?.nextCursor !== 'string' || result.nextCursor === '') return total;
      cursor = result.nextCursor;
    }
    return total;
  } catch {
    return undefined;
  }
};

const classifyChallenge = async (
  challenge: ObservedAuthenticationChallenge,
  endpointUrl: string,
  deps: SubmissionProbeDependencies
): Promise<CatalogSubmissionAuthChallenge> => {
  const header = challenge.responseHeaders?.['www-authenticate'] || '';
  if (challenge.resourceMetadataUrl || /resource_metadata=/i.test(header)) return 'oauth';
  // A bare Bearer challenge may still advertise OAuth through RFC 9728 discovery.
  try {
    if (await deps.discoverResourceMetadata(challenge.targetUrl || endpointUrl)) return 'oauth';
  } catch {
    // Discovery is best effort; CORS or a 404 leaves the challenge as observed.
  }
  if (/^\s*bearer\b/i.test(header)) return 'bearer';
  return 'unspecified';
};

const connectedEvidence = async (
  endpointUrl: string,
  connection: Connection,
  proxied: boolean
): Promise<CatalogSubmissionEvidence> => {
  const toolCount = await countTools(connection);
  await connection.client.close().catch(() => {});
  const protocolEra = connection.protocolEra === 'modern' ? 'stateless' : 'stateful';
  const validatedUrl = targetOf(connection.url, proxied);
  return {
    checkedAt: new Date().toISOString(),
    endpointUrl,
    outcome: 'mcp',
    validatedUrl,
    transport: connection.transportType,
    ...(connection.protocolVersion ? { protocolVersion: connection.protocolVersion } : {}),
    protocolEra,
    authChallenge: 'none',
    browserAccess: proxied ? 'proxy-required' : 'direct',
    ...(toolCount === undefined ? {} : { toolCount }),
    detail: `Negotiated ${protocolEra} MCP${connection.protocolVersion ? ` ${connection.protocolVersion}` : ''} over ${connection.transportType} at ${new URL(validatedUrl).host}${proxied ? ' through the mcptest CORS proxy' : ''}.`,
  };
};

const challengeEvidence = async (
  endpointUrl: string,
  error: unknown,
  proxied: boolean,
  deps: SubmissionProbeDependencies
): Promise<CatalogSubmissionEvidence | undefined> => {
  // Only an HTTP 401/403 the target itself returned counts. Error text that merely
  // mentions "Forbidden" or "authentication required" is an unsuccessful check.
  const challenge = getObservedAuthenticationChallenge(error);
  if (!challenge || challenge.source !== 'target') return undefined;
  // A 403 without WWW-Authenticate is usually a firewall or bot block, not an auth challenge.
  if (challenge.status === 403 && !challenge.responseHeaders?.['www-authenticate']) return undefined;

  const authChallenge = await classifyChallenge(challenge, endpointUrl, deps);
  const validatedUrl = challenge.targetUrl;
  return {
    checkedAt: new Date().toISOString(),
    endpointUrl,
    outcome: 'auth-challenge',
    ...(validatedUrl && /^https:/.test(validatedUrl) ? { validatedUrl } : {}),
    authChallenge,
    authStatus: challenge.status,
    browserAccess: proxied ? 'proxy-required' : 'direct',
    detail: `The endpoint answered with HTTP ${challenge.status} and ${
      authChallenge === 'oauth' ? 'an OAuth challenge' : authChallenge === 'bearer' ? 'a bearer-token challenge' : 'an authentication challenge'
    }${proxied ? ' through the mcptest CORS proxy' : ''}, so the protected server is reachable. Tools are listed after authorization.`,
  };
};

const unreachableEvidence = (endpointUrl: string, error: unknown, timedOut: boolean, corsBlocked: boolean): CatalogSubmissionEvidence => {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 240);
  return {
    checkedAt: new Date().toISOString(),
    endpointUrl,
    outcome: 'unreachable',
    authChallenge: 'none',
    browserAccess: 'unknown',
    detail: timedOut
      ? `No MCP transport answered within ${SUBMISSION_PROBE_TIMEOUT_MS / 1000} seconds.`
      : `${corsBlocked ? 'The browser could not read the response (CORS) and the proxy did not reach an MCP server either. ' : ''}No MCP transport answered: ${message}`,
  };
};

/** Probes `endpointUrl` like the playground does and returns submission evidence. Never throws. */
export async function probeSubmissionEndpoint(
  endpointUrl: string,
  options: { signal?: AbortSignal; dependencies?: Partial<SubmissionProbeDependencies> } = {}
): Promise<CatalogSubmissionEvidence> {
  const deps = { ...defaultDependencies(), ...options.dependencies };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUBMISSION_PROBE_TIMEOUT_MS);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });

  try {
    try {
      const direct = await deps.connect(endpointUrl, controller.signal);
      return await connectedEvidence(endpointUrl, direct, false);
    } catch (directError) {
      const challenge = await challengeEvidence(endpointUrl, directError, false, deps);
      if (challenge) return challenge;
      const corsBlocked = shouldRetryMcpConnectionThroughProxy(directError);
      if (!corsBlocked || !deps.proxyUrl || controller.signal.aborted) {
        return unreachableEvidence(endpointUrl, directError, controller.signal.aborted, false);
      }

      const proxyConnectionUrl = new URL(deps.proxyUrl);
      proxyConnectionUrl.searchParams.set('target', endpointUrl);
      try {
        const proxied = await deps.connect(proxyConnectionUrl.toString(), controller.signal, undefined, undefined, true);
        return await connectedEvidence(endpointUrl, proxied, true);
      } catch (proxyError) {
        const proxiedChallenge = await challengeEvidence(endpointUrl, proxyError, true, deps);
        return proxiedChallenge || unreachableEvidence(endpointUrl, proxyError, controller.signal.aborted, true);
      }
    }
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}
