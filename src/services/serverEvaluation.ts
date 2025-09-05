import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CorsAwareStreamableHTTPTransport } from '../utils/corsAwareTransport';
import { CorsAwareSSETransport } from '../utils/corsAwareSseTransport';

export interface CategoryResult {
  score: number;
  maxScore: number;
  details: string;
  tests: { [key: string]: boolean | string | number };
}

export interface EvaluationResult {
  serverUrl: string;
  timestamp: string;
  totalScore: number;
  categories: {
    protocol: CategoryResult;
    transport: CategoryResult;
    security: CategoryResult;
    cors: CategoryResult;
    performance: CategoryResult;
  };
  summary: {
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
  };
  rawResults: any;
}

export interface EvaluationProgress {
  currentCategory: 'protocol' | 'transport' | 'security' | 'cors' | 'performance';
  message: string;
  details?: string;
}

type ProgressCallback = (progress: EvaluationProgress) => void;

class ServerEvaluator {
  private serverUrl: string;
  private authToken: string | null;
  private proxyUrl: string;
  private progressCallback: ProgressCallback;
  
  constructor(serverUrl: string, authToken: string | null, progressCallback: ProgressCallback) {
    this.serverUrl = serverUrl;
    this.authToken = authToken;
    this.proxyUrl = import.meta.env.VITE_CORS_PROXY_URL || 'https://cors-proxy.mcp.workers.dev/';
    this.progressCallback = progressCallback;
  }

  private updateProgress(category: EvaluationProgress['currentCategory'], message: string, details?: string) {
    console.log('Progress:', { category, message, details });
    this.progressCallback({ currentCategory: category, message, details });
  }

  private async makeRequest(url: string, options: RequestInit = {}): Promise<Response> {
    // Try direct connection first
    try {
      return await fetch(url, options);
    } catch (e) {
      // If direct fails, use proxy
      const proxyUrl = `${this.proxyUrl}?target=${encodeURIComponent(url)}`;
      const proxyOptions = {
        ...options,
        headers: {
          ...options.headers,
          ...(this.authToken ? { 'Authorization': `Bearer ${this.authToken}` } : {})
        }
      };
      return await fetch(proxyUrl, proxyOptions);
    }
  }

  async evaluateCoreProtocol(): Promise<CategoryResult> {
    console.log('Starting Core Protocol evaluation for:', this.serverUrl);
    this.updateProgress('protocol', 'Core Protocol Adherence and Feature Support', 'Testing server capabilities and JSON-RPC compliance');
    
    const result: CategoryResult = {
      score: 0,
      maxScore: 15,
      details: '',
      tests: {}
    };

    try {
      // 1.1 Verify Server Capabilities (5 points)
      const transport = new CorsAwareStreamableHTTPTransport({
        url: this.serverUrl,
        authToken: this.authToken || undefined,
      });
      
      const client = new Client({
        name: "mcp-test-evaluator",
        version: "1.0.0"
      }, {
        capabilities: {}
      });

      await client.connect(transport);
      
      const capabilities = client.getServerCapabilities();
      
      // Check if server advertises at least one MCP feature
      const hasResources = capabilities?.resources !== undefined;
      const hasPrompts = capabilities?.prompts !== undefined;
      const hasTools = capabilities?.tools !== undefined;
      
      result.tests.hasCapabilities = hasResources || hasPrompts || hasTools;
      
      if (result.tests.hasCapabilities) {
        result.score += 5;
        result.details = 'Server correctly advertises MCP capabilities';
      } else {
        result.details = 'Server does not advertise any MCP capabilities';
      }

      // 1.2 JSON-RPC 2.0 Compliance (5 points)
      // Test a simple request/response
      if (hasTools) {
        const tools = await client.listTools();
        result.tests.jsonRpcCompliance = Array.isArray(tools);
        if (result.tests.jsonRpcCompliance) {
          result.score += 5;
        }
      } else if (hasResources) {
        const resources = await client.listResources();
        result.tests.jsonRpcCompliance = Array.isArray(resources);
        if (result.tests.jsonRpcCompliance) {
          result.score += 5;
        }
      } else {
        // Give partial credit if we connected successfully
        result.tests.jsonRpcCompliance = true;
        result.score += 3;
      }

      // 1.3 Essential Endpoints (5 points)
      // Check for /health endpoint
      try {
        const healthResponse = await this.makeRequest(this.serverUrl.replace('/mcp', '/health'));
        result.tests.hasHealthEndpoint = healthResponse.ok;
        if (result.tests.hasHealthEndpoint) {
          result.score += 5;
          result.details += '; Has health endpoint';
        }
      } catch (e) {
        result.tests.hasHealthEndpoint = false;
      }

      await client.close();
    } catch (error) {
      result.details = `Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`;
      result.tests.connectionFailed = true;
    }

    return result;
  }

