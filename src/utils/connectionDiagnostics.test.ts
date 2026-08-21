import { describe, expect, it } from 'vitest';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/client';
import {
  collectConnectionAttemptFacts,
  generateHttpCurlCommand,
  generateBearerHttpCurlCommand,
  shellQuote,
} from './connectionDiagnostics';
import {
  ProxiedAuthenticationError,
  TransportConnectionError,
} from './transportDetection';

describe('connection attempt evidence', () => {
  it('keeps route, exact candidate, transport, readable status, and authentication owner', () => {
    const target = 'https://mcp.example/custom?tenant=one';
    const proxyCandidate = `https://proxy.example/?target=${encodeURIComponent(target)}`;
    const challenge = new ProxiedAuthenticationError(
      401,
      'target',
      new Error('authorization required'),
      { method: 'POST', url: proxyCandidate },
      { 'www-authenticate': 'Bearer [REDACTED]' }
    );
    const error = new TransportConnectionError([challenge], [{
      candidateUrl: proxyCandidate,
      transportType: 'streamable-http',
      error: challenge,
      observedRequests: [{
        method: 'POST',
        url: proxyCandidate,
        candidateUrl: proxyCandidate,
        transportType: 'streamable-http',
        status: 401,
        outcome: 'failed',
      }],
    }]);

    expect(collectConnectionAttemptFacts([{ route: 'proxy', error }], target)).toEqual([{
      route: 'proxy',
      candidateUrl: target,
      transportType: 'streamable-http',
      method: 'POST',
      status: 401,
      authenticationSource: 'target',
      browserUnreadable: false,
      failureKind: 'authentication',
      message: 'MCP target returned HTTP 401',
    }]);
  });

  it('classifies browser-unreadable, timeout, abort, and refusal without flattening them', () => {
    const facts = collectConnectionAttemptFacts([
      { route: 'direct', error: new TypeError('Failed to fetch') },
      { route: 'direct', error: new Error('Connection timeout after 30 seconds') },
      { route: 'direct', error: new Error('Connection aborted by user') },
      { route: 'direct', error: new Error('ECONNREFUSED') },
    ], 'https://example.com/mcp');

    expect(facts.map(({ failureKind }) => failureKind)).toEqual([
      'browser-unreadable',
      'timeout',
      'abort',
      'refused',
    ]);
  });
});

describe('safe exact terminal commands', () => {
  it('preserves a custom endpoint and shell-quotes metacharacters', () => {
    const endpoint = "https://example.com/custom;$(touch%20/tmp/never)?tenant=a&next=`whoami`";
    const command = generateHttpCurlCommand(endpoint);

    expect(command).toContain(`--url '${endpoint}'`);
    expect(command).toContain(`\"protocolVersion\":\"${LATEST_PROTOCOL_VERSION}\"`);
    expect(command).not.toContain('2024-11-05');
    expect(command).not.toContain('/mcp/');
  });

  it('escapes a literal single quote for a POSIX shell', () => {
    expect(shellQuote("publisher's endpoint")).toBe("'publisher'\\''s endpoint'");
  });

  it('uses only a non-secret placeholder in the supported bearer variant', () => {
    const command = generateBearerHttpCurlCommand('https://example.com/mcp');
    expect(command).toContain("'Authorization: Bearer <ACCESS_TOKEN>'");
  });
});
