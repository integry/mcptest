/**
 * CORS-aware MCP transport that avoids sending problematic headers
 * if the server doesn't support them
 */

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { testCorsCompatibility } from './corsTest';

export class CorsAwareStreamableHTTPTransport extends StreamableHTTPClientTransport {
  private corsTestDone = false;
  private serverSupportsMcpHeaders = false;
  private serverUrl: string;
  private customHeaders: Record<string, string> = {};

  constructor(url: URL, opts?: any) {
    super(url, opts);
    this.serverUrl = url.toString();
    // Store custom headers if provided
    if (opts?.headers) {
      this.customHeaders = opts.headers;
    }
  }

  async _commonHeaders() {
    // Test CORS compatibility on first call
    if (!this.corsTestDone) {
      try {
        const corsTest = await testCorsCompatibility(this.serverUrl);
        this.serverSupportsMcpHeaders = corsTest.supportsMcpHeaders;
        this.corsTestDone = true;
        
        console.log(`[CORS Test] Server MCP header support: ${this.serverSupportsMcpHeaders}`);
      } catch (error) {
        console.warn('[CORS Test] Failed, assuming no MCP header support:', error);
        this.serverSupportsMcpHeaders = false;
        this.corsTestDone = true;
      }
    }

    // Get original headers from parent class
    const headers = await super._commonHeaders();
    
    // Remove mcp-protocol-version if server doesn't support it
    if (!this.serverSupportsMcpHeaders && headers.has('mcp-protocol-version')) {
      headers.delete('mcp-protocol-version');
      console.log('[CORS] Removed mcp-protocol-version header - server does not support it');
    }
    
    // Set proper Accept header for servers that require both content types
    headers.set('Accept', 'application/json, text/event-stream');
    console.log('[CORS] Set Accept header to: application/json, text/event-stream');
    
    // Add custom headers (like Authorization)
    for (const [key, value] of Object.entries(this.customHeaders)) {
      headers.set(key, value);
      if (key === 'Authorization') {
        console.log('[CORS Transport] Setting Authorization header:', value.substring(0, 30) + '...');
      }
    }
    
    return headers;
  }

  // Override setProtocolVersion to prevent setting if server doesn't support it
  setProtocolVersion(version: string): void {
    if (this.serverSupportsMcpHeaders) {
      super.setProtocolVersion(version);
    } else {
      console.log('[CORS] Skipping protocol version header - server does not support it');
    }
  }
}