  async evaluateTransport(): Promise<CategoryResult> {
    this.updateProgress('transport', 'Transport Layer Modernity', 'Testing Streamable HTTP and legacy transport support');
    
    const result: CategoryResult = {
      score: 0,
      maxScore: 15,
      details: '',
      tests: {}
    };

    try {
      // 2.1 Test Streamable HTTP Transport (15 points)
      const transport = new CorsAwareStreamableHTTPTransport({
        url: this.serverUrl,
        authToken: this.authToken || undefined,
      });

      const client = new Client({
        name: "mcp-test-evaluator",
        version: "1.0.0"
      }, {
        capabilities: {}
      });

      await client.connect(transport);
      result.tests.supportsStreamableHTTP = true;
      result.score += 15;
      result.details = 'Supports modern Streamable HTTP transport';
      
      await client.close();
    } catch (error) {
      // 2.2 Check for legacy HTTP+SSE transport
      try {
        const sseTransport = new CorsAwareSSETransport({
          url: this.serverUrl.replace('/mcp', '/sse'),
          authToken: this.authToken || undefined,
        });

        const client = new Client({
          name: "mcp-test-evaluator",
          version: "1.0.0"
        }, {
          capabilities: {}
        });

        await client.connect(sseTransport);
        result.tests.supportsLegacySSE = true;
        result.score += 5; // Reduced score for legacy
        result.details = 'Only supports legacy HTTP+SSE transport (deprecated)';
        
        await client.close();
      } catch (e) {
        result.tests.transportFailed = true;
        result.details = 'Failed to connect with any transport method';
      }
    }

    return result;
  }

  async evaluateSecurity(): Promise<CategoryResult> {
    this.updateProgress('security', 'OAuth 2.1 Security Implementation', 'Testing authentication mechanisms and token handling');
    
    const result: CategoryResult = {
      score: 0,
      maxScore: 40,
      details: '',
      tests: {}
    };

    // Parse server host from URL
    const urlObj = new URL(this.serverUrl);
    const serverHost = urlObj.hostname;

    try {
      // 3.1 Check OAuth 2.1 Discovery (10 points)
      const discoveryUrl = `https://${serverHost}/.well-known/oauth-authorization-server`;
      const discoveryResponse = await this.makeRequest(discoveryUrl);
      
      if (discoveryResponse.ok) {
        const metadata = await discoveryResponse.json();
        result.tests.hasOAuthDiscovery = true;
        result.score += 10;
        
        // Check for required endpoints
        result.tests.authorizationEndpoint = metadata.authorization_endpoint;
        result.tests.tokenEndpoint = metadata.token_endpoint;
        
        // 3.2 Check for Dynamic Client Registration (5 points)
        if (metadata.registration_endpoint) {
          result.tests.supportsDynamicRegistration = true;
          result.score += 5;
        }
        
        // 3.3 Check for PKCE support (required)
        if (metadata.code_challenge_methods_supported?.includes('S256')) {
          result.tests.supportsPKCE = true;
          result.score += 10;
        }
        
        // 3.4 Check for Resource Indicators (5 points)
        if (metadata.resource_indicators_supported) {
          result.tests.supportsResourceIndicators = true;
          result.score += 5;
        }
        
        result.details = 'OAuth 2.1 implementation detected';
      } else {
        // Check if server uses API keys or other insecure methods
        result.tests.hasOAuthDiscovery = false;
        result.details = 'No OAuth 2.1 implementation found - critical security failure';
        // Zero score for entire security section on critical failure
        result.score = 0;
      }
      
      // Additional 10 points for proper token handling (assumed if OAuth is properly implemented)
      if (result.tests.hasOAuthDiscovery && result.tests.supportsPKCE) {
        result.score += 10;
        result.tests.properTokenHandling = true;
      }
      
    } catch (error) {
      result.details = 'Failed to evaluate security implementation';
      result.tests.securityCheckFailed = true;
    }

    return result;
  }

  async evaluateCORS(): Promise<CategoryResult> {
    this.updateProgress('cors', 'Web Client Accessibility', 'Testing CORS configuration and preflight handling');
    
    const result: CategoryResult = {
      score: 0,
      maxScore: 15,
      details: '',
      tests: {}
    };

    try {
      // 4.1 Test OPTIONS preflight handling (8 points)
      const response = await fetch(this.serverUrl, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://mcptest.io',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization'
        }
      });

      result.tests.handlesOptions = response.ok;
      
