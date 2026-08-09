import { Client, type ProtocolEra } from '@modelcontextprotocol/client';

const CLIENT_VERSION = '2.0.0';

/**
 * Create a client that negotiates the 2026 stateless protocol when available
 * and falls back to the byte-compatible 2025 stateful initialize flow.
 */
export const createNegotiatingMcpClient = (name: string): Client =>
  new Client(
    { name, version: CLIENT_VERSION },
    { versionNegotiation: { mode: 'auto' } }
  );

/** Deprecated SSE only supports the legacy/stateful MCP connection flow. */
export const createLegacyMcpClient = (name: string): Client =>
  new Client(
    { name, version: CLIENT_VERSION },
    { versionNegotiation: { mode: 'legacy' } }
  );

export interface ProtocolDetails {
  era: ProtocolEra;
  version?: string;
}

export const getProtocolDetails = (client: Client): ProtocolDetails => ({
  era: client.getProtocolEra() ?? 'legacy',
  version: client.getNegotiatedProtocolVersion(),
});
