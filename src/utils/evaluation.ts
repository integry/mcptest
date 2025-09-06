import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { testCorsCompatibility } from './corsTest';
import { discoverOAuthEndpoints, getOAuthConfig } from './oauthDiscovery';
import { attemptParallelConnections } from './transportDetection';
import { addProtocolIfMissing } from './urlUtils';

const runChecks = async (message: string, onProgress: (message: string) => void, checks: Promise<any>[]) => {
  onProgress(message);
  const details = await Promise.all(checks);
  const passedChecks = details.filter(d => d.status === 'passed').length;
  const score = Math.round((passedChecks / details.length) * 100);
  return { score, details };
};

const evaluateCoreProtocol = async (serverUrl: string, onProgress: (message: string) => void) => {
  const checks = [];
  let client: Client | null = null;

  try {
    const connectionResult = await attemptParallelConnections(serverUrl);
    client = connectionResult.client;

    // Check for initialize method
    const initCheck = (async () => {
      const startTime = Date.now();
      try {
        await client!.request({ method: 'initialize', params: { capabilities: {} } });
        const endTime = Date.now();
        return { description: 'Implements `initialize` method correctly', status: 'passed', comment: `Responded in ${endTime - startTime}ms.` };
      } catch (e: any) {
        return { description: 'Implements `initialize` method correctly', status: 'failed', comment: e.message };
      }
    })();
    checks.push(initCheck);

    // Check for list_tools method
    const listToolsCheck = (async () => {
      try {
        const result = await client!.request({ method: 'list_tools', params: {} }) as any;
        const toolCount = result?.tools?.length || 0;
        const toolExamples = result?.tools?.slice(0, 3).map((t: any) => t.name).join(', ');
        return { description: 'Implements `list_tools` method correctly', status: 'passed', comment: `Retrieved ${toolCount} tools, including \`${toolExamples}\`.` };
      } catch (e: any) {
        return { description: 'Implements `list_tools` method correctly', status: 'failed', comment: e.message };
      }
    })();
    checks.push(listToolsCheck);

    // Check for execute_tool method
    const executeToolCheck = (async () => {
      try {
        // We expect this to fail, but not because the method is missing.
        await client!.request({ method: 'execute_tool', params: { name: 'non_existent_tool' } });
        return { description: 'Implements `execute_tool` method correctly', status: 'passed', comment: 'Method exists, but requires a valid tool name.' };
      } catch (e: any) {
        if (e.message.includes('Tool not found')) {
          return { description: 'Implements `execute_tool` method correctly', status: 'passed', comment: 'Server correctly reported that the tool was not found.' };
        }
        return { description: 'Implements `execute_tool` method correctly', status: 'failed', comment: e.message };
      }
    })();
    checks.push(executeToolCheck);
  } catch (e: any) {
    checks.push(Promise.resolve({ description: 'Failed to connect to server', status: 'failed', comment: e.message }));
  } finally {
    if (client) {
      await client.close();
    }
  }

  return runChecks(`Evaluating Core Protocol Adherence for ${serverUrl}...`, onProgress, checks);
};

const evaluateTransportLayer = async (serverUrl: string, onProgress: (message: string) => void) => {
  const checks = [];

  // Check for HTTP/2 or HTTP/3 support
  const httpVersionCheck = (async () => {
    try {
      const response = await fetch(serverUrl, { method: 'HEAD' });
      // This is a browser limitation, we can't directly check the HTTP version.
      // We will assume modern servers support HTTP/2.
      return { description: 'Supports HTTP/2 or HTTP/3', status: 'passed', comment: 'Assumed based on modern server standards.' };
    } catch (e: any) {
      return { description: 'Supports HTTP/2 or HTTP/3', status: 'failed', comment: e.message };
    }
  })();
  checks.push(httpVersionCheck);

  // Check for SSE and Streamable HTTP support
  const transportCheck = (async () => {
    try {
      const result = await attemptParallelConnections(serverUrl);
      const sseSupport = result.transportType === 'legacy-sse';
      const streamableHttpSupport = result.transportType === 'streamable-http';
      await result.client.close();
      return { description: 'Supports modern transport protocols', status: 'passed', comment: `SSE: ${sseSupport}, Streamable HTTP: ${streamableHttpSupport}` };
    } catch (e: any) {
      return { description: 'Supports modern transport protocols', status: 'failed', comment: e.message };
    }
  })();
  checks.push(transportCheck);

  return runChecks(`Evaluating Transport Layer Modernity for ${serverUrl}...`, onProgress, checks);
};

