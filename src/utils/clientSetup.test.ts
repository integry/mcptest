import { describe, expect, it } from 'vitest';
import type { CatalogServer } from '../types/catalog';
import {
  generateClientSetups,
  getPreferredCatalogEndpoint,
  sanitizeClientSetupKey,
} from './clientSetup';

const makeServer = (overrides: Partial<CatalogServer> = {}): CatalogServer => ({
  id: 'example-server',
  name: 'Example Server',
  url: 'https://canonical.example/mcp',
  description: 'Example server',
  category: 'Testing',
  tags: [],
  listingSource: { kind: 'community' },
  declaredTransport: 'streamable-http',
  transport: 'streamable-http',
  requiresOAuth: false,
  declaredAuthType: 'none',
  authType: 'none',
  protocolEra: 'unknown',
  status: 'online',
  logoUrl: '/server-logos/example.svg',
  logoSourceKind: 'generated-fallback',
  logoRetrievedAt: '2026-08-18',
  ...overrides,
});

describe('client setup endpoint selection', () => {
  it('uses browser, live validation, and canonical evidence in that order', () => {
    const server = makeServer({
      validatedUrl: 'https://validated.example/mcp',
      browserUrl: 'https://browser.example/mcp',
    });
    expect(getPreferredCatalogEndpoint(server)).toMatchObject({
      url: 'https://browser.example/mcp',
      provenance: 'browser-verified',
      provenanceLabel: 'Browser-verified endpoint',
    });

    delete server.browserUrl;
    expect(getPreferredCatalogEndpoint(server)).toMatchObject({
      url: 'https://validated.example/mcp', provenance: 'live-validated',
    });

    delete server.validatedUrl;
    expect(getPreferredCatalogEndpoint(server)).toMatchObject({
      url: 'https://canonical.example/mcp', provenance: 'canonical',
    });
  });

  it('sanitizes special identifiers and serializes special URLs', () => {
    const server = makeServer({
      id: `  9 Weird \"name\" ' / 設定  `,
      url: `https://example.com/mcp?label=a'b\"c&mode=test`,
    });
    const setups = generateClientSetups(server);

    expect(sanitizeClientSetupKey(server.id)).toBe('mcp-9-weird-name');
    expect(setups).toHaveLength(4);
    expect(setups[0].copyText).toContain(`'https://example.com/mcp?label=a'\"'\"'b\"c&mode=test'`);
    const cursorConfig = JSON.parse(setups[2].copyText);
    const vscodeConfig = JSON.parse(setups[3].copyText);
    expect(cursorConfig.mcpServers['mcp-9-weird-name'].url).toBe(server.url);
    expect(vscodeConfig.servers['mcp-9-weird-name'].url).toBe(server.url);
  });
});

describe('client setup transports and authentication', () => {
  it('generates all four no-auth Streamable HTTP configurations', () => {
    const setups = generateClientSetups(makeServer());
    expect(setups.map(({ heading }) => heading)).toEqual([
      'Claude Code setup', 'Codex CLI setup', 'Cursor setup', 'VS Code setup',
    ]);
    expect(setups.every(({ copyText }) => copyText.includes('https://canonical.example/mcp'))).toBe(true);
    expect(setups.every(({ authSummary }) => authSummary.includes('No authentication'))).toBe(true);
  });

  it('states that each OAuth client requests authorization without client secrets', () => {
    const setups = generateClientSetups(makeServer({
      requiresOAuth: true,
      declaredAuthType: 'oauth',
      authType: 'oauth',
    }));

    for (const setup of setups) {
      expect(`${setup.copyText} ${setup.authSummary} ${setup.notes.join(' ')}`).toContain('authorization');
      expect(setup.copyText.toLowerCase()).not.toContain('client-secret');
      expect(setup.copyText.toLowerCase()).not.toContain('client_secret');
    }
    expect(setups[0].copyText).toContain('claude mcp login');
    expect(setups[1].copyText).toContain('codex mcp login');
  });

  it('uses named secure placeholders for Bearer and API-key headers', () => {
    const bearer = generateClientSetups(makeServer({
      id: 'private-data', declaredAuthType: 'bearer-token', authType: 'bearer-token',
    }));
    expect(bearer[0].copyText).toContain(`'Authorization: Bearer '"\${PRIVATE_DATA_TOKEN}"`);
    expect(bearer[1].copyText).toContain('--bearer-token-env-var');
    expect(bearer[2].copyText).toContain('Bearer ${env:PRIVATE_DATA_TOKEN}');
    expect(bearer[3].copyText).toContain('${input:private_data_token}');
    expect(bearer.flatMap(({ notes }) => notes).join(' ')).toContain('never commit the value');

    const apiKey = generateClientSetups(makeServer({
      id: 'key-service', declaredAuthType: 'api-key', authType: 'api-key',
      requiredHeaders: [{
        name: 'X-API-Key', description: 'Required credential: <KEY_SERVICE_API_KEY>',
        required: true, secret: true,
      }],
    }));
    expect(apiKey[0].copyText).toContain(`'X-API-Key: '"\${KEY_SERVICE_API_KEY}"`);
    expect(apiKey[3].copyText).toContain('${input:key_service_api_key}');
  });

  it('keeps non-Bearer alternative authorization syntax exact', () => {
    const setups = generateClientSetups(makeServer({
      id: 'pagerduty', requiresOAuth: true,
      declaredAuthType: 'oauth', authType: 'oauth',
      alternativeAuthTypes: ['api-token'],
      requiredHeaders: [{
        name: 'Authorization',
        description: 'Optional PagerDuty API token syntax: Token token=<PAGERDUTY_API_TOKEN>',
        required: false, secret: true,
      }],
    }));
    const renderedGuidance = setups.flatMap(({ notes }) => notes).join('\n');
    expect(renderedGuidance).toContain('Token token=<PAGERDUTY_API_TOKEN>');
    expect(renderedGuidance).toContain('secret manager');
  });

  it('preserves required-header guidance and does not invent missing API-key syntax', () => {
    const setups = generateClientSetups(makeServer({
      declaredAuthType: 'api-key', authType: 'api-key',
      requiredHeaders: [{
        name: 'X-Region', description: 'Select the account region', required: true, secret: false,
      }],
    }));
    expect(setups.every(({ supported }) => !supported)).toBe(true);
    expect(setups.flatMap(({ notes }) => notes).join(' ')).toContain('Required header X-Region');
    expect(setups.flatMap(({ notes }) => notes).join(' ')).toContain('does not document');
  });

  it('represents legacy SSE honestly for each client', () => {
    const setups = generateClientSetups(makeServer({
      url: 'https://legacy.example/sse',
      declaredTransport: 'legacy-sse', transport: 'legacy-sse',
    }));
    expect(setups[0].copyText).toContain('--transport sse');
    expect(setups[1]).toMatchObject({ supported: false, format: 'text' });
    expect(setups[1].copyText).toContain('not legacy SSE');
    expect(JSON.parse(setups[2].copyText).mcpServers['example-server'].url).toContain('/sse');
    expect(JSON.parse(setups[3].copyText).servers['example-server'].type).toBe('sse');
  });

  it('does not fabricate credentials for unknown authentication', () => {
    const setups = generateClientSetups(makeServer({
      declaredAuthType: 'unknown', authType: 'unknown',
    }));
    expect(setups.flatMap(({ notes }) => notes).join(' ')).toContain('Confirm the authentication method');
    expect(setups.map(({ copyText }) => copyText).join(' ')).not.toMatch(/TOKEN|API_KEY|Authorization/);
  });
});
