/**
 * CORS-aware SSE transport that avoids sending problematic headers
 * if the server doesn't support them
 */

import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { testCorsCompatibility } from './corsTest';

export class CorsAwareSSETransport extends SSEClientTransport {
  private corsTestDone = false;
  private serverSupportsMcpHeaders = false;
  private serverUrl: string;

  constructor(url: URL, opts?: any) {
    super(url, opts);
    this.serverUrl = url.toString();
  }

  async start() {
    // Test CORS compatibility on first call
    if (!this.corsTestDone) {
      try {
        const corsTest = await testCorsCompatibility(this.serverUrl);
        this.serverSupportsMcpHeaders = corsTest.supportsMcpHeaders;
        this.corsTestDone = true;
        
        console.log(`[CORS Test SSE] Server MCP header support: ${this.serverSupportsMcpHeaders}`);
      } catch (error) {
        console.warn('[CORS Test SSE] Failed, assuming no MCP header support:', error);
        this.serverSupportsMcpHeaders = false;
        this.corsTestDone = true;
      }
    }

    // Call parent start method
    return super.start();
  }

  // Override any method that might set problematic headers
  setProtocolVersion(version: string): void {
    if (this.serverSupportsMcpHeaders) {
      // Only set protocol version if server supports MCP headers
      console.log(`[CORS SSE] Setting protocol version: ${version}`);
      super.setProtocolVersion(version);
    } else {
      console.log('[CORS SSE] Skipping protocol version - server does not support MCP headers');
      // Don't call super.setProtocolVersion to avoid setting the header
    }
  }
}