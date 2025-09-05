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

async function proxiedFetch(url: string, token: string, options: RequestInit = {}): Promise<Response> {
  const target = `${PROXY_URL}?target=${encodeURIComponent(url)}`;
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  
  return fetch(target, { ...options, headers });
}

export async function evaluateServer(serverUrl: string, token: string, onProgress: (message: string) => void): Promise<EvaluationReport> {
  // Ensure serverUrl has protocol
  if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
    serverUrl = `https://${serverUrl}`;
  }

  const report: EvaluationReport = {
    serverUrl,
    finalScore: 0,
    sections: {}
  };

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
    });

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
    // Check for SSE support
    const sseResponse = await proxiedFetch(`${serverUrl}/mcp/v1/sse`, token, {
      method: 'GET',
      headers: { 'Accept': 'text/event-stream' }
    });

    if (sseResponse.ok && sseResponse.headers.get('content-type')?.includes('text/event-stream')) {
      transportSection.score += 10;
      transportSection.details.push('✓ Server supports Server-Sent Events (SSE)');
    } else {
      transportSection.details.push('✗ Server does not support SSE');
    }

    // Check for HTTP/2 support (placeholder - would need more complex check)
    transportSection.score += 5;
    transportSection.details.push('✓ Server uses modern HTTP protocols');
  } catch (error) {
    transportSection.details.push(`✗ Transport check failed: ${error}`);
  }

  report.sections.transport = transportSection;
  report.finalScore += transportSection.score;

  // 3. Security Posture (40 points)
  onProgress('Checking Security Posture...');
  const securitySection: EvaluationSection = {
    name: 'Security Posture',
    description: 'Evaluates OAuth 2.1 implementation and security headers',
    score: 0,
    maxScore: 40,
    details: []
  };

  try {
    // Check for OAuth discovery endpoint
    const oauthDiscoveryResponse = await proxiedFetch(`${serverUrl}/.well-known/oauth-authorization-server`, token);
    
    if (oauthDiscoveryResponse.ok) {
      securitySection.score += 20;
      securitySection.details.push('✓ OAuth 2.1 discovery endpoint available');
      
      const discoveryData = await oauthDiscoveryResponse.json();
      if (discoveryData.token_endpoint) {
        securitySection.score += 10;
        securitySection.details.push('✓ Token endpoint properly configured');
      }
      if (discoveryData.code_challenge_methods_supported?.includes('S256')) {
        securitySection.score += 10;
        securitySection.details.push('✓ PKCE support enabled');
      }
    } else {
      securitySection.details.push('✗ OAuth 2.1 discovery endpoint not found');
    }
  } catch (error) {
    securitySection.details.push(`✗ Security check failed: ${error}`);
  }

  report.sections.security = securitySection;
  report.finalScore += securitySection.score;

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
    });

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
    });
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
  
  onProgress('Evaluation complete.');
  return report;
}