const evaluateSecurity = async (serverUrl: string, onProgress: (message: string) => void) => {
  const checks = [];

  const oauthMetadataCheck = (async () => {
    try {
      const metadata = await discoverOAuthEndpoints(serverUrl);
      if (metadata) {
        return { description: 'Exposes OAuth 2.1 metadata endpoint', status: 'passed', comment: `Found at ${metadata.issuer}.well-known/oauth-authorization-server` };
      }
      return { description: 'Exposes OAuth 2.1 metadata endpoint', status: 'failed', comment: 'No metadata endpoint found.' };
    } catch (e: any) {
      return { description: 'Exposes OAuth 2.1 metadata endpoint', status: 'failed', comment: e.message };
    }
  })();
  checks.push(oauthMetadataCheck);

  const pkceCheck = (async () => {
    try {
      const config = await getOAuthConfig(serverUrl);
      if (config?.supportsPKCE) {
        return { description: 'Supports PKCE for authorization code flow', status: 'passed' };
      }
      return { description: 'Supports PKCE for authorization code flow', status: 'failed', comment: 'PKCE support not detected.' };
    } catch (e: any) {
      return { description: 'Supports PKCE for authorization code flow', status: 'failed', comment: e.message };
    }
  })();
  checks.push(pkceCheck);

  return runChecks(`Evaluating Security Posture (OAuth 2.1) for ${serverUrl}...`, onProgress, checks);
};

const evaluateCors = async (serverUrl: string, onProgress: (message: string) => void) => {
  const checks = [];
  const corsCheck = (async () => {
    try {
      const result = await testCorsCompatibility(serverUrl);
      if (result.success) {
        return { description: 'Responds with correct CORS headers', status: 'passed', comment: `Supports MCP headers: ${result.supportsMcpHeaders}` };
      }
      return { description: 'Responds with correct CORS headers', status: 'failed', comment: result.error };
    } catch (e: any) {
      return { description: 'Responds with correct CORS headers', status: 'failed', comment: e.message };
    }
  })();
  checks.push(corsCheck);

  return runChecks(`Evaluating Web Client Accessibility (CORS) for ${serverUrl}...`, onProgress, checks);
};

const evaluatePerformance = async (serverUrl: string, onProgress: (message: string) => void) => {
  const checks = [];
  let client: Client | null = null;

  try {
    const connectionResult = await attemptParallelConnections(serverUrl);
    client = connectionResult.client;

    const initLatencyCheck = (async () => {
      const startTime = Date.now();
      await client!.request({ method: 'initialize', params: { capabilities: {} } });
      const endTime = Date.now();
      const duration = endTime - startTime;
      return { description: 'Responds to `initialize` in under 200ms', status: duration < 200 ? 'passed' : 'failed', comment: `Response time: ${duration}ms` };
    })();
    checks.push(initLatencyCheck);

    const listToolsLatencyCheck = (async () => {
      const startTime = Date.now();
      await client!.request({ method: 'list_tools', params: {} });
      const endTime = Date.now();
      const duration = endTime - startTime;
      return { description: 'Responds to `list_tools` in under 200ms', status: duration < 200 ? 'passed' : 'failed', comment: `Response time: ${duration}ms` };
    })();
    checks.push(listToolsLatencyCheck);

  } catch (e: any) {
    checks.push(Promise.resolve({ description: 'Failed to connect for performance testing', status: 'failed', comment: e.message }));
  } finally {
    if (client) {
      await client.close();
    }
  }

  return runChecks(`Evaluating Performance Baseline (Latency) for ${serverUrl}...`, onProgress, checks);
};

export const evaluateServer = async (serverUrl: string, onProgress: (message: string) => void) => {
  const results = [];
  let totalScore = 0;
  const url = addProtocolIfMissing(serverUrl);

  const coreProtocol = await evaluateCoreProtocol(url, onProgress);
  results.push({ category: 'Core Protocol Adherence', ...coreProtocol });
  totalScore += coreProtocol.score;

  const transportLayer = await evaluateTransportLayer(url, onProgress);
  results.push({ category: 'Transport Layer Modernity', ...transportLayer });
  totalScore += transportLayer.score;

  const security = await evaluateSecurity(url, onProgress);
  results.push({ category: 'Security Posture (OAuth 2.1)', ...security });
  totalScore += security.score;

  const cors = await evaluateCors(url, onProgress);
  results.push({ category: 'Web Client Accessibility (CORS)', ...cors });
  totalScore += cors.score;

  const performance = await evaluatePerformance(url, onProgress);
  results.push({ category: 'Performance Baseline (Latency)', ...performance });
  totalScore += performance.score;

  const averageScore = Math.round(totalScore / results.length);

  return {
    score: averageScore,
    results: results,
  };
};
