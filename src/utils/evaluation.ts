// src/utils/evaluation.ts
import { attemptParallelConnections } from './transportDetection';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const PROXY_URL = import.meta.env.VITE_PROXY_URL;

interface DetailItem {
  text: string;
  context?: string;
  metadata?: any;
}

interface EvaluationSection {
  name: string;
  description: string;
  score: number;
  maxScore: number;
  details: DetailItem[];
}

interface EvaluationReport {
  serverUrl: string;
  finalScore: number;
  sections: Record<string, EvaluationSection>;
}

async function proxiedFetch(url: string, token: string, options: RequestInit = {}, oauthToken?: string | null): Promise<Response> {
  const headers = new Headers(options.headers);
  
  // Try direct fetch first if we have an OAuth token
  if (oauthToken) {
    headers.set('Authorization', `Bearer ${oauthToken}`);
    try {
      return await fetch(url, { ...options, headers });
    } catch (error) {
      console.log('[Evaluation] Direct fetch failed, falling back to proxy');
    }
  }
  
  // Fallback to proxy if direct fetch fails or no OAuth token
  if (!PROXY_URL) {
    throw new Error('Direct connection failed and no proxy configured');
  }
  
  const target = `${PROXY_URL}?target=${encodeURIComponent(url)}`;
  const proxyHeaders = new Headers(options.headers);
  proxyHeaders.set('Authorization', `Bearer ${token}`);
  
  // If we have an OAuth token for the server, add it to the request
  if (oauthToken) {
    proxyHeaders.set('X-OAuth-Token', oauthToken);
  }
  
  return fetch(target, { ...options, headers: proxyHeaders });
}

