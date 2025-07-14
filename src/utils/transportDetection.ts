import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { TransportType } from '../types';

export async function detectTransport(serverUrl: string): Promise<TransportType> {
  // Try Streamable HTTP first
  try {
    const client = new Client({ name: 'transport-detector', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(serverUrl));
    await client.connect(transport);
    await client.close();
    return 'streamable-http';
  } catch (error) {
    // If that fails, try legacy SSE
    try {
      const client = new Client({ name: 'transport-detector', version: '1.0.0' });
      const transport = new SSEClientTransport(new URL(serverUrl));
      await client.connect(transport);
      await client.close();
      return 'legacy-sse';
    } catch (sseError) {
      throw new Error('Unsupported transport');
    }
  }
}