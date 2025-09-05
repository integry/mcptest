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
  private customHeaders: Record<string, string> = {};
  private authToken?: string;

  constructor(url: URL, opts?: any) {
    // If Authorization header is provided, append it as a query parameter
    // since EventSource doesn't support custom headers
    if (opts?.headers?.Authorization) {
      const authHeader = opts.headers.Authorization;
      
      // Check if this is a PayPal token (format: "login:xxx:yyy") without Bearer prefix
      if (url.host.includes('paypal.com') && authHeader.startsWith('login:')) {
        // For PayPal, pass the token directly without encoding
        // PayPal's SSE endpoint expects the raw token
        url.searchParams.set('auth', authHeader);
        console.log('[CORS SSE] PayPal token detected (without Bearer), using raw token format:', {
          tokenFormat: 'login:xxx:yyy',
          tokenPreview: authHeader.substring(0, 20) + '...',
          fullUrl: url.toString().substring(0, 100) + '...'
        });
      } else if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        // Add auth token as query parameter for SSE
        
        // Special handling for PayPal tokens which are in format "login:xxx:yyy"
        // PayPal expects the token to be passed directly without Bearer prefix
        if (url.host.includes('paypal.com') && token.startsWith('login:')) {
          // For PayPal, pass the token directly without encoding
          // PayPal's SSE endpoint expects the raw token
          url.searchParams.set('auth', token);
          console.log('[CORS SSE] PayPal token detected (with Bearer), using raw token format:', {
            tokenFormat: 'login:xxx:yyy',
            tokenPreview: token.substring(0, 20) + '...',
            fullUrl: url.toString().substring(0, 100) + '...'
          });
        } else {
          // For other services, URL encode the token to handle special characters
          const encodedToken = encodeURIComponent(token);
          url.searchParams.set('auth', encodedToken);
          console.log('[CORS SSE] Added auth token to URL as query parameter:', {
            originalToken: token.substring(0, 20) + '...',
            encodedToken: encodedToken.substring(0, 30) + '...',
            fullUrl: url.toString().substring(0, 100) + '...'
          });
        }
      }
    }
    
    super(url, opts);
    this.serverUrl = url.toString();
    // Store custom headers if provided
    if (opts?.headers) {
      this.customHeaders = opts.headers;
      // Extract auth token for potential use
      if (opts.headers.Authorization && opts.headers.Authorization.startsWith('Bearer ')) {
        this.authToken = opts.headers.Authorization.substring(7);
      }
    }
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