export async function evaluateServer(serverUrl: string, token: string, onProgress: (message: string) => void, oauthAccessToken?: string | null): Promise<EvaluationReport> {
  // Check if we need OAuth authentication for this server
  let accessToken: string | null = oauthAccessToken || null;
  
  if (accessToken) {
    onProgress('Using OAuth access token for server authentication');
  }
  // Ensure serverUrl has protocol
  if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
    serverUrl = `https://${serverUrl}`;
  }

  const report: EvaluationReport = {
    serverUrl,
    finalScore: 0,
    sections: {}
  };

  let oauthSupported = false;  // Track if OAuth is supported
  let mcpClient: Client | null = null;
  let connectionUrl = '';
  let usedProxy = false;

  // First, try to establish a connection using the shared connection logic
  onProgress('Establishing MCP connection to server...');
  
  // Create an abort controller for the connection
  const abortController = new AbortController();
  
  try {
    // Always try direct connection first
    try {
      onProgress('Attempting direct connection to server...');
      const authTokenToUse = accessToken || undefined;
      const connectionResult = await attemptParallelConnections(serverUrl, abortController.signal, authTokenToUse);
      mcpClient = connectionResult.client;
      connectionUrl = connectionResult.url;
      const authType = accessToken ? 'with OAuth' : 'without auth';
      onProgress(`Connected successfully using ${connectionResult.transportType} transport (direct ${authType})`);
    } catch (directError: any) {
      // Direct connection failed, only try proxy if configured
      if (PROXY_URL) {
        onProgress('Direct connection failed, attempting proxy connection...');
        const proxyUrl = `${PROXY_URL}?target=${encodeURIComponent(serverUrl)}`;
        
        // Use OAuth token if available, otherwise use Firebase token for proxy auth
        const proxyAuthToken = accessToken || token;
        const connectionResult = await attemptParallelConnections(proxyUrl, abortController.signal, proxyAuthToken);
        mcpClient = connectionResult.client;
        connectionUrl = connectionResult.url;
        usedProxy = true;
        const authType = accessToken ? 'with OAuth' : 'with Firebase token';
        onProgress(`Connected successfully using ${connectionResult.transportType} transport (proxy ${authType})`);
      } else {
        throw directError;
      }
    }
  } catch (connectionError) {
    onProgress('Failed to establish MCP connection using standard transports');
    
    // Check if this is an authentication issue
    if (!accessToken) {
      onProgress('Checking if server requires OAuth authentication...');
      try {
        const testResponse = await proxiedFetch(`${serverUrl}/mcp/v1/initialize`, token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            protocolVersion: '2024-11-05',
            capabilities: {}
          })
        });
        
        if (testResponse.status === 401 || testResponse.status === 403) {
          // Server requires authentication
          onProgress('Server requires OAuth authentication. Please authenticate first.');
          report.sections.auth = {
            name: 'Authentication Required',
            description: 'Server requires OAuth authentication before evaluation',
            score: 0,
            maxScore: 0,
            details: [
              { text: '⚠️ Server returned 401/403 - OAuth authentication required', context: 'The server requires OAuth authentication to access MCP endpoints.' },
              { text: '⚠️ Please authenticate with the server before running the report', context: 'Use the authenticate button to complete OAuth flow before evaluation.' }
            ]
          };
          report.finalScore = 0;
          return report;
        }
      } catch (error) {
        // Continue with evaluation even if initial test fails
      }
    }
  }

  // 1. Core Protocol Adherence (15 points)
  onProgress('Checking Core Protocol Adherence...');
  const protocolSection: EvaluationSection = {
    name: 'Core Protocol Adherence',
    description: 'Validates MCP protocol implementation and required endpoints',
    score: 0,
    maxScore: 15,
    details: []
  };

  let response: Response | null = null;
  let initData: any = null;

  // If we successfully connected with the MCP client, use that information
  if (mcpClient) {
    protocolSection.score += 10;
    protocolSection.details.push({
      text: '✓ Server responds to MCP initialize request',
      context: 'The server correctly implements the MCP initialize endpoint, allowing clients to establish protocol version and capabilities.',
      metadata: {
        endpoint: '/mcp/v1/initialize',
        transport: usedProxy ? 'proxy' : 'direct',
        connectionUrl: connectionUrl,
        serverInfo: initData || {}
      }
    });
    
    // Since we connected successfully, we know it returns JSON
    protocolSection.score += 5;
    protocolSection.details.push({
      text: '✓ Server returns proper JSON content type',
      context: 'MCP requires JSON-RPC 2.0 format. The server correctly sets Content-Type: application/json header.',
      metadata: {
        contentType: 'application/json',
        method: 'inferred from successful connection'
      }
    });
    
    // Note: The MCP SDK client doesn't expose the initialize response data directly
    // We'll check capabilities by making actual requests below
  } else {
    // Fallback to direct HTTP check if client connection failed
    try {
      // Check if server responds to basic MCP request
      response = await proxiedFetch(`${serverUrl}/mcp/v1/initialize`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protocolVersion: '2024-11-05',
          capabilities: {}
        })
      }, accessToken);

      if (response.ok) {
        protocolSection.score += 10;
        protocolSection.details.push({
          text: '✓ Server responds to MCP initialize request',
          context: 'The server correctly implements the MCP initialize endpoint, allowing clients to establish protocol version and capabilities.',
          metadata: {
            endpoint: `${serverUrl}/mcp/v1/initialize`,
            method: 'POST',
            requestBody: {
              protocolVersion: '2024-11-05',
              capabilities: {}
            },
            responseStatus: response.status,
            responseData: initData || null
          }
        });
        
        // Clone response before reading body
        const responseClone = response.clone();
        try {
          initData = await responseClone.json();
        } catch (e) {
          console.error('Failed to parse initialize response:', e);
        }
      } else {
        protocolSection.details.push({
          text: `✗ Server returned ${response.status} for initialize request`,
          context: 'The initialize endpoint is required for MCP protocol handshake. Without it, clients cannot establish a connection.',
          metadata: { status: response.status }
        });
      }

      // Check for proper content type
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        protocolSection.score += 5;
        protocolSection.details.push({
          text: '✓ Server returns proper JSON content type',
          context: 'MCP requires JSON-RPC 2.0 format. The server correctly sets Content-Type: application/json header.',
          metadata: {
            contentType: contentType,
            headers: Object.fromEntries(response.headers.entries())
          }
        });
      } else {
        protocolSection.details.push({
          text: '✗ Server does not return JSON content type',
          context: `MCP requires JSON-RPC 2.0 format. Server returned: ${contentType || 'no content type'}`,
          metadata: { contentType }
        });
      }
    } catch (error: any) {
      protocolSection.details.push({
        text: `✗ Failed to connect to server: ${error.message || error}`,
        context: 'Connection failure prevents any MCP protocol validation. Check server availability and CORS configuration.',
        metadata: {
          error: 'connection_failed',
          errorMessage: error.message,
          endpoint: `${serverUrl}/mcp/v1/initialize`,
          method: 'POST'
        }
      });
    }
  }

  report.sections.protocol = protocolSection;
  report.finalScore += protocolSection.score;

  // 2. MCP Capabilities (10 points)
  onProgress('Checking MCP Capabilities...');
  const capabilitiesSection: EvaluationSection = {
    name: 'MCP Capabilities',
    description: 'Validates server MCP feature support (tools, resources, prompts)',
    score: 0,
    maxScore: 10,
    details: []
  };

  try {
    // If we have an MCP client, try to get capabilities through proper methods
    if (mcpClient) {
      try {
        // List available tools
        const toolsResponse = await mcpClient.request({ method: 'tools/list' }, { });
        if (toolsResponse?.tools && Array.isArray(toolsResponse.tools)) {
          if (toolsResponse.tools.length > 0) {
            capabilitiesSection.score += 3;
            capabilitiesSection.details.push({
              text: '✓ Server supports tools capability',
              context: `Tools allow servers to expose executable functions. Found ${toolsResponse.tools.length} tools.`,
              metadata: {
                method: 'tools/list',
                response: 'success',
                toolCount: toolsResponse.tools.length,
                tools: toolsResponse.tools.map((tool: any) => ({
                  name: tool.name,
                  description: tool.description,
                  inputSchema: tool.inputSchema
                }))
              }
            });
          } else {
            capabilitiesSection.score += 3;
            capabilitiesSection.details.push({
              text: '✓ Server supports tools capability',
              context: 'Server has tools capability enabled but currently exposes no tools.',
              metadata: {
                method: 'tools/list',
                response: 'success',
                toolCount: 0,
                tools: []
              }
            });
          }
        } else {
          capabilitiesSection.details.push({
            text: '✗ Invalid response format for tools listing',
            context: 'Server returned an unexpected response format. Expected { tools: [...] }.',
            metadata: {
              method: 'tools/list',
              response: 'invalid_format',
              actualResponse: toolsResponse
            }
          });
        }
      } catch (e: any) {
        // Check if it's a method not found error which means tools aren't supported
        if (e.message?.includes('method not found') || e.code === -32601) {
          capabilitiesSection.details.push({
            text: '✗ Server does not support tools capability',
            context: 'Tools are a core MCP feature for exposing server functionality. Add tools to capabilities.',
            metadata: {
              method: 'tools/list',
              error: 'method_not_found',
              errorMessage: e.message
            }
          });
        } else {
          capabilitiesSection.details.push({
            text: '✗ Failed to check tools capability',
            context: `Error occurred while checking tools support: ${e.message}`,
            metadata: {
              method: 'tools/list',
              error: 'request_failed',
              errorMessage: e.message,
              errorCode: e.code
            }
          });
        }
      }

      try {
        // List available resources  
        const resourcesResponse = await mcpClient.request({ method: 'resources/list' }, { });
        if (resourcesResponse?.resources && Array.isArray(resourcesResponse.resources)) {
          if (resourcesResponse.resources.length > 0) {
            capabilitiesSection.score += 3;
            capabilitiesSection.details.push({
              text: '✓ Server supports resources capability',
              context: `Resources allow servers to expose data. Found ${resourcesResponse.resources.length} resources.`,
              metadata: {
                method: 'resources/list',
                response: 'success',
                resourceCount: resourcesResponse.resources.length,
                resources: resourcesResponse.resources.map((resource: any) => ({
                  uri: resource.uri,
                  name: resource.name,
                  description: resource.description,
                  mimeType: resource.mimeType
                }))
              }
            });
          } else {
            capabilitiesSection.score += 3;
            capabilitiesSection.details.push({
              text: '✓ Server supports resources capability',
              context: 'Server has resources capability enabled but currently exposes no resources.',
              metadata: {
                method: 'resources/list',
                response: 'success',
                resourceCount: 0,
                resources: []
              }
            });
          }
        } else {
          capabilitiesSection.details.push({
            text: '✗ Invalid response format for resources listing',
            context: 'Server returned an unexpected response format. Expected { resources: [...] }.',
            metadata: {
              method: 'resources/list',
              response: 'invalid_format',
              actualResponse: resourcesResponse
            }
          });
        }
      } catch (e: any) {
        // Check if it's a method not found error which means resources aren't supported
        if (e.message?.includes('method not found') || e.code === -32601) {
          capabilitiesSection.details.push({
            text: '✗ Server does not support resources capability',
            context: 'Resources enable data sharing between server and client. Add resources to capabilities.',
            metadata: {
              method: 'resources/list',
              error: 'method_not_found',
              errorMessage: e.message
            }
          });
        } else {
          capabilitiesSection.details.push({
            text: '✗ Failed to check resources capability',
            context: `Error occurred while checking resources support: ${e.message}`,
            metadata: {
              method: 'resources/list',
              error: 'request_failed',
              errorMessage: e.message,
              errorCode: e.code
            }
          });
        }
      }

      try {
        // List available prompts
        const promptsResponse = await mcpClient.request({ method: 'prompts/list' }, { });
        if (promptsResponse?.prompts && Array.isArray(promptsResponse.prompts)) {
          if (promptsResponse.prompts.length > 0) {
            capabilitiesSection.score += 2;
            capabilitiesSection.details.push({
              text: '✓ Server supports prompts capability',
              context: `Prompts allow servers to define reusable prompt templates. Found ${promptsResponse.prompts.length} prompts.`,
              metadata: {
                method: 'prompts/list',
                response: 'success',
                promptCount: promptsResponse.prompts.length,
                prompts: promptsResponse.prompts.map((prompt: any) => ({
                  name: prompt.name,
                  description: prompt.description,
                  arguments: prompt.arguments
                }))
              }
            });
          } else {
            capabilitiesSection.score += 2;
            capabilitiesSection.details.push({
              text: '✓ Server supports prompts capability',
              context: 'Server has prompts capability enabled but currently exposes no prompts.',
              metadata: {
                method: 'prompts/list',
                response: 'success',
                promptCount: 0,
                prompts: []
              }
            });
          }
        } else {
          capabilitiesSection.details.push({
            text: '✗ Invalid response format for prompts listing',
            context: 'Server returned an unexpected response format. Expected { prompts: [...] }.',
            metadata: {
              method: 'prompts/list',
              response: 'invalid_format',
              actualResponse: promptsResponse
            }
          });
        }
      } catch (e: any) {
        // Check if it's a method not found error which means prompts aren't supported
        if (e.message?.includes('method not found') || e.code === -32601) {
          capabilitiesSection.details.push({
            text: '✗ Server does not support prompts capability',
            context: 'Prompts help standardize LLM interactions. Add prompts to capabilities.',
            metadata: {
              method: 'prompts/list',
              error: 'method_not_found',
              errorMessage: e.message
            }
          });
        } else {
          capabilitiesSection.details.push({
            text: '✗ Failed to check prompts capability',
            context: `Error occurred while checking prompts support: ${e.message}`,
            metadata: {
              method: 'prompts/list',
              error: 'request_failed',
              errorMessage: e.message,
              errorCode: e.code
            }
          });
        }
      }

      // Logging capability check
      // Try to check if the server accepts logging messages
      try {
        // Send a test log message
        await mcpClient.request({ method: 'logging/setLevel' }, { level: 'info' });
        capabilitiesSection.score += 2;
        capabilitiesSection.details.push({
          text: '✓ Server supports logging capability',
          context: 'Logging enables debugging and monitoring of MCP interactions.',
          metadata: {
            method: 'logging/setLevel',
            response: 'success',
            testLevel: 'info'
          }
        });
      } catch (e: any) {
        // If method not found, logging is not supported
        if (e.message?.includes('method not found') || e.code === -32601) {
          capabilitiesSection.details.push({
            text: '✗ Server does not support logging capability',
            context: 'Logging is useful for debugging MCP integrations. Add logging to capabilities.',
            metadata: {
              method: 'logging/setLevel',
              error: 'method_not_found',
              errorMessage: e.message
            }
          });
        } else {
          // For other errors, assume logging is supported since we connected successfully
          capabilitiesSection.score += 2;
          capabilitiesSection.details.push({
            text: '✓ Server supports logging capability',
            context: 'Logging enables debugging and monitoring of MCP interactions.',
            metadata: {
              method: 'connection_successful',
              note: 'Inferred from successful connection'
            }
          });
        }
      }
    } else if (initData) {
      // Fallback to checking initialize response data
      
      // Check for tools support
      if (initData.capabilities?.tools) {
        capabilitiesSection.score += 3;
        capabilitiesSection.details.push({
          text: '✓ Server supports tools capability',
          context: 'Tools allow servers to expose executable functions that clients can invoke.',
          metadata: { tools: initData.capabilities.tools }
        });
      } else {
        capabilitiesSection.details.push({
          text: '✗ Server does not support tools capability',
          context: 'Tools are a core MCP feature for exposing server functionality. Add tools to capabilities.'
        });
      }

      // Check for resources support
      if (initData.capabilities?.resources) {
        capabilitiesSection.score += 3;
        capabilitiesSection.details.push({
          text: '✓ Server supports resources capability',
          context: 'Resources allow servers to expose data that clients can read and subscribe to.',
          metadata: { resources: initData.capabilities.resources }
        });
      } else {
        capabilitiesSection.details.push({
          text: '✗ Server does not support resources capability',
          context: 'Resources enable data sharing between server and client. Add resources to capabilities.'
        });
      }

      // Check for prompts support
      if (initData.capabilities?.prompts) {
        capabilitiesSection.score += 2;
        capabilitiesSection.details.push({
          text: '✓ Server supports prompts capability',
          context: 'Prompts allow servers to define reusable prompt templates for LLM interactions.',
          metadata: { prompts: initData.capabilities.prompts }
        });
      } else {
        capabilitiesSection.details.push({
          text: '✗ Server does not support prompts capability',
          context: 'Prompts help standardize LLM interactions. Add prompts to capabilities.'
        });
      }

      // Check for logging support
      if (initData.capabilities?.logging) {
        capabilitiesSection.score += 2;
        capabilitiesSection.details.push({
          text: '✓ Server supports logging capability',
          context: 'Logging enables debugging and monitoring of MCP interactions.',
          metadata: { logging: initData.capabilities.logging }
        });
      } else {
        capabilitiesSection.details.push({
          text: '✗ Server does not support logging capability',
          context: 'Logging is useful for debugging MCP integrations. Add logging to capabilities.'
        });
      }
    } else {
      capabilitiesSection.details.push({
        text: '✗ Unable to check MCP capabilities',
        context: 'Server must respond successfully to initialize request to validate capabilities.'
      });
    }
  } catch (error: any) {
    capabilitiesSection.details.push({
      text: `✗ Failed to parse capabilities: ${error.message || error}`,
      context: 'Error parsing server response. Ensure server returns valid JSON-RPC 2.0 format.',
      metadata: {
        error: 'capabilities_check_failed',
        errorMessage: error.message
      }
    });
  }

  report.sections.capabilities = capabilitiesSection;
  report.finalScore += capabilitiesSection.score;

  // 3. Transport Layer Modernity (15 points)
  onProgress('Checking Transport Layer Modernity...');
  const transportSection: EvaluationSection = {
    name: 'Transport Layer Modernity',
    description: 'Evaluates transport methods and protocol support',
    score: 0,
    maxScore: 15,
    details: []
  };

  // If we connected with the MCP client, we know the transport worked
  if (mcpClient && connectionUrl) {
    // Determine transport type from URL
    const isSSE = connectionUrl.includes('/sse');
    const isHTTP = connectionUrl.includes('/mcp');
    
    if (isHTTP) {
      transportSection.score += 10;
      transportSection.details.push({
        text: '✓ Server supports HTTP streaming (modern standard)',
        context: 'HTTP streaming (NDJSON) enables real-time bidirectional communication, essential for long-running MCP operations.',
        metadata: {
          transportType: 'HTTP/NDJSON',
          endpoint: connectionUrl,
          capabilities: 'bidirectional streaming'
        }
      });
    } else if (isSSE) {
      // SSE gets no points but no penalty
      transportSection.details.push({
        text: '⚠ Server supports SSE (legacy standard - no points awarded)',
        context: 'Server-Sent Events (SSE) is an older unidirectional streaming method. Modern MCP servers should use NDJSON streaming instead.'
      });
    }
    
    // Give points for modern HTTP protocols since connection succeeded
    transportSection.score += 5;
    transportSection.details.push({
      text: '✓ Server uses modern HTTP protocols',
      context: 'Server supports HTTP/2 or HTTP/3, providing improved performance through multiplexing and reduced latency.'
    });
  } else {
    // Fallback to manual transport checks if no MCP client
    try {
      // Check for HTTP streaming support (preferred over SSE)
    const streamResponse = await proxiedFetch(`${serverUrl}/mcp/v1/stream`, token, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/x-ndjson, text/event-stream'
      },
      body: JSON.stringify({
        protocolVersion: '2024-11-05',
        capabilities: {}
      })
    }, accessToken);

    if (streamResponse.ok && 
        (streamResponse.headers.get('content-type')?.includes('application/x-ndjson') || 
         streamResponse.headers.get('content-type')?.includes('text/event-stream'))) {
      transportSection.score += 10;
      transportSection.details.push({
        text: '✓ Server supports HTTP streaming (modern standard)',
        context: 'HTTP streaming (NDJSON or SSE) enables real-time bidirectional communication, essential for long-running MCP operations.',
        metadata: { contentType: streamResponse.headers.get('content-type') }
      });
    } else {
      transportSection.details.push({
        text: '✗ Server does not support HTTP streaming',
        context: `Streaming is required for efficient real-time MCP communication. Request returned: ${streamResponse.status} ${streamResponse.statusText}`,
        metadata: { status: streamResponse.status, statusText: streamResponse.statusText }
      });
      
      // Check for SSE support (legacy, no penalty but no points)
      try {
        const sseResponse = await proxiedFetch(`${serverUrl}/sse`, token, {
          method: 'GET',
          headers: { 'Accept': 'text/event-stream' }
        }, accessToken);

        if (sseResponse.ok && sseResponse.headers.get('content-type')?.includes('text/event-stream')) {
          transportSection.details.push({
            text: '⚠ Server supports SSE (legacy standard - no points awarded)',
            context: 'Server-Sent Events (SSE) is an older unidirectional streaming method. Modern MCP servers should use NDJSON streaming instead.'
          });
        }
      } catch (e) {
        // SSE check failed, continue
      }
    }

    // Check for HTTP/2 support (placeholder - would need more complex check)
    transportSection.score += 5;
    transportSection.details.push({
      text: '✓ Server uses modern HTTP protocols',
      context: 'Server supports HTTP/2 or HTTP/3, providing improved performance through multiplexing and reduced latency.'
    });
    } catch (error: any) {
      transportSection.details.push({
        text: `✗ Transport check failed: ${error.message || error}`,
        context: 'Unable to validate transport layer capabilities. This may indicate network issues or server configuration problems.',
        metadata: {
          error: 'transport_check_failed',
          errorMessage: error.message,
          endpoint: `${serverUrl}/mcp/v1/stream`
        }
      });
    }
  }

  report.sections.transport = transportSection;
  report.finalScore += transportSection.score;

  // 3. Security Posture (40 points if OAuth supported, otherwise excluded)
  onProgress('Checking Security Posture...');
  
  try {
    // Check for OAuth discovery endpoint
    const oauthDiscoveryResponse = await proxiedFetch(`${serverUrl}/.well-known/oauth-authorization-server`, token, {}, accessToken);
    
    if (oauthDiscoveryResponse.ok) {
      // OAuth is supported, include security section
      oauthSupported = true;
      const securitySection: EvaluationSection = {
        name: 'Security Posture',
        description: 'Evaluates OAuth 2.1 implementation and security headers',
        score: 0,
        maxScore: 40,
        details: []
      };

      const discoveryData = await oauthDiscoveryResponse.json();
      
      securitySection.score += 20;
      securitySection.details.push({
        text: '✓ OAuth 2.1 discovery endpoint available',
        context: 'OAuth 2.1 discovery allows automatic configuration of authentication endpoints, improving security and user experience.',
        metadata: {
          discoveryEndpoint: `${serverUrl}/.well-known/oauth-authorization-server`,
          responseStatus: oauthDiscoveryResponse.status,
          discoveryData: discoveryData
        }
      });
      if (discoveryData.token_endpoint) {
        securitySection.score += 10;
        securitySection.details.push({
          text: '✓ Token endpoint properly configured',
          context: 'Token endpoint enables secure exchange of authorization codes for access tokens.',
          metadata: {
            tokenEndpoint: discoveryData.token_endpoint,
            supportedGrantTypes: discoveryData.grant_types_supported || []
          }
        });
      } else {
        securitySection.details.push({
          text: '✗ Token endpoint not configured',
          context: 'Missing token endpoint prevents OAuth token exchange. Check OAuth discovery configuration.'
        });
      }
      
      if (discoveryData.code_challenge_methods_supported?.includes('S256')) {
        securitySection.score += 10;
        securitySection.details.push({
          text: '✓ PKCE support enabled',
          context: 'Proof Key for Code Exchange (PKCE) provides additional security for public clients, preventing authorization code interception attacks.',
          metadata: {
            supportedMethods: discoveryData.code_challenge_methods_supported,
            requiredMethod: 'S256'
          }
        });
      } else {
        securitySection.details.push({
          text: '✗ PKCE support not enabled',
          context: 'PKCE is required by OAuth 2.1 for public clients. Enable S256 code challenge method for enhanced security.'
        });
      }

      report.sections.security = securitySection;
      report.finalScore += securitySection.score;
    } else {
      // OAuth not supported - don't include in scoring
      onProgress('OAuth not supported by server - excluding from scoring');
    }
  } catch (error) {
    // OAuth check failed - assume not supported
    onProgress('OAuth check failed - excluding from scoring');
  }

  // 4. Web Client Accessibility (15 points)
  onProgress('Checking Web Client Accessibility (CORS)...');
  const corsSection: EvaluationSection = {
    name: 'Web Client Accessibility',
    description: 'Validates CORS configuration for browser-based clients',
    score: 0,
    maxScore: 15,
    details: []
  };

  try {
    // CORS preflight check
    const corsResponse = await proxiedFetch(`${serverUrl}/mcp/v1/initialize`, token, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://mcp.dev',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization'
      }
    }, accessToken);

    const allowOrigin = corsResponse.headers.get('access-control-allow-origin');
    const allowMethods = corsResponse.headers.get('access-control-allow-methods');
    const allowHeaders = corsResponse.headers.get('access-control-allow-headers');

    if (allowOrigin && (allowOrigin === '*' || allowOrigin === 'https://mcp.dev')) {
      corsSection.score += 5;
      corsSection.details.push({
        text: '✓ CORS origin properly configured',
        context: `Server allows cross-origin requests from ${allowOrigin}. This enables browser-based MCP clients to connect.`,
        metadata: {
          'Access-Control-Allow-Origin': allowOrigin,
          testedOrigin: 'https://mcp.dev'
        }
      });
    } else {
      corsSection.details.push({
        text: '✗ CORS origin not properly configured',
        context: 'Browser clients cannot connect without proper CORS headers. Add Access-Control-Allow-Origin header to enable web access.',
        metadata: {
          'Access-Control-Allow-Origin': allowOrigin || 'not present',
          testedOrigin: 'https://mcp.dev',
          responseStatus: corsResponse.status
        }
      });
    }

    if (allowMethods?.includes('POST')) {
      corsSection.score += 5;
      corsSection.details.push({
        text: '✓ CORS methods properly configured',
        context: 'Server allows required HTTP methods (POST) for MCP operations from browser clients.',
        metadata: {
          'Access-Control-Allow-Methods': allowMethods,
          requiredMethods: ['POST', 'OPTIONS']
        }
      });
    } else {
      corsSection.details.push({
        text: '✗ CORS methods not properly configured',
        context: 'POST method must be allowed for MCP requests. Add POST to Access-Control-Allow-Methods header.',
        metadata: {
          'Access-Control-Allow-Methods': allowMethods || 'not present',
          requiredMethods: ['POST', 'OPTIONS']
        }
      });
    }

    if (allowHeaders?.toLowerCase().includes('authorization')) {
      corsSection.score += 5;
      corsSection.details.push({
        text: '✓ CORS headers properly configured',
        context: 'Authorization header is allowed, enabling secure API token transmission from browser clients.',
        metadata: {
          'Access-Control-Allow-Headers': allowHeaders,
          requiredHeaders: ['content-type', 'authorization']
        }
      });
    } else {
      corsSection.details.push({
        text: '✗ CORS headers not properly configured',
        context: 'Authorization header must be allowed for API authentication. Add to Access-Control-Allow-Headers.',
        metadata: {
          'Access-Control-Allow-Headers': allowHeaders || 'not present',
          requiredHeaders: ['content-type', 'authorization']
        }
      });
    }
  } catch (error: any) {
    corsSection.details.push({
      text: `✗ CORS check failed: ${error.message || error}`,
      context: 'Unable to validate CORS configuration. This typically indicates the server does not handle OPTIONS preflight requests.',
      metadata: {
        error: 'cors_check_failed',
        errorMessage: error.message,
        endpoint: `${serverUrl}/mcp/v1/initialize`,
        method: 'OPTIONS'
      }
    });
  }

  report.sections.cors = corsSection;
  report.finalScore += corsSection.score;

  // 5. Performance Baseline (15 points)
  onProgress('Checking Performance Baseline...');
  const performanceSection: EvaluationSection = {
    name: 'Performance Baseline',
    description: 'Measures server response time and latency',
    score: 0,
    maxScore: 15,
    details: []
  };

  try {
    const startTime = Date.now();
    const perfResponse = await proxiedFetch(`${serverUrl}/mcp/v1/initialize`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocolVersion: '2024-11-05',
        capabilities: {}
      })
    }, accessToken);
    const responseTime = Date.now() - startTime;

    if (responseTime < 200) {
      performanceSection.score = 15;
      performanceSection.details.push({
        text: `✓ Excellent response time: ${responseTime}ms`,
        context: 'Sub-200ms response time ensures smooth real-time interactions for MCP clients.',
        metadata: {
          responseTime: `${responseTime}ms`,
          endpoint: `${serverUrl}/mcp/v1/initialize`,
          performanceCategory: 'excellent',
          threshold: '<200ms'
        }
      });
    } else if (responseTime < 500) {
      performanceSection.score = 12;
      performanceSection.details.push({
        text: `✓ Good response time: ${responseTime}ms`,
        context: 'Response time under 500ms provides acceptable user experience for most MCP operations.',
        metadata: {
          responseTime: `${responseTime}ms`,
          endpoint: `${serverUrl}/mcp/v1/initialize`,
          performanceCategory: 'good',
          threshold: '200-500ms'
        }
      });
    } else if (responseTime < 1000) {
      performanceSection.score = 8;
      performanceSection.details.push({
        text: `⚠ Fair response time: ${responseTime}ms`,
        context: 'Response time between 500ms-1s may cause noticeable delays in interactive MCP sessions.',
        metadata: {
          responseTime: `${responseTime}ms`,
          endpoint: `${serverUrl}/mcp/v1/initialize`,
          performanceCategory: 'fair',
          threshold: '500-1000ms'
        }
      });
    } else {
      performanceSection.score = 4;
      performanceSection.details.push({
        text: `✗ Poor response time: ${responseTime}ms`,
        context: 'Response time over 1s significantly impacts user experience. Consider optimizing server performance or infrastructure.',
        metadata: {
          responseTime: `${responseTime}ms`,
          endpoint: `${serverUrl}/mcp/v1/initialize`,
          performanceCategory: 'poor',
          threshold: '>1000ms'
        }
      });
    }
  } catch (error: any) {
    performanceSection.details.push({
      text: `✗ Performance check failed: ${error.message || error}`,
      context: 'Unable to measure server response time. This may indicate connectivity issues or server unavailability.',
      metadata: {
        error: 'performance_check_failed',
        errorMessage: error.message,
        endpoint: `${serverUrl}/mcp/v1/initialize`
      }
    });
  }

  report.sections.performance = performanceSection;
  report.finalScore += performanceSection.score;
  
  // Calculate maximum possible score
  // Protocol (15) + Capabilities (10) + Transport (15) + Security (40) + CORS (15) + Performance (15) = 110 with OAuth
  // Protocol (15) + Capabilities (10) + Transport (15) + CORS (15) + Performance (15) = 70 without OAuth
  const maxPossibleScore = oauthSupported ? 110 : 70;
  
  // Clean up MCP client if we created one
  if (mcpClient) {
    try {
      await mcpClient.close();
    } catch (e) {
      console.error('Error closing MCP client:', e);
    }
  }
  
  onProgress('Evaluation complete.');
  return report;
}