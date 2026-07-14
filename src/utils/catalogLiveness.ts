import type { CatalogServerStatus } from '../types/catalog';

export type LivenessResult = {
  status: CatalogServerStatus;
  authChallenge: boolean;
  detail: string;
};

const PROBE_TIMEOUT_MS = 10_000;
const PROTOCOL_VERSION = '2025-06-18';

const getMcpEndpointUrl = (serverUrl: string): string => {
  const baseUrl = new URL(serverUrl);

  if (baseUrl.searchParams.has('target')) {
    const targetUrl = baseUrl.searchParams.get('target');
    if (!targetUrl) {
      throw new Error('Proxy URL missing target parameter');
    }

    const targetBaseUrl = new URL(targetUrl);
    const targetBasePath = targetBaseUrl.pathname.replace(/\/(mcp|sse)\/?$/, '').replace(/\/$/, '');
    targetBaseUrl.pathname = `${targetBasePath}/mcp`;

    const probeUrl = new URL(baseUrl);
    probeUrl.searchParams.set('target', targetBaseUrl.toString());
    return probeUrl.toString();
  }

  const basePath = baseUrl.pathname.replace(/\/(mcp|sse)\/?$/, '').replace(/\/$/, '');
  baseUrl.pathname = `${basePath}/mcp`;
  return baseUrl.toString();
};

const createInitializeBody = () =>
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'mcp-sse-tester-catalog-liveness',
        version: '1.0.0',
      },
    },
  });

export const checkServerLiveness = async (serverUrl: string): Promise<LivenessResult> => {
  let endpointUrl: string;

  try {
    endpointUrl = getMcpEndpointUrl(serverUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid server URL';
    return {
      status: 'unknown',
      authChallenge: false,
      detail: `Unable to build MCP probe URL: ${message}.`,
    };
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body: createInitializeBody(),
      signal: controller.signal,
    });

    if (response.ok) {
      return {
        status: 'online',
        authChallenge: false,
        detail: `Live browser probe succeeded at ${endpointUrl} with HTTP ${response.status}.`,
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        status: 'online',
        authChallenge: true,
        detail: `Live browser probe reached ${endpointUrl} and received HTTP ${response.status}; authentication is required.`,
      };
    }

    return {
      status: 'unknown',
      authChallenge: false,
      detail: `Live browser probe reached ${endpointUrl} but received HTTP ${response.status}. Server liveness is unknown.`,
    };
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === 'AbortError';
    return {
      status: 'unknown',
      authChallenge: false,
      detail: isAbort
        ? `Live browser probe timed out after ${PROBE_TIMEOUT_MS / 1000} seconds. The server may be slow, unreachable, or may block CORS.`
        : 'Live browser probe failed from this browser. The server may block CORS, be unreachable, or the request may have been blocked by the browser.',
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
};
