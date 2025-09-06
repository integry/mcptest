import { auth } from '../firebase';
import { Client } from '@modelcontextprotocol/sdk/client';
import { attemptParallelConnections } from '../utils/transportDetection';
import { getOAuthConfig } from '../utils/oauthDiscovery';

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

// --- Helper Functions ---

const TOTAL_STEPS = 4; // Combined connection/core check, security, cors, performance

const proxiedFetch = async (targetUrl: string, options: RequestInit = {}): Promise<Response> => {
  const proxyUrl = import.meta.env.VITE_PROXY_URL;
  if (!proxyUrl) {
    throw new Error("Proxy URL is not configured.");
  }
  const token = auth?.currentUser ? await auth.currentUser.getIdToken() : null;
  if (!token) {
    throw new Error("Authentication required to use the proxy.");
  }
  const url = new URL(proxyUrl);
  url.searchParams.set('target', targetUrl);
  const finalOptions: RequestInit = { ...options, headers: { ...options.headers, 'Authorization': `Bearer ${token}` } };
  return fetch(url.toString(), finalOptions);
};

// --- Evaluation Category Checks ---

const checkConnectionAndCapabilities = async (
    serverUrl: string,
    progressCallback: (update: ProgressUpdate) => void
): Promise<{ transportCategory: ReportCategory, coreCategory: ReportCategory, authIsRequired: boolean }> => {
    let client: Client | null = null;
    let authIsRequired = false;

    const transportCategory: ReportCategory = {
        name: 'II. Transport Layer Modernity', score: 0, maxPoints: 15,
        description: 'Uses the latest Streamable HTTP transport.', findings: [],
    };
    const coreCategory: ReportCategory = {
        name: 'I. Core Protocol Adherence', score: 0, maxPoints: 15,
        description: 'Correctly implements fundamental MCP components.', findings: [],
    };

    try {
        progressCallback({ stage: '1. Connection & Capabilities', details: 'Attempting unauthenticated connection...', step: 1, totalSteps: TOTAL_STEPS });
        const { client: connectedClient, transportType } = await attemptParallelConnections(serverUrl);
        client = connectedClient;

        if (transportType === 'streamable-http') {
            transportCategory.score = 15;
            transportCategory.findings.push('[PASS] Server supports the modern Streamable HTTP transport.');
        } else if (transportType === 'legacy-sse') {
            transportCategory.score = 0;
            transportCategory.findings.push('[FAIL] Server uses the deprecated HTTP+SSE transport.');
        }

        progressCallback({ stage: '1. Connection & Capabilities', details: 'Fetching server capabilities...', step: 1, totalSteps: TOTAL_STEPS });
        const capabilities = await client.getCapabilities();
        coreCategory.findings.push('[PASS] Server is open and provides capabilities without authentication.');
        coreCategory.score += 5;

        const { tools, resources } = capabilities;
        if (tools?.length || resources?.length) {
            coreCategory.findings.push(`[PASS] Server advertises ${tools?.length || 0} tools and ${resources?.length || 0} resources.`);
            coreCategory.score += 5;
        } else {
            coreCategory.findings.push('[WARN] Server advertises no tools or resources.');
        }

        if (!tools?.every((t: any) => t.name && t.description && t.input_schema)) {
            coreCategory.findings.push('[FAIL] Not all advertised tools are well-documented (name, description, schema).');
        } else {
            coreCategory.findings.push('[PASS] All advertised tools are well-documented.');
            coreCategory.score += 5;
        }

    } catch (e: any) {
        const errorMessage = e.message.toLowerCase();
        if (errorMessage.includes('401') || errorMessage.includes('403') || errorMessage.includes('unauthorized') || errorMessage.includes('invalid_token')) {
            authIsRequired = true;
            transportCategory.findings.push('[INFO] Server requires authentication, transport check deferred.');
            coreCategory.findings.push('[INFO] Server requires authentication. Capability checks were skipped.');
            // Give partial credit if it correctly requires auth, as this is better than being broken.
            transportCategory.score = 5;
            coreCategory.score = 5;
        } else {
            transportCategory.findings.push(`[FAIL] Connection failed: ${e.message}`);
            coreCategory.findings.push(`[FAIL] Could not retrieve capabilities: ${e.message}`);
        }
    } finally {
        await client?.close();
    }

    return { transportCategory, coreCategory, authIsRequired };
};


