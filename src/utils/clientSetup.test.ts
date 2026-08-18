import { describe, expect, it } from 'vitest';
import type { CatalogServer } from '../types/catalog';
import { getCatalogServerById } from './catalogUtils';
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

const documentedRedirects = {
  'claude-code': ['http://localhost:8080/callback'],
  'codex-cli': ['http://localhost:3334/oauth/callback'],
  cursor: ['cursor://anysphere.cursor-mcp/oauth/callback'],
  'vs-code': ['http://127.0.0.1:33418/', 'https://vscode.dev/redirect'],
};

const makePreRegisteredServer = (
  redirectUrls: Partial<typeof documentedRedirects> = structuredClone(documentedRedirects)
): CatalogServer => makeServer({
  requiresOAuth: true,
  declaredAuthType: 'oauth',
  authType: 'oauth',
  oauthRegistration: {
    mode: 'pre-registered-required',
    clientId: { required: true, environmentVariable: 'EXAMPLE_CLIENT_ID' },
    clientSecret: { required: true, environmentVariable: 'EXAMPLE_CLIENT_SECRET' },
    callback: { required: true, redirectUrls },
    codexMcpRemote: { resourceUrl: 'https://canonical.example', callbackPort: 3334 },
    evidenceUrl: 'https://example.com/oauth-registration',
  },
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
    expect(setups[0].copyText).toBe(
      "claude mcp add --transport http --scope user 'example-server' 'https://canonical.example/mcp'"
    );
    expect(setups[0].copyText).not.toContain('claude mcp login');
    expect(setups[0].notes).toContain(
      'After adding the server, open Claude Code, run /mcp, select the server, and follow the browser flow to authenticate.'
    );
    expect(setups[1].copyText).toContain('codex mcp login');
  });

  it('uses Asana publisher evidence for every pre-registered OAuth client', () => {
    const asana = getCatalogServerById('asana');
    expect(asana).toBeDefined();
    const [claude, codex, cursor, vscode] = generateClientSetups(asana!);

    expect(claude.copyText).toBe(
      'claude mcp add --transport http --scope user --client-id "${ASANA_CLIENT_ID}" --client-secret --callback-port 8080 \'asana\' \'https://mcp.asana.com/v2/mcp\''
    );
    expect(claude.copyText.indexOf('--callback-port 8080')).toBeLessThan(
      claude.copyText.indexOf("'asana'")
    );
    expect(claude.notes.join(' ')).toContain('masked prompt');
    expect(claude.notes).toContain(
      'Register this exact Claude Code redirect URL: http://localhost:8080/callback.'
    );

    expect(codex.copyText).toContain('[mcp_servers.asana]');
    expect(codex.copyText).toContain('mcp-remote@latest');
    expect(codex.copyText).toContain('ASANA_CLIENT_ID');
    expect(codex.copyText).toContain('ASANA_CLIENT_SECRET');
    expect(codex.copyText).not.toContain('codex mcp login');

    expect(JSON.parse(cursor.copyText).mcpServers.asana.auth).toEqual({
      CLIENT_ID: '${env:ASANA_CLIENT_ID}',
      CLIENT_SECRET: '${env:ASANA_CLIENT_SECRET}',
    });
    expect(`${vscode.location} ${vscode.notes.join(' ')}`).toContain('natively prompts');
    expect(vscode.notes.join(' ')).toContain('http://127.0.0.1:33418/');
    expect(vscode.notes.join(' ')).toContain('https://vscode.dev/redirect');
    expect(vscode.notes).toContain(
      'Register these exact VS Code redirect URLs: http://127.0.0.1:33418/, https://vscode.dev/redirect.'
    );

    const rendered = [claude, codex, cursor, vscode]
      .map((setup) => `${setup.copyText} ${setup.authSummary} ${setup.notes.join(' ')}`)
      .join('\n');
    expect(rendered).not.toContain('no OAuth secret belongs in this configuration');
    expect(rendered).not.toContain('the client will request authorization');
  });

  it.each([
    ['claude-code', 0],
    ['codex-cli', 1],
    ['cursor', 2],
    ['vs-code', 3],
  ] as const)('marks only %s unsupported when its callback evidence is absent', (clientId, index) => {
    const redirectUrls = structuredClone(documentedRedirects);
    delete redirectUrls[clientId];

    const setups = generateClientSetups(makePreRegisteredServer(redirectUrls));
    expect(setups[index]).toMatchObject({ id: clientId, supported: false, format: 'text' });
    expect(setups[index].unsupportedReasons.join(' ')).toMatch(/redirect|callback/);
    expect(setups[index].copyText).toContain('setup is unavailable');
    expect(setups.filter((_, setupIndex) => setupIndex !== index).every(({ supported }) => supported))
      .toBe(true);
    expect(setups.flatMap(({ notes }) => notes).join(' ')).not.toMatch(/redirect URL:\s*\./);
  });

  it('rejects unusable callback evidence for all four pre-registered OAuth setups', () => {
    const setups = generateClientSetups(makePreRegisteredServer({
      'claude-code': ['https://localhost:8080/callback'],
      'codex-cli': ['http://localhost:4444/oauth/callback'],
      cursor: ['file:///cursor/callback'],
      'vs-code': ['cursor://anysphere.cursor-mcp/oauth/callback'],
    }));

    expect(setups.every(({ supported, format }) => !supported && format === 'text')).toBe(true);
    expect(setups.every(({ copyText }) => copyText.includes('setup is unavailable'))).toBe(true);
    expect(setups.flatMap(({ notes }) => notes).join(' ')).not.toMatch(/redirect URL:\s*\./);
  });

  it('prefers PagerDuty API tokens when automatic OAuth registration is unavailable', () => {
    const pagerduty = getCatalogServerById('pagerduty');
    expect(pagerduty).toBeDefined();
    const setups = generateClientSetups(pagerduty!);

    expect(pagerduty!.oauthRegistration).toMatchObject({
      mode: 'unavailable-or-use-alternative',
      clientId: { required: false },
      clientSecret: { required: false },
      callback: { required: false, redirectUrls: {} },
      alternativeAuthType: 'api-token',
    });
    expect(pagerduty!.oauthRegistration?.clientId.environmentVariable).toBeUndefined();
    expect(pagerduty!.oauthRegistration?.clientSecret.environmentVariable).toBeUndefined();

    expect(setups[0].copyText).toContain(
      `--header 'Authorization: Token token='"\${PAGERDUTY_API_TOKEN}"`
    );
    expect(setups[1].copyText).toContain('env_http_headers = { "Authorization"');
    expect(JSON.parse(setups[2].copyText).mcpServers.pagerduty.headers.Authorization)
      .toBe('Token token=${env:PAGERDUTY_API_TOKEN}');
    expect(JSON.parse(setups[3].copyText).servers.pagerduty.headers.Authorization)
      .toBe('Token token=${input:pagerduty_api_token}');

    for (const setup of setups) {
      const rendered = `${setup.copyText} ${setup.authSummary} ${setup.notes.join(' ')}`;
      expect(rendered).toContain('Token token=<PAGERDUTY_API_TOKEN>');
      expect(rendered).toContain('https://mcp.eu.pagerduty.com/mcp');
      expect(rendered).not.toContain('no OAuth secret belongs in this configuration');
      expect(rendered).not.toContain('codex mcp login');
    }
  });

  it('uses named secure placeholders for Bearer and API-key headers', () => {
    const bearer = generateClientSetups(makeServer({
      id: 'private-data', declaredAuthType: 'bearer-token', authType: 'bearer-token',
    }));
    expect(bearer[0].copyText).toBe(
      `claude mcp add --transport http --scope user --header 'Authorization: Bearer '"\${PRIVATE_DATA_TOKEN}" 'private-data' 'https://canonical.example/mcp'`
    );
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

  it('uses one Codex environment variable for a raw API-key header value', () => {
    const codex = generateClientSetups(makeServer({
      id: 'key-service', declaredAuthType: 'api-key', authType: 'api-key',
      requiredHeaders: [{
        name: 'X-API-Key', description: 'Required credential: <KEY_SERVICE_API_KEY>',
        required: true, secret: true,
      }],
    }))[1];

    expect(codex.copyText).toBe([
      '[mcp_servers.key-service]',
      'url = "https://canonical.example/mcp"',
      'env_http_headers = { "X-API-Key" = "KEY_SERVICE_API_KEY_HEADER" }',
    ].join('\n'));
    expect(codex.location).toBe(
      'Add to ~/.codex/config.toml, then securely set KEY_SERVICE_API_KEY_HEADER to the raw credential value, which is the complete X-API-Key header value.'
    );
    expect(codex.notes).toContain(
      'Store KEY_SERVICE_API_KEY_HEADER in your operating system keychain, secret manager, or protected environment; never commit the value. Set it to the raw credential value, which is the complete X-API-Key header value.'
    );
  });

  it('uses one Codex environment variable for a complete prefixed header value', () => {
    const codex = generateClientSetups(makeServer({
      id: 'pagerduty', declaredAuthType: 'api-token', authType: 'api-token',
      requiredHeaders: [{
        name: 'Authorization',
        description: 'PagerDuty API token syntax: Token token=<PAGERDUTY_API_TOKEN>',
        required: true, secret: true,
      }],
    }))[1];

    expect(codex.copyText).toBe([
      '[mcp_servers.pagerduty]',
      'url = "https://canonical.example/mcp"',
      'env_http_headers = { "Authorization" = "PAGERDUTY_API_TOKEN_HEADER" }',
    ].join('\n'));
    expect(codex.location).toBe(
      'Add to ~/.codex/config.toml, then securely set PAGERDUTY_API_TOKEN_HEADER to the complete Authorization header value, including the required syntax Token token=<credential>.'
    );
    expect(codex.notes).toContain(
      'Store PAGERDUTY_API_TOKEN_HEADER in your operating system keychain, secret manager, or protected environment; never commit the value. Set it to the complete Authorization header value, including the required syntax Token token=<credential>.'
    );
  });

  it('serializes every required secret and non-secret header for every client', () => {
    const setups = generateClientSetups(makeServer({
      id: 'multi-header', declaredAuthType: 'api-key', authType: 'api-key',
      requiredHeaders: [
        {
          name: 'X-API-Key', description: 'Primary credential: <PRIMARY_API_KEY>',
          required: true, secret: true,
        },
        {
          name: 'X-API-Secret', description: 'Secondary credential: <SECONDARY_API_SECRET>',
          required: true, secret: true,
        },
        {
          name: 'X-Account-Region', description: 'Account region: <ACCOUNT_REGION>',
          required: true, secret: false,
        },
      ],
    }));

    expect(setups.every(({ supported }) => supported)).toBe(true);
    for (const headerName of ['X-API-Key', 'X-API-Secret', 'X-Account-Region']) {
      expect(setups[0].copyText).toContain(`--header '${headerName}: '`);
      expect(setups[1].copyText).toContain(`"${headerName}"`);
    }
    expect(setups[0].copyText.match(/--header/g)).toHaveLength(3);
    expect(setups[1].copyText).toContain('"PRIMARY_API_KEY_HEADER"');
    expect(setups[1].copyText).toContain('"SECONDARY_API_SECRET_HEADER"');
    expect(setups[1].copyText).toContain('"ACCOUNT_REGION_HEADER"');

    const cursor = JSON.parse(setups[2].copyText).mcpServers['multi-header'];
    expect(cursor.headers).toEqual({
      'X-API-Key': '${env:PRIMARY_API_KEY}',
      'X-API-Secret': '${env:SECONDARY_API_SECRET}',
      'X-Account-Region': '${env:ACCOUNT_REGION}',
    });
    const vscode = JSON.parse(setups[3].copyText);
    expect(vscode.servers['multi-header'].headers).toEqual({
      'X-API-Key': '${input:primary_api_key}',
      'X-API-Secret': '${input:secondary_api_secret}',
      'X-Account-Region': '${input:account_region}',
    });
    expect(vscode.inputs.map(({ password }: { password: boolean }) => password)).toEqual([
      true, true, false,
    ]);
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
    expect(setups.every(({ format }) => format === 'text')).toBe(true);
    expect(setups.every(({ copyText }) => copyText.includes('setup is unavailable'))).toBe(true);
    expect(setups.every(({ copyText }) => !copyText.includes('https://canonical.example/mcp'))).toBe(true);
    expect(setups.every(({ unsupportedReasons }) => (
      unsupportedReasons.some((reason) => reason.includes('X-Region'))
    ))).toBe(true);
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
