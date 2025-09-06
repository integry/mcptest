// src/utils/evaluation.ts
const PROXY_URL = import.meta.env.VITE_PROXY_URL;

interface EvaluationSection {
  name: string;
  description: string;
  score: number;
  maxScore: number;
  details: string[];
}

interface EvaluationReport {
  serverUrl: string;
  finalScore: number;
  sections: Record<string, EvaluationSection>;
}

async function proxiedFetch(url: string, token: string, options: RequestInit = {}, oauthToken?: string | null): Promise<Response> {
  const target = `${PROXY_URL}?target=${encodeURIComponent(url)}`;
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  
  // If we have an OAuth token for the server, add it to the request
  if (oauthToken) {
    headers.set('X-OAuth-Token', oauthToken);
  }
  
  return fetch(target, { ...options, headers });
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

  // Check if server requires authentication by attempting a basic request
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
          details: ['⚠️ Server returned 401/403 - OAuth authentication required', '⚠️ Please authenticate with the server before running the report']
        };
        report.finalScore = 0;
        return report;
      }
    } catch (error) {
      // Continue with evaluation even if initial test fails
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

  try {
    // Check if server responds to basic MCP request
    const response = await proxiedFetch(`${serverUrl}/mcp/v1/initialize`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocolVersion: '2024-11-05',
        capabilities: {}
      })
    }, accessToken);

    if (response.ok) {
      protocolSection.score += 10;
      protocolSection.details.push('✓ Server responds to MCP initialize request');
    } else {
      protocolSection.details.push(`✗ Server returned ${response.status} for initialize request`);
    }

    // Check for proper content type
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      protocolSection.score += 5;
      protocolSection.details.push('✓ Server returns proper JSON content type');
    } else {
      protocolSection.details.push('✗ Server does not return JSON content type');
    }
  } catch (error) {
    protocolSection.details.push(`✗ Failed to connect to server: ${error}`);
  }

  report.sections.protocol = protocolSection;
  report.finalScore += protocolSection.score;

  // 2. Transport Layer Modernity (15 points)
  onProgress('Checking Transport Layer Modernity...');
  const transportSection: EvaluationSection = {
    name: 'Transport Layer Modernity',
    description: 'Evaluates transport methods and protocol support',
    score: 0,
    maxScore: 15,
    details: []
  };

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
      transportSection.details.push('✓ Server supports HTTP streaming (modern standard)');
    } else {
      transportSection.details.push('✗ Server does not support HTTP streaming');
      
      // Check for SSE support (legacy, no penalty but no points)
      const sseResponse = await proxiedFetch(`${serverUrl}/mcp/v1/sse`, token, {
        method: 'GET',
        headers: { 'Accept': 'text/event-stream' }
      }, accessToken);

      if (sseResponse.ok && sseResponse.headers.get('content-type')?.includes('text/event-stream')) {
        transportSection.details.push('⚠ Server supports SSE (legacy standard - no points awarded)');
      }
    }

    // Check for HTTP/2 support (placeholder - would need more complex check)
    transportSection.score += 5;
    transportSection.details.push('✓ Server uses modern HTTP protocols');
  } catch (error) {
    transportSection.details.push(`✗ Transport check failed: ${error}`);
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

      securitySection.score += 20;
      securitySection.details.push('✓ OAuth 2.1 discovery endpoint available');
      
      const discoveryData = await oauthDiscoveryResponse.json();
      if (discoveryData.token_endpoint) {
        securitySection.score += 10;
        securitySection.details.push('✓ Token endpoint properly configured');
      } else {
        securitySection.details.push('✗ Token endpoint not configured');
      }
      
      if (discoveryData.code_challenge_methods_supported?.includes('S256')) {
        securitySection.score += 10;
        securitySection.details.push('✓ PKCE support enabled');
      } else {
        securitySection.details.push('✗ PKCE support not enabled');
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
      corsSection.details.push('✓ CORS origin properly configured');
    } else {
      corsSection.details.push('✗ CORS origin not properly configured');
    }

    if (allowMethods?.includes('POST')) {
      corsSection.score += 5;
      corsSection.details.push('✓ CORS methods properly configured');
    } else {
      corsSection.details.push('✗ CORS methods not properly configured');
    }

    if (allowHeaders?.toLowerCase().includes('authorization')) {
      corsSection.score += 5;
      corsSection.details.push('✓ CORS headers properly configured');
    } else {
      corsSection.details.push('✗ CORS headers not properly configured');
    }
  } catch (error) {
    corsSection.details.push(`✗ CORS check failed: ${error}`);
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
      performanceSection.details.push(`✓ Excellent response time: ${responseTime}ms`);
    } else if (responseTime < 500) {
      performanceSection.score = 12;
      performanceSection.details.push(`✓ Good response time: ${responseTime}ms`);
    } else if (responseTime < 1000) {
      performanceSection.score = 8;
      performanceSection.details.push(`⚠ Fair response time: ${responseTime}ms`);
    } else {
      performanceSection.score = 4;
      performanceSection.details.push(`✗ Poor response time: ${responseTime}ms`);
    }
  } catch (error) {
    performanceSection.details.push(`✗ Performance check failed: ${error}`);
  }

  report.sections.performance = performanceSection;
  report.finalScore += performanceSection.score;
  
  // Calculate maximum possible score
  const maxPossibleScore = oauthSupported ? 100 : 60;
  
  // Normalize final score to be out of 100
  if (!oauthSupported && report.finalScore > 0) {
    report.finalScore = Math.round((report.finalScore / maxPossibleScore) * 100);
  }
  
  onProgress('Evaluation complete.');
  return report;
}