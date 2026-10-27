/**
 * Lists a live endpoint's interface for the breaking-change check: the same
 * transport negotiation and direct-then-proxy fallback as the /submit probe
 * (./submissionProbe), then every page of tools, prompts, resources and
 * resource templates the server declares. Loaded on demand by the
 * /tools/breaking-changes page, so the MCP SDK never reaches a paste-only visit.
 */
import { requestCapabilityDiscoveryPage, type CapabilityDiscoveryMethod } from './mcpClient';
import {
  attemptParallelConnections,
  getObservedAuthenticationChallenge,
  shouldRetryMcpConnectionThroughProxy,
} from './transportDetection';
import type { InterfaceSection, LiveInterfaceInput } from './interfaceSnapshot';

export const LIVE_INTERFACE_TIMEOUT_MS = 20_000;
const PAGE_LIMIT = 20;

type Connection = Awaited<ReturnType<typeof attemptParallelConnections>>;

export interface LiveInterface {
  input: LiveInterfaceInput;
  /** Sections whose listing completed; a failed prompts or resources listing is left out. */
  confirmed: Set<InterfaceSection>;
}

export class LiveInterfaceError extends Error {
  constructor(message: string, readonly code: 'auth-required' | 'unreachable' | 'list-failed') {
    super(message);
    this.name = 'LiveInterfaceError';
  }
}

const listAll = async (
  connection: Connection,
  method: CapabilityDiscoveryMethod,
  key: 'tools' | 'prompts' | 'resources' | 'resourceTemplates'
): Promise<unknown[]> => {
  const items: unknown[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const result = await requestCapabilityDiscoveryPage(connection.client, method, cursor) as Record<string, unknown>;
    if (Array.isArray(result?.[key])) items.push(...(result[key] as unknown[]));
    if (typeof result?.nextCursor !== 'string' || result.nextCursor === '') return items;
    cursor = result.nextCursor;
  }
  return items;
};

const describe = async (connection: Connection): Promise<LiveInterface> => {
  const capabilities = connection.client.getServerCapabilities?.() ?? {};
  try {
    const tools = capabilities.tools === undefined ? [] : await listAll(connection, 'tools/list', 'tools');
    const confirmed = new Set<InterfaceSection>(['tools']);
    // Prompts and resources are best effort: a failure leaves the section unconfirmed.
    const optional = async (
      declared: unknown,
      method: CapabilityDiscoveryMethod,
      key: 'prompts' | 'resources' | 'resourceTemplates'
    ): Promise<unknown[]> => {
      if (declared === undefined) {
        confirmed.add(key);
        return [];
      }
      try {
        const items = await listAll(connection, method, key);
        confirmed.add(key);
        return items;
      } catch {
        return [];
      }
    };
    const [prompts, resources, resourceTemplates] = await Promise.all([
      optional(capabilities.prompts, 'prompts/list', 'prompts'),
      optional(capabilities.resources, 'resources/list', 'resources'),
      optional(capabilities.resources, 'resources/templates/list', 'resourceTemplates'),
    ]);
    return {
      input: {
        tools,
        prompts,
        resources,
        resourceTemplates,
        protocolVersion: connection.protocolVersion ?? null,
        transport: connection.transportType,
      },
      confirmed,
    };
  } catch (error) {
    throw new LiveInterfaceError(`tools/list failed: ${error instanceof Error ? error.message : String(error)}`, 'list-failed');
  } finally {
    await connection.client.close().catch(() => {});
  }
};

const authError = (error: unknown): LiveInterfaceError | undefined => {
  const challenge = getObservedAuthenticationChallenge(error);
  if (!challenge || challenge.source !== 'target') return undefined;
  return new LiveInterfaceError(
    `The endpoint answered HTTP ${challenge.status}: it requires authorization. Connect in the playground, then compare against the saved connection.`,
    'auth-required'
  );
};

/** Connects without credentials and lists the interface; throws LiveInterfaceError. */
export async function fetchLiveInterface(
  endpointUrl: string,
  options: { signal?: AbortSignal; proxyUrl?: string } = {}
): Promise<LiveInterface> {
  const proxyUrl = options.proxyUrl ?? (import.meta.env.VITE_PROXY_URL as string | undefined);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIVE_INTERFACE_TIMEOUT_MS);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    try {
      return await describe(await attemptParallelConnections(endpointUrl, controller.signal));
    } catch (directError) {
      if (directError instanceof LiveInterfaceError) throw directError;
      const challenge = authError(directError);
      if (challenge) throw challenge;
      if (!shouldRetryMcpConnectionThroughProxy(directError) || !proxyUrl || controller.signal.aborted) {
        throw new LiveInterfaceError(
          controller.signal.aborted
            ? `No MCP transport answered within ${LIVE_INTERFACE_TIMEOUT_MS / 1000} seconds.`
            : `No MCP transport answered: ${(directError instanceof Error ? directError.message : String(directError)).slice(0, 240)}`,
          'unreachable'
        );
      }
      const proxied = new URL(proxyUrl);
      proxied.searchParams.set('target', endpointUrl);
      try {
        return await describe(await attemptParallelConnections(proxied.toString(), controller.signal, undefined, undefined, true));
      } catch (proxyError) {
        if (proxyError instanceof LiveInterfaceError) throw proxyError;
        throw authError(proxyError) ?? new LiveInterfaceError(
          `No MCP transport answered, directly or through the mcptest CORS proxy: ${(proxyError instanceof Error ? proxyError.message : String(proxyError)).slice(0, 240)}`,
          'unreachable'
        );
      }
    }
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}
