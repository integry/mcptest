import type { ProtocolEra } from '@modelcontextprotocol/client';
import type { TransportType } from '../types';
import type { CatalogServerStatus } from '../types/catalog';
import { attemptParallelConnections } from './transportDetection';

export type LivenessResult = {
  status: CatalogServerStatus;
  authChallenge: boolean;
  detail: string;
  transportType?: TransportType;
  protocolEra?: ProtocolEra;
  protocolVersion?: string;
};

const PROBE_TIMEOUT_MS = 10_000;

export const isAuthenticationFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(401|403)\b|unauthori[sz]ed|forbidden|authentication required/i.test(message);
};

export const checkServerLiveness = async (serverUrl: string): Promise<LivenessResult> => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const connection = await attemptParallelConnections(serverUrl, controller.signal);
    await connection.client.close().catch(() => {});
    const lifecycle = connection.protocolEra === 'modern' ? 'stateless' : 'stateful';

    return {
      status: 'online',
      authChallenge: false,
      transportType: connection.transportType,
      protocolEra: connection.protocolEra,
      protocolVersion: connection.protocolVersion,
      detail: `Live browser probe negotiated ${lifecycle} MCP${connection.protocolVersion ? ` ${connection.protocolVersion}` : ''} over ${connection.transportType} at ${connection.url}.`,
    };
  } catch (error) {
    if (isAuthenticationFailure(error)) {
      return {
        status: 'online',
        authChallenge: true,
        detail: 'The endpoint returned an authentication challenge before MCP negotiation, confirming that the protected server is reachable.',
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    const timedOut = controller.signal.aborted || /abort|timeout/i.test(message);
    return {
      status: 'unknown',
      authChallenge: false,
      detail: timedOut
        ? `Live browser negotiation timed out after ${PROBE_TIMEOUT_MS / 1000} seconds. The server may be slow, unreachable, or may block CORS.`
        : `Live browser negotiation failed. The server may block CORS, be unreachable, or have rejected every MCP transport candidate. ${message}`,
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
};
