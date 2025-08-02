import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { TransportType } from '../types';
import { CorsAwareStreamableHTTPTransport } from './corsAwareTransport';
import { CorsAwareSSETransport } from './corsAwareSseTransport';

export async function attemptParallelConnections(serverUrl: string, abortSignal?: AbortSignal, authToken?: string): Promise<{
  transport: any;
  transportType: TransportType;
  client: Client;
}> {
  const baseUrl = new URL(serverUrl);
  
  // Detect preferred transport from URL path only (not domain)
  const originalPath = baseUrl.pathname;
  console.log(`[DEBUG] Original path: "${originalPath}"`);
  console.log(`[DEBUG] Path analysis: endsWith('/sse')=${originalPath.endsWith('/sse')}, equals('/sse')=${originalPath === '/sse'}`);
  
  const preferredTransport = originalPath.endsWith('/sse') || originalPath.endsWith('/sse/') || originalPath === '/sse' ? 'sse' : 
                            originalPath.endsWith('/mcp') || originalPath.endsWith('/mcp/') || originalPath === '/mcp' ? 'http' : null;
  
  console.log(`[Parallel Connection] URL contains preferred transport: ${preferredTransport || 'none detected'}`);
  console.log('[Parallel Connection] Attempting both SSE and Streamable HTTP with/without trailing slashes...');
  
  // Create URLs for each transport type and slash variation
  const basePath = baseUrl.pathname.replace(/\/(mcp|sse)\/?$/, '').replace(/\/$/, '');
  
  // Create all possible URL combinations
  const httpUrlWithSlash = new URL(baseUrl);
  const httpUrlWithoutSlash = new URL(baseUrl);
  const sseUrlWithSlash = new URL(baseUrl);
  const sseUrlWithoutSlash = new URL(baseUrl);
  
  httpUrlWithSlash.pathname = basePath + '/mcp/';
  httpUrlWithoutSlash.pathname = basePath + '/mcp';
  sseUrlWithSlash.pathname = basePath + '/sse/';
  sseUrlWithoutSlash.pathname = basePath + '/sse';
  
  console.log(`[Parallel Connection] Trying HTTP URLs: ${httpUrlWithSlash.toString()}, ${httpUrlWithoutSlash.toString()}`);
  console.log(`[Parallel Connection] Trying SSE URLs: ${sseUrlWithSlash.toString()}, ${sseUrlWithoutSlash.toString()}`);
  
  // Create clients for all attempts
  const httpClientWithSlash = new Client({ name: "mcp-sse-tester-react", version: "1.1.0" });
  const httpClientWithoutSlash = new Client({ name: "mcp-sse-tester-react", version: "1.1.0" });
  const sseClientWithSlash = new Client({ name: "mcp-sse-tester-react", version: "1.1.0" });
  const sseClientWithoutSlash = new Client({ name: "mcp-sse-tester-react", version: "1.1.0" });
  
  // Create transport options with auth headers if token provided
  const transportOpts = authToken ? {
    headers: {
      'Authorization': `Bearer ${authToken}`
    }
  } : undefined;
  
  // Create transports for all combinations
  const httpTransportWithSlash = new CorsAwareStreamableHTTPTransport(httpUrlWithSlash, transportOpts);
  const httpTransportWithoutSlash = new CorsAwareStreamableHTTPTransport(httpUrlWithoutSlash, transportOpts);
  const sseTransportWithSlash = new CorsAwareSSETransport(sseUrlWithSlash, transportOpts);
  const sseTransportWithoutSlash = new CorsAwareSSETransport(sseUrlWithoutSlash, transportOpts);
  
  // Create connection promises that handle their own errors
  const httpPromiseWithSlash = httpClientWithSlash.connect(httpTransportWithSlash)
    .then(() => ({
      transport: httpTransportWithSlash,
      transportType: 'streamable-http' as TransportType,
      client: httpClientWithSlash,
      success: true,
      url: httpUrlWithSlash.toString()
    }))
    .catch(error => ({
      error,
      transportType: 'streamable-http' as TransportType,
      client: httpClientWithSlash,
      success: false,
      url: httpUrlWithSlash.toString()
    }));
  
  const httpPromiseWithoutSlash = httpClientWithoutSlash.connect(httpTransportWithoutSlash)
    .then(() => ({
      transport: httpTransportWithoutSlash,
      transportType: 'streamable-http' as TransportType,
      client: httpClientWithoutSlash,
      success: true,
      url: httpUrlWithoutSlash.toString()
    }))
    .catch(error => ({
      error,
      transportType: 'streamable-http' as TransportType,
      client: httpClientWithoutSlash,
      success: false,
      url: httpUrlWithoutSlash.toString()
    }));
  
  const ssePromiseWithSlash = sseClientWithSlash.connect(sseTransportWithSlash)
    .then(() => ({
      transport: sseTransportWithSlash,
      transportType: 'legacy-sse' as TransportType,
      client: sseClientWithSlash,
      success: true,
      url: sseUrlWithSlash.toString()
    }))
    .catch(error => ({
      error,
      transportType: 'legacy-sse' as TransportType,
      client: sseClientWithSlash,
      success: false,
      url: sseUrlWithSlash.toString()
    }));
  
  const ssePromiseWithoutSlash = sseClientWithoutSlash.connect(sseTransportWithoutSlash)
    .then(() => ({
      transport: sseTransportWithoutSlash,
      transportType: 'legacy-sse' as TransportType,
      client: sseClientWithoutSlash,
      success: true,
      url: sseUrlWithoutSlash.toString()
    }))
    .catch(error => ({
      error,
      transportType: 'legacy-sse' as TransportType,
      client: sseClientWithoutSlash,
      success: false,
      url: sseUrlWithoutSlash.toString()
    }));
  
  // Create abort promise if signal provided
  const abortPromise = abortSignal ? new Promise<never>((_, reject) => {
    abortSignal.addEventListener('abort', () => {
      reject(new Error('Connection aborted by user'));
    });
  }) : new Promise<never>(() => {}); // Never resolves if no abort signal
  
  try {
    // Prioritize preferred transport - try it first with a short timeout
    if (preferredTransport) {
      console.log(`[Parallel Connection] Trying preferred transport (${preferredTransport}) first...`);
      
      // Try original URL first, then variations
      const preferredPromises = preferredTransport === 'sse' ? 
        (originalPath === '/sse' ? [ssePromiseWithoutSlash, ssePromiseWithSlash] : [ssePromiseWithSlash, ssePromiseWithoutSlash]) : 
        (originalPath === '/mcp' ? [httpPromiseWithoutSlash, httpPromiseWithSlash] : [httpPromiseWithSlash, httpPromiseWithoutSlash]);
      
      // Try preferred transport with 5 second timeout
      const preferredTimeout = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Preferred transport timeout')), 5000)
      );
      
      try {
        console.log(`[Parallel Connection] Trying ${preferredPromises.length} preferred transport attempts...`);
        const preferredResults = await Promise.race([
          Promise.allSettled(preferredPromises),
          preferredTimeout
        ]);
        
        if (Array.isArray(preferredResults)) {
          // Check if any preferred transport succeeded
          for (const result of preferredResults) {
            if (result.status === 'fulfilled' && result.value.success) {
              console.log(`[Parallel Connection] Preferred transport ${preferredTransport} succeeded!`);
              const successfulResult = result.value;
              
              // Close all other connections
              const allClients = [
                httpClientWithSlash,
                httpClientWithoutSlash,
                sseClientWithSlash,
                sseClientWithoutSlash
              ];
              
              try {
                await Promise.allSettled(
                  allClients
                    .filter(client => client !== successfulResult.client)
                    .map(client => client.close())
                );
              } catch (error) {
                console.log('[Parallel Connection] Error closing unused connections:', error);
              }
              
              return {
                transport: successfulResult.transport,
                transportType: successfulResult.transportType,
                client: successfulResult.client
              };
            }
          }
        }
      } catch (error) {
        console.log(`[Parallel Connection] Preferred transport ${preferredTransport} failed or timed out:`, error.message);
        console.log(`[Parallel Connection] Falling back to all methods...`);
      }
    }
    
    // Fall back to all connection attempts
    const allPromises = [
      httpPromiseWithSlash,
      httpPromiseWithoutSlash, 
      ssePromiseWithSlash,
      ssePromiseWithoutSlash
    ];
    
    const promises = abortSignal ? [
      Promise.allSettled(allPromises),
      abortPromise
    ] : [Promise.allSettled(allPromises)];
    
    const raceResult = await Promise.race(promises);
    
    // If we get here and raceResult is an array, it means allSettled completed
    if (Array.isArray(raceResult)) {
      const results = raceResult;
      
      // Find the first successful connection
      let successfulResult = null;
      let errors: Error[] = [];
      
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.success) {
          successfulResult = result.value;
          break;
        } else if (result.status === 'fulfilled' && !result.value.success) {
          errors.push(result.value.error);
        } else if (result.status === 'rejected') {
          errors.push(result.reason);
        }
      }
      
      if (successfulResult) {
        console.log(`[Parallel Connection] ${successfulResult.transportType} connected successfully to ${successfulResult.url}!`);
        
        // Close all other connections
        const allClients = [
          httpClientWithSlash,
          httpClientWithoutSlash,
          sseClientWithSlash,
          sseClientWithoutSlash
        ];
        
        try {
          await Promise.allSettled(
            allClients
              .filter(client => client !== successfulResult.client)
              .map(client => client.close())
          );
        } catch (error) {
          console.log('[Parallel Connection] Error closing unused connections:', error);
        }
        
        return {
          transport: successfulResult.transport,
          transportType: successfulResult.transportType,
          client: successfulResult.client
        };
      } else {
        // All connections failed
        const errorMessage = errors.length > 0 
          ? `All connections failed: ${errors.map(e => e.message).join(', ')}`
          : 'All connections failed with unknown errors';
        throw new Error(errorMessage);
      }
    }
    
    // If we reach here, it means abort was triggered
    throw new Error('Connection aborted by user');
    
  } catch (error) {
    // Clean up all connections on error
    const allClients = [
      httpClientWithSlash,
      httpClientWithoutSlash,
      sseClientWithSlash,
      sseClientWithoutSlash
    ];
    
    try {
      await Promise.allSettled(allClients.map(client => client.close()));
    } catch (cleanupError) {
      console.log('[Parallel Connection] Error during cleanup:', cleanupError);
    }
    throw error;
  }
}

// Keep the original function for backwards compatibility
export async function detectTransport(serverUrl: string): Promise<TransportType> {
  // This is now just used for display purposes - the actual connection uses parallel attempts
  return 'legacy-sse';
}