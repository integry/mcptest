import { auth } from '../firebase';
import { Client } from '@modelcontextprotocol/sdk/client';
import { attemptParallelConnections } from '../utils/transportDetection';
import { getOAuthConfig, getOrRegisterOAuthClient } from '../utils/oauthDiscovery';
import { generatePKCE } from '../utils/pkce';
import { TransportType } from '../types';

// --- Type Definitions ---

export interface ReportCategory {
  name: string;
  score: number;
  maxPoints: number;
  description: string;
  findings: string[];
}

export interface Report {
  serverUrl: string;
  finalScore: number;
  grade: string;
  evaluationDate: string;
  categories: ReportCategory[];
  summary: {
    strengths: string[];
    weaknesses: string[];
  };
  performance: {
    tier: string;
    ttfb: number;
    totalTime: number;
  };
}

export interface ProgressUpdate {
  stage: string;
  details: string;
  step: number;
  totalSteps: number;
}

export type EvaluationResult = {
    type: 'complete';
    report: Report;
} | {
    type: 'auth_required';
    authUrl: string;
};

// --- Helper Functions ---

const TOTAL_STEPS = 4; // connect, security, cors, performance

// --- Evaluation Logic ---

const createAuthenticatedChecks = async (client: Client, transportType: TransportType): Promise<{ transportCategory: ReportCategory, coreCategory: ReportCategory }> => {
    const transportCategory: ReportCategory = {
        name: 'II. Transport Layer Modernity', score: 0, maxPoints: 15,
        description: 'Uses the latest Streamable HTTP transport.', findings: [],
    };
    const coreCategory: ReportCategory = {
        name: 'I. Core Protocol Adherence', score: 0, maxPoints: 15,
        description: 'Correctly implements fundamental MCP components.', findings: [],
    };

    // Score transport
    if (transportType === 'streamable-http') {
        transportCategory.score = 15;
        transportCategory.findings.push('[PASS] Server supports the modern Streamable HTTP transport.');
    } else {
        transportCategory.score = 0;
        transportCategory.findings.push('[FAIL] Server uses the deprecated HTTP+SSE transport.');
    }

    // Check capabilities
    const capabilities = await client.getCapabilities();
    coreCategory.findings.push('[PASS] Successfully retrieved capabilities from the server.');
    coreCategory.score += 5;

    const { tools, resources } = capabilities;
    if (tools?.length || resources?.length) {
        coreCategory.findings.push(`[PASS] Server advertises ${tools?.length || 0} tools and ${resources?.length || 0} resources.`);
        coreCategory.score += 5;
    } else {
        coreCategory.findings.push('[WARN] Server advertises no tools or resources.');
    }

    if (!tools?.every((t: any) => t.name && t.description && t.input_schema)) {
        coreCategory.findings.push('[FAIL] Not all advertised tools are well-documented.');
    } else {
        coreCategory.findings.push('[PASS] All advertised tools are well-documented.');
        coreCategory.score += 5;
    }

    return { transportCategory, coreCategory };
};

const checkSecurityPosture = async (serverUrl: string): Promise<ReportCategory> => {
    const category: ReportCategory = {
        name: 'III. Security Posture (OAuth 2.1)', score: 0, maxPoints: 40,
        description: 'Implements modern, secure authentication.', findings: [],
    };
    const oauthConfig = await getOAuthConfig(serverUrl);
    if (!oauthConfig) {
        category.findings.push('[FAIL] OAuth configuration could not be determined.');
        return category;
    }

    category.findings.push('[PASS] Provides a valid OAuth 2.1 configuration.');
    category.score += 10;
    if (oauthConfig.supportsPKCE) {
        category.findings.push('[PASS] Server configuration indicates support for PKCE (REQUIRED).');
        category.score += 20;
    } else {
        category.findings.push('[FAIL] Server does not support PKCE. CRITICAL FAILURE.');
        category.score = 0; return category;
    }
    if (oauthConfig.registrationEndpoint || oauthConfig.requiresDynamicRegistration) {
        category.findings.push('[PASS] Server supports Dynamic Client Registration.');
        category.score += 5;
    } else {
        category.findings.push('[INFO] Server does not appear to support Dynamic Client Registration.');
    }
    if (oauthConfig.tokenEndpoint) {
         category.findings.push('[PASS] Provides a secure token endpoint.');
         category.score += 5;
    }
    return category;
};