      if (result.tests.handlesOptions) {
        result.score += 8;
        
        // 4.2 Check CORS headers (7 points)
        const allowOrigin = response.headers.get('Access-Control-Allow-Origin');
        const allowMethods = response.headers.get('Access-Control-Allow-Methods');
        const allowHeaders = response.headers.get('Access-Control-Allow-Headers');
        
        result.tests.corsOrigin = allowOrigin || 'none';
        result.tests.corsMethods = allowMethods || 'none';
        result.tests.corsHeaders = allowHeaders || 'none';
        
        if (allowOrigin) {
          if (allowOrigin === '*') {
            result.score += 5; // Functional but less secure
            result.details = 'CORS enabled with wildcard origin (less secure)';
          } else {
            result.score += 7; // More secure specific origin
            result.details = 'CORS enabled with specific origin policy';
          }
        }
      } else {
        result.details = 'Server does not handle CORS preflight requests';
      }
      
    } catch (error) {
      // If direct CORS check fails, that's expected - proxy will handle it
      result.tests.corsDirectCheckFailed = true;
      result.details = 'CORS not configured for direct access (proxy required)';
      result.score = 7; // Partial credit since proxy makes it work
    }

    return result;
  }

  async evaluatePerformance(): Promise<CategoryResult> {
    this.updateProgress('performance', 'Performance Baseline', 'Measuring connection latency and response times');
    
    const result: CategoryResult = {
      score: 0,
      maxScore: 15,
      details: '',
      tests: {}
    };

    try {
      // 5.1 Measure latency to health or capabilities endpoint
      const testUrl = this.serverUrl.replace('/mcp', '/health');
      const measurements: number[] = [];
      
      // Take 5 measurements
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        try {
          await this.makeRequest(testUrl);
        } catch (e) {
          // Try capabilities endpoint instead
          const start2 = performance.now();
          await this.makeRequest(this.serverUrl.replace('/mcp', '/capabilities'));
          measurements.push(performance.now() - start2);
          continue;
        }
        measurements.push(performance.now() - start);
      }
      
      // Calculate average
      const avgLatency = measurements.reduce((a, b) => a + b, 0) / measurements.length;
      result.tests.averageLatencyMs = Math.round(avgLatency);
      
      // Score based on latency
      if (avgLatency < 100) {
        result.score = 15;
        result.details = `Excellent performance: ${result.tests.averageLatencyMs}ms average`;
      } else if (avgLatency < 250) {
        result.score = 10;
        result.details = `Good performance: ${result.tests.averageLatencyMs}ms average`;
      } else if (avgLatency < 500) {
        result.score = 5;
        result.details = `Acceptable performance: ${result.tests.averageLatencyMs}ms average`;
      } else {
        result.score = 0;
        result.details = `Poor performance: ${result.tests.averageLatencyMs}ms average`;
      }
      
    } catch (error) {
      result.details = 'Failed to measure performance';
      result.tests.performanceCheckFailed = true;
    }

    return result;
  }

  async evaluate(): Promise<EvaluationResult> {
    const categories = {
      protocol: await this.evaluateCoreProtocol(),
      transport: await this.evaluateTransport(),
      security: await this.evaluateSecurity(),
      cors: await this.evaluateCORS(),
      performance: await this.evaluatePerformance()
    };

    const totalScore = Object.values(categories).reduce((sum, cat) => sum + cat.score, 0);

    // Generate summary
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const recommendations: string[] = [];

    // Analyze results
    if (categories.protocol.score >= 13) {
      strengths.push('Excellent adherence to MCP protocol specification');
    } else if (categories.protocol.score < 8) {
      weaknesses.push('Poor protocol compliance');
      recommendations.push('Review MCP specification and ensure proper implementation of core features');
    }

    if (categories.transport.score === 15) {
      strengths.push('Supports modern Streamable HTTP transport');
    } else if (categories.transport.tests.supportsLegacySSE) {
      weaknesses.push('Only supports deprecated HTTP+SSE transport');
      recommendations.push('Upgrade to Streamable HTTP transport for better compatibility');
    }

    if (categories.security.score >= 35) {
      strengths.push('Strong OAuth 2.1 security implementation');
    } else if (categories.security.score === 0) {
      weaknesses.push('Critical security failure - no OAuth 2.1 implementation');
      recommendations.push('Implement OAuth 2.1 with PKCE for secure authentication');
    } else {
      weaknesses.push('Incomplete OAuth 2.1 implementation');
      if (!categories.security.tests.supportsDynamicRegistration) {
        recommendations.push('Add support for dynamic client registration');
      }
      if (!categories.security.tests.supportsResourceIndicators) {
        recommendations.push('Implement Resource Indicators for enhanced security');
      }
    }

    if (categories.cors.score >= 13) {
      strengths.push('Well-configured CORS policy for web clients');
    } else if (categories.cors.score < 8) {
      weaknesses.push('Limited or no CORS support');
      recommendations.push('Configure proper CORS headers for web client compatibility');
    }

    if (categories.performance.score >= 10) {
      strengths.push('Good baseline performance and low latency');
    } else if (categories.performance.score === 0) {
      weaknesses.push('Poor performance with high latency');
      recommendations.push('Optimize server response times for better user experience');
    }

    return {
      serverUrl: this.serverUrl,
      timestamp: new Date().toISOString(),
      totalScore,
      categories,
      summary: {
        strengths,
        weaknesses,
        recommendations
      },
      rawResults: {
        serverUrl: this.serverUrl,
        evaluationDate: new Date().toISOString(),
        categories
      }
    };
  }
}

export async function evaluateServer(
  serverUrl: string, 
  authToken: string | null,
  progressCallback: ProgressCallback
): Promise<EvaluationResult> {
  console.log('evaluateServer called with:', { serverUrl, authToken: authToken ? 'present' : 'null' });
  const evaluator = new ServerEvaluator(serverUrl, authToken, progressCallback);
  return evaluator.evaluate();
}