const checkSecurityPosture = async (serverUrl: string, authIsRequired: boolean): Promise<ReportCategory> => {
    const category: ReportCategory = {
        name: 'III. Security Posture (OAuth 2.1)', score: 0, maxPoints: 40,
        description: 'Implements modern, secure authentication.', findings: [],
    };

    if (!authIsRequired) {
        category.findings.push('[INFO] Server does not require authentication. OAuth checks are not applicable.');
        category.score = 40; // Max points if auth is not needed
        return category;
    }

    try {
        const oauthConfig = await getOAuthConfig(serverUrl);
        if (!oauthConfig) throw new Error('OAuth configuration could not be determined.');

        if (oauthConfig.authorizationEndpoint.includes(serverUrl)) {
             category.findings.push('[PASS] Provides an OAuth 2.1 configuration (via discovery or default).');
             category.score += 10;
        } else {
             category.findings.push('[FAIL] OAuth discovery failed or returned non-standard endpoints.');
             category.score -= 10; // Penalty for bad discovery
        }

        if (oauthConfig.supportsPKCE) {
            category.findings.push('[PASS] Server configuration indicates support for PKCE (REQUIRED).');
            category.score += 20;
        } else {
            category.findings.push('[FAIL] Server does not support PKCE. This is a critical security failure.');
            category.score = 0; // Reset score on critical failure
            return category;
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

    } catch (e: any) {
        category.findings.push(`[FAIL] OAuth discovery failed: ${e.message}`);
        category.score = 0;
    }
    return category;
};

const checkWebClientAccessibility = async (serverUrl: string): Promise<ReportCategory> => {
    const category: ReportCategory = {
        name: 'IV. Web Client Accessibility (CORS)', score: 0, maxPoints: 15,
        description: 'Properly configured for browser-based clients.', findings: [],
    };

    try {
        const response = await fetch(`${serverUrl}/mcp`, {
            method: 'OPTIONS',
            headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, authorization' },
        });

        if (response.ok) {
            category.findings.push('[PASS] Server handles preflight OPTIONS requests.');
            category.score += 8;
            const allowOrigin = response.headers.get('access-control-allow-origin');
            if (allowOrigin === '*') {
                category.findings.push('[WARN] Uses a wildcard (*) for Access-Control-Allow-Origin.');
                category.score += 3;
            } else if (allowOrigin) {
                category.findings.push('[PASS] Uses a specific origin for Access-Control-Allow-Origin.');
                category.score += 7;
            }
        } else {
             category.findings.push('[FAIL] Preflight OPTIONS request failed.');
        }
    } catch (e) {
        if (e instanceof TypeError) {
            category.findings.push('[FAIL] Request blocked by browser CORS policy.');
            category.findings.push('[INFO] This test runs in the browser. A "blocked" result indicates a CORS misconfiguration, but the browser prevents inspection of the specific error details.');
        } else {
            category.findings.push(`[FAIL] An unexpected error occurred during the CORS check: ${(e as Error).message}`);
        }
    }
    return category;
};

const checkPerformanceBaseline = async (serverUrl: string): Promise<ReportCategory & { ttfb: number, totalTime: number, tier: string }> => {
    const category: ReportCategory & { ttfb: number, totalTime: number, tier: string } = {
        name: 'V. Performance Baseline (Latency)', score: 0, maxPoints: 15,
        description: 'Responsiveness for interactive applications.', findings: [],
        ttfb: -1, totalTime: -1, tier: 'N/A',
    };

    try {
        const start = performance.now();
        const response = await proxiedFetch(`${new URL(serverUrl).origin}/health`, { method: 'GET' });
        const ttfb = performance.now() - start;
        await response.text();
        const totalTime = performance.now() - start;

        category.ttfb = Math.round(ttfb);
        category.totalTime = Math.round(totalTime);
        category.findings.push(`[INFO] TTFB: ${category.ttfb}ms, Total Time: ${category.totalTime}ms.`);

        if (ttfb < 100 && totalTime < 200) { category.tier = 'Excellent'; category.score = 15; }
        else if (ttfb < 250 && totalTime < 500) { category.tier = 'Good'; category.score = 10; }
        else if (ttfb < 500 && totalTime < 1000) { category.tier = 'Acceptable'; category.score = 5; }
        else { category.tier = 'Poor'; category.score = 0; }
        category.findings.push(`[PASS] Performance rated as: ${category.tier}.`);

    } catch (e: any) {
        category.findings.push(`[FAIL] Performance test on /health endpoint failed: ${e.message}`);
        category.tier = 'Error';
    }
    return category;
};

// --- Main Evaluation Service ---

export const runEvaluation = async (
  serverUrl: string,
  progressCallback: (update: ProgressUpdate) => void
): Promise<Report> => {

  const { transportCategory, coreCategory, authIsRequired } = await checkConnectionAndCapabilities(serverUrl, progressCallback);

  progressCallback({ stage: '2. Security Posture', details: 'Analyzing OAuth 2.1 implementation...', step: 2, totalSteps: TOTAL_STEPS });
  const securityResult = await checkSecurityPosture(serverUrl, authIsRequired);

  progressCallback({ stage: '3. Web Client Accessibility', details: 'Reviewing CORS configuration...', step: 3, totalSteps: TOTAL_STEPS });
  const corsResult = await checkWebClientAccessibility(serverUrl);

  progressCallback({ stage: '4. Performance Baseline', details: 'Measuring connection and request latency...', step: 4, totalSteps: TOTAL_STEPS });
  const performanceResult = await checkPerformanceBaseline(serverUrl);

  const categories = [coreCategory, transportCategory, securityResult, corsResult, performanceResult];
  const finalScore = categories.reduce((sum, cat) => Math.max(0, sum + cat.score), 0);

  const getGrade = (score: number): string => {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  };

  const getStrengths = (cats: ReportCategory[]): string[] => {
      const strengths: string[] = [];
      if (cats[0].score >= 15) strengths.push("Excellent core protocol adherence.");
      if (cats[1].score === 15) strengths.push("Uses modern Streamable HTTP transport.");
      if (cats[2].score >= 40) strengths.push("Excellent security posture.");
      if (cats[2].score > 25 && cats[2].score < 40) strengths.push("Implements mandatory OAuth 2.1 + PKCE.");
      if (cats[3].score > 12) strengths.push("Secure and specific CORS policy.");
      if (cats[4].score === 15) strengths.push("Excellent baseline performance.");
      return strengths.length > 0 ? strengths : ["No significant strengths identified."];
  }

  const getWeaknesses = (cats: ReportCategory[]): string[] => {
      const weaknesses: string[] = [];
      if (cats[0].score < 10) weaknesses.push("Poor core protocol adherence.");
      if (cats[1].score < 10) weaknesses.push("Uses deprecated or non-standard transport.");
      if (authIsRequired && cats[2].score === 0) weaknesses.push("Critical security failure: OAuth 2.1 / PKCE not implemented correctly.");
      else if (authIsRequired && cats[2].score < 25) weaknesses.push("Significant gaps in security implementation.");
      if (cats[3].score < 10) weaknesses.push("Poor CORS configuration hinders web client access.");
      if (cats[4].score < 5) weaknesses.push("Poor baseline performance.");
      return weaknesses.length > 0 ? weaknesses : ["No significant weaknesses identified."];
  }

  const finalReport: Report = {
    serverUrl,
    finalScore,
    grade: getGrade(finalScore),
    evaluationDate: new Date().toUTCString(),
    categories,
    summary: {
      strengths: getStrengths(categories),
      weaknesses: getWeaknesses(categories),
    },
    performance: {
      tier: performanceResult.tier,
      ttfb: performanceResult.ttfb,
      totalTime: performanceResult.totalTime,
    }
  };

  return finalReport;
};