const checkWebClientAccessibility = async (serverUrl: string): Promise<ReportCategory> => {
    const category: ReportCategory = { name: 'IV. Web Client Accessibility (CORS)', score: 0, maxPoints: 15, description: 'Properly configured for browser-based clients.', findings: [] };
    try {
        const response = await fetch(`${serverUrl}/mcp`, { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, authorization' } });
        if (response.ok) {
            category.score += 8; category.findings.push('[PASS] Server handles preflight OPTIONS requests.');
            const allowOrigin = response.headers.get('access-control-allow-origin');
            if (allowOrigin === '*') { category.score += 3; category.findings.push('[WARN] Uses a wildcard (*) for Access-Control-Allow-Origin.'); }
            else if (allowOrigin) { category.score += 7; category.findings.push('[PASS] Uses a specific origin for Access-Control-Allow-Origin.'); }
        } else { category.findings.push('[FAIL] Preflight OPTIONS request failed.'); }
    } catch (e) {
        if (e instanceof TypeError) {
            category.findings.push('[FAIL] Request blocked by browser CORS policy.', '[INFO] This indicates a CORS misconfiguration, but browser security prevents inspecting details.');
        } else { category.findings.push(`[FAIL] An unexpected error occurred: ${(e as Error).message}`);}
    }
    return category;
};

const checkPerformanceBaseline = async (serverUrl: string): Promise<ReportCategory & { ttfb: number, totalTime: number, tier: string }> => {
    const category: ReportCategory & { ttfb: number, totalTime: number, tier: string } = { name: 'V. Performance Baseline (Latency)', score: 0, maxPoints: 15, description: 'Responsiveness for interactive applications.', findings: [], ttfb: -1, totalTime: -1, tier: 'N/A' };
    try {
        const start = performance.now();
        const response = await proxiedFetch(`${new URL(serverUrl).origin}/health`, { method: 'GET' });
        const ttfb = performance.now() - start;
        await response.text();
        const totalTime = performance.now() - start;
        category.ttfb = Math.round(ttfb); category.totalTime = Math.round(totalTime);
        category.findings.push(`[INFO] TTFB: ${category.ttfb}ms, Total Time: ${category.totalTime}ms.`);
        if (ttfb < 100 && totalTime < 200) { category.tier = 'Excellent'; category.score = 15; }
        else if (ttfb < 250 && totalTime < 500) { category.tier = 'Good'; category.score = 10; }
        else if (ttfb < 500 && totalTime < 1000) { category.tier = 'Acceptable'; category.score = 5; }
        else { category.tier = 'Poor'; category.score = 0; }
        category.findings.push(`[PASS] Performance rated as: ${category.tier}.`);
    } catch (e: any) { category.findings.push(`[FAIL] Performance test on /health endpoint failed: ${e.message}`); category.tier = 'Error'; }
    return category;
};

// --- Main Evaluation Service ---

export const runEvaluation = async (
  serverUrl: string,
  progressCallback: (update: ProgressUpdate) => void
): Promise<EvaluationResult> => {

  const host = new URL(serverUrl).host;
  const token = sessionStorage.getItem(`oauth_access_token_${host}`);
  let client: Client | null = null;

  try {
    progressCallback({ stage: '1. Connecting...', details: 'Attempting connection...', step: 1, totalSteps: TOTAL_STEPS });
    const { client: connectedClient, transportType } = await attemptParallelConnections(serverUrl, undefined, token || undefined);
    client = connectedClient;

    // --- If connection succeeds, run all checks ---
    progressCallback({ stage: '2. Authenticated Checks', details: 'Running checks on connected server...', step: 2, totalSteps: TOTAL_STEPS });
    const { transportCategory, coreCategory } = await createAuthenticatedChecks(client, transportType);
    const securityResult = { name: 'III. Security Posture (OAuth 2.1)', score: 40, maxPoints: 40, description: 'Implements modern, secure authentication.', findings: ['[PASS] Server is open or user is already authenticated.'] };

    progressCallback({ stage: '3. Web & Performance', details: 'Checking CORS and latency...', step: 3, totalSteps: TOTAL_STEPS });
    const corsResult = await checkWebClientAccessibility(serverUrl);
    const performanceResult = await checkPerformanceBaseline(serverUrl);

    progressCallback({ stage: '4. Finalizing', details: 'Compiling report...', step: 4, totalSteps: TOTAL_STEPS });
    const categories = [coreCategory, transportCategory, securityResult, corsResult, performanceResult];
    const finalScore = categories.reduce((sum, cat) => Math.max(0, sum + cat.score), 0);
    const grade = finalScore >= 90 ? 'A' : finalScore >= 80 ? 'B' : finalScore >= 70 ? 'C' : finalScore >= 60 ? 'D' : 'F';

    const finalReport: Report = {
        serverUrl, finalScore, grade, evaluationDate: new Date().toUTCString(), categories,
        summary: { strengths: [], weaknesses: [] }, // Simplified for brevity
        performance: { tier: performanceResult.tier, ttfb: performanceResult.ttfb, totalTime: performanceResult.totalTime }
    };
    return { type: 'complete', report: finalReport };

  } catch (e: any) {
    const errorMessage = e.message.toLowerCase();
    const isAuthError = errorMessage.includes('401') || errorMessage.includes('403');

    if (isAuthError && !token) {
        progressCallback({ stage: 'Authentication Required', details: 'Server requires login...', step: 1, totalSteps: TOTAL_STEPS });
        const oauthConfig = await getOAuthConfig(serverUrl);
        if (!oauthConfig) throw new Error("Server requires authentication but no OAuth configuration could be found.");

        const { code_verifier, code_challenge } = await generatePKCE();
        sessionStorage.setItem('pkce_code_verifier', code_verifier);

        let clientId: string | null = null;
        if (oauthConfig.registrationEndpoint) {
            const registration = await getOrRegisterOAuthClient(serverUrl, oauthConfig.registrationEndpoint);
            clientId = registration?.clientId || null;
        }
        if (!clientId && oauthConfig.requiresClientRegistration) {
            throw new Error("This server requires manual OAuth client configuration. Please connect to it once in the Playground to configure it before running a report.");
        }

        const authUrl = new URL(oauthConfig.authorizationEndpoint);
        authUrl.searchParams.set('response_type', 'code');
        if(clientId) authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', `${window.location.origin}/oauth/callback`);
        authUrl.searchParams.set('code_challenge', code_challenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('scope', oauthConfig.scope);

        return { type: 'auth_required', authUrl: authUrl.toString() };
    }
    // For other errors, just re-throw
    throw e;
  } finally {
    await client?.close();
  }
};
