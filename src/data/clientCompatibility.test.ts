import { describe, expect, it } from 'vitest';
import { HOST_IDS, HOST_PROFILES } from '../compatibility';
import {
  CLIENT_COMPATIBILITY,
  CLIENT_COMPATIBILITY_IDS,
  findStaleClientCompatibilityCells,
  getClientCompatibilityForHost,
  listCells,
  validateClientCompatibility,
  type ClientCompatibilityData,
} from './clientCompatibility';

const clone = (): ClientCompatibilityData => structuredClone(CLIENT_COMPATIBILITY) as ClientCompatibilityData;

describe('client compatibility data', () => {
  it('is structurally valid', () => {
    expect(validateClientCompatibility(CLIENT_COMPATIBILITY)).toEqual([]);
  });

  it('covers the clients the Use-track guides and host profiles describe', () => {
    expect(CLIENT_COMPATIBILITY_IDS).toEqual(expect.arrayContaining([
      'claude-ai', 'claude-desktop', 'claude-code', 'chatgpt', 'codex-cli',
      'cursor', 'vscode-copilot', 'windsurf', 'gemini-cli', 'generic-sdk',
    ]));
    for (const hostId of HOST_IDS) {
      expect(getClientCompatibilityForHost(hostId).hostProfileId).toBe(hostId);
    }
  });

  it('gives every cell a listed source and a verification date', () => {
    for (const entry of CLIENT_COMPATIBILITY.clients) {
      const urls = new Set(entry.sources.map(({ url }) => url));
      for (const { path, cell } of listCells(entry)) {
        expect(urls.has(cell.source), `${entry.id}.${path}`).toBe(true);
        expect(cell.verifiedOn, `${entry.id}.${path}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('reports invalid cells, unlisted sources and a wrong entry date', () => {
    const data = clone();
    const entry = data.clients[0] as unknown as Record<string, any>;
    entry.transports.stdio = { value: 'maybe', source: 'http://insecure.example', verifiedOn: '20-10-2026' };
    entry.privateHosts.source = 'https://unlisted.example/docs';

    const problems = validateClientCompatibility(data);

    expect(problems).toEqual(expect.arrayContaining([
      expect.stringContaining('transports.stdio needs an https source URL'),
      expect.stringContaining('transports.stdio needs verifiedOn as YYYY-MM-DD'),
      expect.stringContaining('transports.stdio has invalid support level maybe'),
      expect.stringContaining('privateHosts cites https://unlisted.example/docs'),
    ]));
  });

  it('finds cells verified more than 90 days before the given day', () => {
    const data = clone();
    const entry = data.clients[0] as unknown as Record<string, any>;
    entry.transports.legacySse.verifiedOn = '2026-07-01';
    entry.verifiedOn = '2026-07-01';

    expect(findStaleClientCompatibilityCells(data, '2026-09-29')).toEqual([]);
    expect(findStaleClientCompatibilityCells(data, '2026-09-30')).toEqual([{
      clientId: data.clients[0].id,
      path: 'transports.legacySse',
      verifiedOn: '2026-07-01',
      ageDays: 91,
    }]);
  });
});

describe('host profiles built from client data', () => {
  it('uses the verified callback URIs for exact-match redirect remediation', () => {
    const redirects = HOST_PROFILES.claude.rules.find(({ id }) => id === 'authorization.oauth.redirects');
    const callbacks = getClientCompatibilityForHost('claude').oauthCallbacks.value;

    expect(callbacks).toEqual(['https://claude.ai/api/mcp/auth_callback']);
    expect(redirects?.onFail.remediation?.action).toContain('https://claude.ai/api/mcp/auth_callback');
  });

  it('cites the client data sources and dates in every profile', () => {
    for (const hostId of HOST_IDS) {
      const entry = getClientCompatibilityForHost(hostId);
      const profile = HOST_PROFILES[hostId];
      const sourceUrls = new Set(entry.sources.map(({ url }) => url));
      const clientAssumptions = profile.assumptions.filter(({ id }) => id !== 'mcp-auth');

      expect(profile.profileVersion).toBe(`${entry.verifiedOn}.1`);
      expect(clientAssumptions.length).toBeGreaterThan(0);
      for (const assumption of clientAssumptions) {
        expect(sourceUrls.has(assumption.url), `${hostId} ${assumption.url}`).toBe(true);
        expect(assumption.accessedOn).toBe(entry.verifiedOn);
        expect(assumption.notes.startsWith(`${entry.name}:`)).toBe(true);
      }
    }
  });

  it('does not rely on limited or unknown support', () => {
    // Claude's request-header auth is a beta for some organizations.
    expect(getClientCompatibilityForHost('claude').auth.bearerToken.value).toBe('limited');
    const scheme = HOST_PROFILES.claude.rules.find(({ id }) => id === 'authorization.scheme');
    expect(scheme?.onFail.remediation?.action).toBe('Offer OAuth or one of the host-supported schemes: oauth.');

    // ChatGPT resources are documented only for UI templates and skills.
    expect(HOST_PROFILES.chatgpt.rules.some(({ id }) => id === 'capabilities.resources')).toBe(true);
  });
});
