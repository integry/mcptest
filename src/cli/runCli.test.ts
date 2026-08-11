import { describe, expect, it } from 'vitest';
import {
  ReleaseGateConfigurationError,
  parseReleaseGateArgs,
  releaseGateHelp,
} from './runCli';

describe('release gate CLI configuration', () => {
  it('reads multiple endpoints and bearer credentials without putting the secret in arguments', () => {
    const configuration = parseReleaseGateArgs([
      '--endpoints-env', 'MCP_ENDPOINTS',
      '--bearer-token-env', 'MCP_BEARER',
    ], {
      MCP_ENDPOINTS: 'https://one.example/mcp\nhttps://two.example/sse',
      MCP_BEARER: 'bearer-fixture-secret',
    });

    expect(configuration.endpoints).toEqual([
      'https://one.example/mcp',
      'https://two.example/sse',
    ]);
    expect(configuration.headers?.get('authorization')).toBe('Bearer bearer-fixture-secret');
    expect(configuration.consumedSecretEnvironmentVariables).toEqual(['MCP_BEARER']);
    expect(JSON.stringify(configuration.endpoints)).not.toContain('bearer-fixture-secret');
  });

  it('supports API keys and deterministic default thresholds', () => {
    const configuration = parseReleaseGateArgs([
      '--api-key-env', 'MCP_API_KEY',
      'public.example/mcp',
    ], { MCP_API_KEY: 'api-fixture-secret' });

    expect(configuration.headers?.get('x-api-key')).toBe('api-fixture-secret');
    expect([...configuration.policy.failOnResults]).toEqual(['blocked', 'unknown']);
    expect(configuration.policy.failOnSeverity).toBe('high');
  });

  it.each([
    [['--bearer-token', 'secret', 'https://fixture.example/mcp'], {}, 'Unknown option --bearer-token.'],
    [['https://user:secret@fixture.example/mcp'], {}, 'Endpoint userinfo is not allowed'],
    [['https://fixture.example/mcp?api_key=secret'], {}, 'Credential-like endpoint query parameters are not allowed'],
    [['https://fixture.example/mcp#access_token=secret'], {}, 'Endpoint URL fragments are not allowed'],
    [['--bearer-token-env', 'TOKEN', 'https://fixture.example/mcp'], {}, 'Environment variable TOKEN is empty or missing'],
  ] as const)('rejects unsafe or invalid credential configuration', (argv, environment, message) => {
    expect(() => parseReleaseGateArgs(argv, environment)).toThrowError(
      expect.objectContaining<Partial<ReleaseGateConfigurationError>>({ message: expect.stringContaining(message) })
    );
  });

  it('documents all stable exit codes and the non-interactive OAuth outcome', () => {
    expect(releaseGateHelp).toContain('0 pass');
    expect(releaseGateHelp).toContain('1 configured threshold failed');
    expect(releaseGateHelp).toContain('2 browser authorization required');
    expect(releaseGateHelp).toContain('3 invalid configuration');
    expect(releaseGateHelp).toContain('4 infrastructure');
    expect(releaseGateHelp).toContain('Browser OAuth is intentionally non-interactive');
  });
});
