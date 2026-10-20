import { describe, expect, it } from 'vitest';
import { HOST_IDS, HOST_PROFILES, buildHostProfile } from '../compatibility';
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

  it('reports a cell that lost its source instead of skipping it', () => {
    const data = clone();
    const entry = data.clients.find(({ id }) => id === 'cursor') as unknown as Record<string, any>;
    delete entry.transports.streamableHttp.source;

    expect(validateClientCompatibility(data)).toContain('cursor.transports.streamableHttp needs an https source URL.');
  });

  it('reports a missing required cell or a cell without a verification date', () => {
    const data = clone();
    const entry = data.clients.find(({ id }) => id === 'cursor') as unknown as Record<string, any>;
    delete entry.transports.legacySse;
    delete entry.auth.cimd.verifiedOn;

    expect(validateClientCompatibility(data)).toEqual(expect.arrayContaining([
      'cursor.transports.legacySse is missing.',
      'cursor.auth.cimd needs verifiedOn as YYYY-MM-DD.',
    ]));
  });

  it('checks each cell value against its field type', () => {
    const data = clone();
    const entry = data.clients.find(({ id }) => id === 'cursor') as unknown as Record<string, any>;
    entry.protocolVersions.value = '2025-11-25';
    entry.version.value = ['1.0'];
    entry.headers.required.value = [42];
    entry.oauthCallbacks.value = ['http://localhost:8787/callback'];

    expect(validateClientCompatibility(data)).toEqual(expect.arrayContaining([
      'cursor.protocolVersions must be a list of strings or unknown.',
      'cursor.version must be a string or unknown.',
      'cursor.headers.required must be a list of strings or unknown.',
      expect.stringContaining('cursor.oauthCallbacks [0] must be an object'),
    ]));
  });

  it('rejects callbacks with an unknown use or runtime', () => {
    const data = clone();
    const entry = data.clients.find(({ id }) => id === 'cursor') as unknown as Record<string, any>;
    entry.oauthCallbacks.value = [{ uri: 'http://localhost:8787/callback', use: 'sometimes', runtimes: ['phone'] }];

    const [problem] = validateClientCompatibility(data);

    expect(problem).toContain('[0].use must be required or conditional');
    expect(problem).toContain('[0].runtimes must list');
  });

  it('rejects data that is not a client list', () => {
    expect(validateClientCompatibility({ schemaVersion: 2, clients: [] })).toHaveLength(1);
    expect(validateClientCompatibility(null)).toHaveLength(1);
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

    expect(callbacks).toEqual([{ uri: 'https://claude.ai/api/mcp/auth_callback', use: 'required' }]);
    expect(redirects?.onFail.remediation?.action).toContain('https://claude.ai/api/mcp/auth_callback');
  });

  it('cites the client data sources and dates in every profile', () => {
    for (const hostId of HOST_IDS) {
      const entry = getClientCompatibilityForHost(hostId);
      const profile = HOST_PROFILES[hostId];
      const sourceUrls = new Set(entry.sources.map(({ url }) => url));
      const clientAssumptions = profile.assumptions.filter(({ id }) => id !== 'mcp-auth');

      expect(clientAssumptions.length).toBeGreaterThan(0);
      for (const assumption of clientAssumptions) {
        expect(sourceUrls.has(assumption.url), `${hostId} ${assumption.url}`).toBe(true);
        expect(assumption.accessedOn).toBe(entry.verifiedOn);
        expect(assumption.notes.startsWith(`${entry.name}:`)).toBe(true);
      }
    }
  });

  it('versions a profile by its rules and assumptions, not by verification dates', () => {
    const entry = getClientCompatibilityForHost('cursor');
    expect(buildHostProfile('cursor', entry)).toEqual(HOST_PROFILES.cursor);
    expect(new Set(HOST_IDS.map((id) => HOST_PROFILES[id].profileVersion)).size).toBe(HOST_IDS.length);

    // The documented update: one cell changes on a later day, the entry date stays the oldest.
    const changed = structuredClone(entry) as unknown as Record<string, any>;
    changed.auth.cimd = { ...changed.auth.cimd, value: 'supported', verifiedOn: '2026-11-02' };
    const changedProfile = buildHostProfile('cursor', changed as never);
    expect(changed.verifiedOn).toBe(entry.verifiedOn);
    expect(changedProfile.rules).not.toEqual(HOST_PROFILES.cursor.rules);
    expect(changedProfile.profileVersion).not.toBe(HOST_PROFILES.cursor.profileVersion);

    // Re-checking a cell without changing it is freshness, not a new profile.
    const rechecked = structuredClone(entry) as unknown as Record<string, any>;
    rechecked.auth.cimd = { ...rechecked.auth.cimd, verifiedOn: '2026-11-02' };
    expect(buildHostProfile('cursor', rechecked as never).profileVersion).toBe(HOST_PROFILES.cursor.profileVersion);
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
