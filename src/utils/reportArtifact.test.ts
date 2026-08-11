import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import publicJsonSchema from '../../public/schemas/report/v1.schema.json';
import type { EvaluationReport, EvaluationSection } from './evaluation';
import {
  REPORT_SCHEMA_URL,
  createPublicReport,
  parsePublicReportJson,
  redactReportString,
  redactReportValue,
  safeParsePublicReport,
  serializePublicReportJson,
  serializePublicReportMarkdown,
  validatePublicReport,
} from './reportArtifact';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validatePublishedSchema = ajv.compile(publicJsonSchema);

const FIXED_OPTIONS = {
  generatedAt: '2026-08-11T12:44:04.000Z',
  toolVersion: '1.2.3',
  toolCommit: '0123456789abcdef',
};

const section = (
  name: string,
  score: number,
  maxScore: number,
  metadata: Record<string, unknown> = {},
  overrides: Partial<EvaluationSection> = {}
): EvaluationSection => ({
  name,
  description: `${name} description`,
  score,
  maxScore,
  details: [{
    text: `✓ ${name} evidence`,
    context: `${name} context`,
    metadata,
  }],
  ...overrides,
});

const publicReport = (): EvaluationReport => ({
  serverUrl: 'https://public.example/mcp?tenant=demo',
  outcome: 'scored',
  finalScore: 55,
  sections: {
    protocol: section('Core Protocol', 15, 15, {
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
      endpoint: 'https://public.example/mcp?tenant=demo',
      route: 'direct',
      optionalDetail: undefined,
    }),
    capabilities: section('Capabilities', 10, 10, {
      method: 'tools/list',
      itemCount: 2,
      durationMs: 18,
    }),
    transport: section('Transport', 15, 15, {
      transportType: 'streamable-http',
      endpoint: 'https://public.example/mcp?tenant=demo',
      protocolEra: 'modern',
    }),
    performance: section('Performance', 15, 15, {
      durationMs: 240,
      category: 'excellent',
    }),
  },
});

const authorizationRequiredReport = (): EvaluationReport => ({
  serverUrl: 'https://protected.example/mcp?access_token=target-token',
  authenticationUrl: 'https://protected.example/mcp?code=authorization-code',
  outcome: 'authorization-required',
  finalScore: 0,
  sections: {
    auth: section('Authorization Required', 0, 0, {
      route: 'direct',
      status: 401,
      endpoint: 'https://protected.example/mcp?access_token=target-token',
      authorization: 'Bearer secret-access-token',
    }, {
      description: 'OAuth authorization is required before evaluation',
      details: [{
        text: '⚠ Authorize before running the report; access_token=secret-access-token',
        context: 'The endpoint returned 401 with Bearer secret-access-token.',
        metadata: {
          route: 'direct',
          status: 401,
          endpoint: 'https://protected.example/mcp?access_token=target-token',
          authorization: 'Bearer secret-access-token',
        },
      }],
    }),
  },
});

const statefulReport = (): EvaluationReport => ({
  serverUrl: 'https://stateful.example/mcp',
  outcome: 'scored',
  finalScore: 45,
  sections: {
    protocol: section('Core Protocol', 15, 15, {
      protocolEra: 'legacy',
      protocolVersion: '2025-11-25',
      endpoint: 'https://stateful.example/mcp',
      route: 'authenticated proxy',
    }),
    capabilities: section('Capabilities', 10, 10, { method: 'resources/list', durationMs: 35 }),
    transport: section('Transport', 15, 15, {
      transportType: 'streamable-http',
      protocolEra: 'legacy',
      endpoint: 'https://stateful.example/mcp',
    }),
    cors: section('Browser Accessibility', 0, 15, {
      endpoint: 'https://stateful.example/mcp',
      requiredHeaders: ['mcp-session-id'],
    }),
    performance: section('Performance', 5, 15, { durationMs: 3200, category: 'slow' }),
  },
});

const statelessReport = (): EvaluationReport => ({
  ...publicReport(),
  serverUrl: 'https://stateless.example/mcp',
  finalScore: 70,
  sections: {
    ...publicReport().sections,
    protocol: section('Core Protocol', 15, 15, {
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
      endpoint: 'https://stateless.example/mcp',
      route: 'direct',
    }),
    transport: section('Transport', 15, 15, {
      transportType: 'streamable-http',
      protocolEra: 'modern',
      endpoint: 'https://stateless.example/mcp',
    }),
    cors: section('Browser Accessibility', 15, 15, {
      endpoint: 'https://stateless.example/mcp',
      requiredHeaders: ['mcp-protocol-version', 'mcp-method', 'mcp-name'],
    }),
  },
});

const legacySseReport = (): EvaluationReport => ({
  serverUrl: 'https://legacy.example/events',
  outcome: 'scored',
  finalScore: 51,
  sections: {
    protocol: section('Core Protocol', 15, 15, {
      protocolEra: 'legacy',
      protocolVersion: '2025-03-26',
      endpoint: 'https://legacy.example/events',
      route: 'direct',
    }),
    capabilities: section('Capabilities', 10, 10, { method: 'prompts/list', durationMs: 52 }),
    transport: section('Transport', 6, 15, {
      transportType: 'legacy-sse',
      protocolEra: 'legacy',
      endpoint: 'https://legacy.example/events',
    }),
    cors: section('Browser Accessibility', 15, 15),
    performance: section('Performance', 5, 15, { durationMs: 2800, category: 'slow' }),
  },
});

const partialReport = (): EvaluationReport => ({
  serverUrl: 'https://partial.example/mcp',
  outcome: 'partial',
  finalScore: 15,
  sections: {
    protocol: section('Core Protocol', 15, 15, {
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
      endpoint: 'https://partial.example/mcp',
      route: 'direct',
    }),
    capabilities: section('Capabilities', 0, 10, {}, {
      status: 'skipped',
      details: [{ text: '⚠ Capability checks were skipped after the connection closed.' }],
    }),
  },
});

const legacyPartialReport = (): EvaluationReport => ({
  serverUrl: 'https://legacy-partial.example/mcp',
  finalScore: 15,
  sections: {
    protocol: section('Core Protocol', 15, 15, {
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
      endpoint: 'https://legacy-partial.example/mcp',
      route: 'direct',
    }),
    capabilities: section('Capabilities', 0, 10, {}, {
      details: [{ text: '⚠ Capability checks were skipped after the connection closed.' }],
    }),
  },
});

const failedReport = (): EvaluationReport => ({
  serverUrl: 'https://failed.example/mcp?api_key=do-not-export',
  outcome: 'failed',
  finalScore: 0,
  sections: {
    protocol: section('Core Protocol', 0, 15, {}, {
      status: 'failed',
      details: [{
        text: '⚠ MCP negotiation failed: Authorization: Bearer super-secret',
        context: 'Direct target failed; proxy URL https://proxy.example/?target=https%3A%2F%2Ffailed.example%2Fmcp%3Ftoken%3Dnested-secret',
        metadata: {
          route: 'authenticated proxy',
          routeFailures: [
            { route: 'direct', message: 'Direct target failed' },
            { route: 'authenticated proxy', message: 'Proxy negotiation failed' },
          ],
        },
      }],
    }),
    capabilities: section('Capabilities', 0, 10, {}, {
      details: [{ text: '⚠ Capability checks were skipped because no MCP connection was established.' }],
    }),
    transport: section('Transport', 0, 15, {}, {
      details: [{ text: '⚠ No standard MCP transport completed negotiation.' }],
    }),
    cors: section('Browser Accessibility', 0, 15, {}, {
      details: [{ text: '⚠ Browser accessibility could not be isolated.' }],
    }),
    performance: section('Performance', 0, 15, {}, {
      details: [{ text: '⚠ Performance was not scored because negotiation failed.' }],
    }),
  },
});

const GOLDEN_REPORTS: Record<string, () => EvaluationReport> = {
  public: publicReport,
  'oauth-required-unscored': authorizationRequiredReport,
  stateful: statefulReport,
  stateless: statelessReport,
  'legacy-sse': legacySseReport,
  partial: partialReport,
  'legacy-partial-without-status': legacyPartialReport,
  failed: failedReport,
};

describe('versioned public report artifacts', () => {
  it.each(Object.entries(GOLDEN_REPORTS))('matches the %s JSON and Markdown golden', (name, makeReport) => {
    const artifact = createPublicReport(makeReport(), FIXED_OPTIONS);
    expect({
      name,
      json: serializePublicReportJson(artifact),
      markdown: serializePublicReportMarkdown(artifact),
    }).toMatchSnapshot();
  });

  it('is deterministic with injected generation and tool metadata', () => {
    const first = createPublicReport(publicReport(), FIXED_OPTIONS);
    const second = createPublicReport(publicReport(), FIXED_OPTIONS);

    expect(serializePublicReportJson(first)).toBe(serializePublicReportJson(second));
    expect(serializePublicReportMarkdown(first)).toBe(serializePublicReportMarkdown(second));
  });

  it('parses and validates supported artifacts for future CI consumers', () => {
    const artifact = createPublicReport(publicReport(), FIXED_OPTIONS);
    const serialized = serializePublicReportJson(artifact);

    expect(parsePublicReportJson(serialized)).toEqual(artifact);
    expect(validatePublicReport(artifact)).toEqual(artifact);
    expect(safeParsePublicReport({ ...artifact, schemaVersion: '2.0.0' }).success).toBe(false);
    expect(safeParsePublicReport({ ...artifact, score: null }).success).toBe(false);
    expect(safeParsePublicReport({
      ...artifact,
      outcome: { status: 'failed', summary: 'Failed.' },
    }).success).toBe(false);
    expect(() => parsePublicReportJson('{"not":"a report"}')).toThrow();
  });

  it('publishes a matching versioned JSON Schema identifier', () => {
    expect(publicJsonSchema.$id).toBe(REPORT_SCHEMA_URL);
    expect(publicJsonSchema.properties.schemaVersion.const).toBe('1.0.0');
  });

  it.each(Object.entries(GOLDEN_REPORTS))('validates the %s artifact with the published JSON Schema', (_, makeReport) => {
    const artifact = createPublicReport(makeReport(), FIXED_OPTIONS);

    expect(validatePublishedSchema(artifact), JSON.stringify(validatePublishedSchema.errors)).toBe(true);
  });

  it.each(['scored', 'partial', 'failed'] as const)(
    'forbids authorization prerequisites on %s outcomes in both schemas',
    (status) => {
      const base = createPublicReport(
        status === 'scored' ? publicReport() : status === 'partial' ? partialReport() : failedReport(),
        FIXED_OPTIONS
      );
      const contradictory = {
        ...base,
        outcome: {
          ...base.outcome,
          authorizationPrerequisite: {
            required: true,
            state: 'authorization-required',
            message: 'Contradictory prerequisite.',
          },
        },
      };

      expect(safeParsePublicReport(contradictory).success).toBe(false);
      expect(
        validatePublishedSchema(contradictory),
        JSON.stringify(validatePublishedSchema.errors)
      ).toBe(false);
    }
  );

  it('requires authorization prerequisites on authorization-required outcomes in both schemas', () => {
    const artifact = createPublicReport(authorizationRequiredReport(), FIXED_OPTIONS);
    const invalid = {
      ...artifact,
      outcome: {
        status: artifact.outcome.status,
        summary: artifact.outcome.summary,
      },
    };

    expect(safeParsePublicReport(invalid).success).toBe(false);
    expect(
      validatePublishedSchema(invalid),
      JSON.stringify(validatePublishedSchema.errors)
    ).toBe(false);
  });

  it.each(['failed', 'skipped', 'prerequisite'] as const)(
    'requires a null earned score for %s sections in both schemas',
    (status) => {
      const artifact = createPublicReport(partialReport(), FIXED_OPTIONS);
      const invalid = structuredClone(artifact);
      invalid.sections[1].status = status;
      invalid.sections[1].score.earned = 0;

      expect(safeParsePublicReport(invalid).success).toBe(false);
      expect(
        validatePublishedSchema(invalid),
        JSON.stringify(validatePublishedSchema.errors)
      ).toBe(false);
    }
  );

  it.each(['partial', 'failed', 'skipped', 'prerequisite'] as const)(
    'rejects a scored artifact containing a %s section in both schemas',
    (status) => {
      const invalid = structuredClone(createPublicReport(publicReport(), FIXED_OPTIONS));
      invalid.sections[0].status = status;
      invalid.sections[0].score.earned = status === 'partial' ? 15 : null;

      expect(safeParsePublicReport(invalid).success).toBe(false);
      expect(
        validatePublishedSchema(invalid),
        JSON.stringify(validatePublishedSchema.errors)
      ).toBe(false);
    }
  );

  it('rejects a scored artifact containing a null-earned evaluated section in both schemas', () => {
    const invalid = structuredClone(createPublicReport(publicReport(), FIXED_OPTIONS));
    invalid.sections[0].score.earned = null;

    expect(safeParsePublicReport(invalid).success).toBe(false);
    expect(
      validatePublishedSchema(invalid),
      JSON.stringify(validatePublishedSchema.errors)
    ).toBe(false);
  });

  it.each(['partial', 'failed'] as const)(
    'rejects a null-earned evaluated section in a %s artifact in both schemas',
    (status) => {
      const invalid = structuredClone(createPublicReport(
        status === 'partial' ? partialReport() : failedReport(),
        FIXED_OPTIONS
      ));
      invalid.sections[0].status = 'evaluated';
      invalid.sections[0].score.earned = null;

      expect(safeParsePublicReport(invalid).success).toBe(false);
      expect(
        validatePublishedSchema(invalid),
        JSON.stringify(validatePublishedSchema.errors)
      ).toBe(false);
    }
  );

  it.each([
    ['direct', false],
    ['authenticated-proxy', true],
    ['unknown', null],
  ] as const)('accepts the consistent %s provenance pair in both schemas', (route, proxyUsed) => {
    const artifact = createPublicReport(publicReport(), FIXED_OPTIONS);
    const candidate = { ...artifact, provenance: { route, proxyUsed } };

    expect(safeParsePublicReport(candidate).success).toBe(true);
    expect(
      validatePublishedSchema(candidate),
      JSON.stringify(validatePublishedSchema.errors)
    ).toBe(true);
  });

  it.each([
    ['direct', true],
    ['direct', null],
    ['authenticated-proxy', false],
    ['authenticated-proxy', null],
    ['unknown', false],
    ['unknown', true],
  ] as const)('rejects the contradictory %s/%s provenance pair in both schemas', (route, proxyUsed) => {
    const artifact = createPublicReport(publicReport(), FIXED_OPTIONS);
    const contradictory = { ...artifact, provenance: { route, proxyUsed } };

    expect(safeParsePublicReport(contradictory).success).toBe(false);
    expect(
      validatePublishedSchema(contradictory),
      JSON.stringify(validatePublishedSchema.errors)
    ).toBe(false);
  });

  it('validates percentage consistency with an explicit numerical tolerance', () => {
    const artifact = createPublicReport(publicReport(), FIXED_OPTIONS);
    const withinTolerance = structuredClone(artifact);
    const inconsistent = structuredClone(artifact);
    withinTolerance.score!.percentage -= 5e-10;
    inconsistent.score!.percentage -= 1e-6;

    expect(safeParsePublicReport(withinTolerance).success).toBe(true);
    expect(safeParsePublicReport(inconsistent).success).toBe(false);
    expect(() => parsePublicReportJson(JSON.stringify(inconsistent))).toThrow(
      'The percentage must equal earned / maximum * 100.'
    );
  });

  it('redacts secrets recursively, including embedded and nested URL values', () => {
    const artifact = createPublicReport(authorizationRequiredReport(), FIXED_OPTIONS);
    const failedArtifact = createPublicReport(failedReport(), FIXED_OPTIONS);
    const output = `${serializePublicReportJson(artifact)}${serializePublicReportMarkdown(artifact)}${serializePublicReportJson(failedArtifact)}`;

    expect(output).not.toContain('secret-access-token');
    expect(output).not.toContain('authorization-code');
    expect(output).not.toContain('do-not-export');
    expect(output).not.toContain('nested-secret');
    expect(output).not.toContain('super-secret');
    expect(output).toContain('%5BREDACTED%5D');
    expect(redactReportValue({
      client_secret: 'client-value',
      cookie: 'session=value',
      safe: 'visible',
      code_challenge_methods_supported: ['S256'],
    })).toEqual({
      client_secret: '[REDACTED]',
      cookie: '[REDACTED]',
      safe: 'visible',
      code_challenge_methods_supported: ['S256'],
    });
  });

  it('redacts OAuth credential parameters from URLs using canonicalized names', () => {
    const output = redactReportString(
      'https://client.example/authorize?id_token_hint=url-id-secret&client-assertion=url-assertion-secret&deviceCode=url-device-secret&user_code=url-user-secret&display=visible'
    );

    for (const secret of ['url-id-secret', 'url-assertion-secret', 'url-device-secret', 'url-user-secret']) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('display=visible');
  });

  it('redacts OAuth credential parameters from plain-text assignments', () => {
    const output = redactReportString(
      'id_token_hint=plain-id-secret client-assertion=plain-assertion-secret deviceCode=plain-device-secret user_code=plain-user-secret'
    );

    for (const secret of [
      'plain-id-secret',
      'plain-assertion-secret',
      'plain-device-secret',
      'plain-user-secret',
    ]) {
      expect(output).not.toContain(secret);
    }
  });

  it('redacts OAuth credential parameters from structured metadata', () => {
    expect(redactReportValue({
      id_token_hint: 'metadata-id-secret',
      'client-assertion': 'metadata-assertion-secret',
      deviceCode: 'metadata-device-secret',
      user_code: 'metadata-user-secret',
      display: 'visible',
    })).toEqual({
      id_token_hint: '[REDACTED]',
      'client-assertion': '[REDACTED]',
      deviceCode: '[REDACTED]',
      user_code: '[REDACTED]',
      display: 'visible',
    });
  });

  it('redacts JSON-shaped credentials and complete authorization and cookie headers in every export path', () => {
    const jsonShaped = '{"access_token":"json-report-secret"}';
    const authorization = 'Authorization: ApiKey authorization-report-secret';
    const cookies = 'Cookie: a=cookie-one-secret; b=cookie-two-secret';

    expect(redactReportString(jsonShaped)).toBe('{"access_token":"[REDACTED]"}');
    expect(redactReportString(authorization)).toBe('Authorization: [REDACTED]');
    expect(redactReportString(cookies)).toBe('Cookie: [REDACTED]');
    expect(redactReportValue({ jsonShaped, authorizationHeader: authorization, cookieHeader: cookies })).toEqual({
      jsonShaped: '{"access_token":"[REDACTED]"}',
      authorizationHeader: 'Authorization: [REDACTED]',
      cookieHeader: 'Cookie: [REDACTED]',
    });

    const artifact = createPublicReport(publicReport(), FIXED_OPTIONS);
    artifact.sections[0].evidence[0] = {
      message: jsonShaped,
      context: authorization,
      metadata: { jsonShaped, authorizationHeader: authorization, cookieHeader: cookies },
    };
    const json = serializePublicReportJson(artifact);
    const markdown = serializePublicReportMarkdown(artifact);

    for (const secret of [
      'json-report-secret',
      'authorization-report-secret',
      'cookie-one-secret',
      'cookie-two-secret',
    ]) {
      expect(json).not.toContain(secret);
      expect(markdown).not.toContain(secret);
    }
  });

  it('redacts nested sensitive assignments to a bounded fixed point in every export path', () => {
    const plaintext = 'error_description=access_token=report-secret';
    const quoted = 'message="client_secret=report-secret"';
    const encodedUrl = 'https://x.example/?error_description=access_token%3Dreport-secret';

    expect(redactReportString(plaintext)).toBe(
      'error_description=access_token=[REDACTED]'
    );
    expect(redactReportString(quoted)).toBe(
      'message="client_secret=[REDACTED]"'
    );
    expect(redactReportString(encodedUrl)).toBe(
      'https://x.example/?error_description=access_token%3D%5BREDACTED%5D'
    );
    expect(redactReportValue({ description: plaintext, message: quoted })).toEqual({
      description: 'error_description=access_token=[REDACTED]',
      message: 'message="client_secret=[REDACTED]"',
    });

    const artifact = createPublicReport(publicReport(), FIXED_OPTIONS);
    artifact.sections[0].evidence[0] = {
      message: plaintext,
      context: quoted,
      metadata: { description: plaintext, callback: encodedUrl },
    };
    const json = serializePublicReportJson(artifact);
    const markdown = serializePublicReportMarkdown(artifact);

    expect(json).not.toContain('report-secret');
    expect(markdown).not.toContain('report-secret');
    expect(json).not.toContain(encodeURIComponent('report-secret'));
    expect(markdown).not.toContain(encodeURIComponent('report-secret'));
    expect(`${json}${markdown}`).toContain('access_token%3D%5BREDACTED%5D');
  });

  it('redacts repeatedly encoded query credentials with a deterministic fail-closed bound', () => {
    const encodedUrl = 'https://x.example/?error_description=access_token%253Dencoded-report-secret';
    expect(redactReportString(encodedUrl)).toBe(
      'https://x.example/?error_description=access_token%253D%255BREDACTED%255D'
    );
    expect(redactReportValue({ callback: encodedUrl })).toEqual({
      callback: 'https://x.example/?error_description=access_token%253D%255BREDACTED%255D',
    });

    let overBoundValue = 'access_token=bounded-report-secret';
    for (let layer = 0; layer < 10; layer += 1) overBoundValue = encodeURIComponent(overBoundValue);
    const overBoundUrl = `https://x.example/?error_description=${overBoundValue}`;
    expect(redactReportString(overBoundUrl)).toBe(
      'https://x.example/?error_description=%5BREDACTED%5D'
    );

    const artifact = createPublicReport(publicReport(), FIXED_OPTIONS);
    artifact.sections[0].evidence[0] = {
      message: encodedUrl,
      metadata: { callback: encodedUrl, bounded: overBoundUrl },
    };
    const json = serializePublicReportJson(artifact);
    const markdown = serializePublicReportMarkdown(artifact);
    for (const secret of ['encoded-report-secret', 'bounded-report-secret']) {
      expect(json).not.toContain(secret);
      expect(markdown).not.toContain(secret);
    }
  });

  it('redacts state, nonce, and csrf across endpoints, nested URLs, metadata, and serialization', () => {
    const report = publicReport();
    report.serverUrl = 'https://target.example/mcp?state=target-state-secret';
    report.authenticationUrl = 'https://auth.example/authorize?nonce=auth-nonce-secret';
    report.sections.protocol.details[0].metadata = {
      ...report.sections.protocol.details[0].metadata as Record<string, unknown>,
      endpoint: 'https://target.example/mcp?csrf=negotiated-csrf-secret',
      callback: 'https://outer.example/?next=https%3A%2F%2Finner.example%2F%3Fstate%3Dnested-state-secret',
      state: 'metadata-state-secret',
      nonce: 'metadata-nonce-secret',
      csrf: 'metadata-csrf-secret',
    };

    const artifact = createPublicReport(report, FIXED_OPTIONS);
    artifact.sections[0].evidence.push({
      message: 'Serializer defense for OAuth correlation values.',
      metadata: {
        state: 'serializer-state-secret',
        nonce: 'serializer-nonce-secret',
        csrf: 'serializer-csrf-secret',
      },
    });
    const output = `${serializePublicReportJson(artifact)}${serializePublicReportMarkdown(artifact)}`;

    for (const secret of [
      'target-state-secret',
      'auth-nonce-secret',
      'negotiated-csrf-secret',
      'nested-state-secret',
      'metadata-state-secret',
      'metadata-nonce-secret',
      'metadata-csrf-secret',
      'serializer-state-secret',
      'serializer-nonce-secret',
      'serializer-csrf-secret',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(artifact.sections[0].evidence[0].metadata).toMatchObject({
      state: '[REDACTED]',
      nonce: '[REDACTED]',
      csrf: '[REDACTED]',
    });
  });

  it('redacts auth and codeVerifier in URLs, assignments, metadata, and both serializers', () => {
    expect(redactReportString('auth=plain-auth-secret codeVerifier=plain-verifier-secret')).toBe(
      'auth=[REDACTED] codeVerifier=[REDACTED]'
    );
    expect(redactReportString(
      'https://proxy.example/?auth=url-auth-secret&code_verifier=url-verifier-secret&visible=yes'
    )).toBe(
      'https://proxy.example/?auth=%5BREDACTED%5D&code_verifier=%5BREDACTED%5D&visible=yes'
    );
    expect(redactReportValue({
      auth: 'metadata-auth-secret',
      codeVerifier: 'metadata-verifier-secret',
      visible: 'yes',
    })).toEqual({
      auth: '[REDACTED]',
      codeVerifier: '[REDACTED]',
      visible: 'yes',
    });

    const artifact = createPublicReport(publicReport(), FIXED_OPTIONS);
    artifact.sections[0].evidence[0] = {
      message: 'message=auth=serialized-auth-secret',
      metadata: {
        description: 'codeVerifier=serialized-verifier-secret',
        endpoint: 'https://proxy.example/?auth=serialized-url-secret',
      },
    };
    const output = `${serializePublicReportJson(artifact)}${serializePublicReportMarkdown(artifact)}`;
    for (const secret of [
      'serialized-auth-secret',
      'serialized-verifier-secret',
      'serialized-url-secret',
    ]) {
      expect(output).not.toContain(secret);
    }
  });

  it('consumes complete quoted secret assignments containing spaces', () => {
    const redacted = redactReportString(
      `password="prefix actual-password" client_secret='prefix actual-secret' safe="visible value"`
    );

    expect(redacted).toBe(
      'password=[REDACTED] client_secret=[REDACTED] safe="visible value"'
    );

    const artifact = createPublicReport(publicReport(), FIXED_OPTIONS);
    artifact.sections[0].evidence[0].message = 'password="prefix serialized-password"';
    artifact.sections[0].evidence[0].context = "client_assertion='prefix serialized-assertion'";
    const output = `${serializePublicReportJson(artifact)}${serializePublicReportMarkdown(artifact)}`;

    expect(output).not.toContain('serialized-password');
    expect(output).not.toContain('serialized-assertion');
  });

  it('closes plain-text, camel-case URL, OAuth state, and deep nested URL bypasses', () => {
    let deeplyNestedUrl = 'https://deep.example/callback?visible=deepest-secret';
    for (let depth = 0; depth < 5; depth += 1) {
      deeplyNestedUrl = `https://level-${depth}.example/next?url=${encodeURIComponent(deeplyNestedUrl)}`;
    }
    const output = redactReportString([
      'token=plain-token secret:plain-secret credentials=plain-credentials oauth_code=plain-code',
      'https://client.example/callback?authToken=url-token&clientCredentials=client-credentials&sessionId=session-value&state=state-value&nonce=nonce-value&csrf=csrf-value',
      deeplyNestedUrl,
    ].join(' '));

    for (const secret of [
      'plain-token',
      'plain-secret',
      'plain-credentials',
      'plain-code',
      'url-token',
      'client-credentials',
      'session-value',
      'state-value',
      'nonce-value',
      'csrf-value',
      'deepest-secret',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(redactReportValue({ state: 's', nonce: 'n', csrf: 'c' })).toEqual({
      state: '[REDACTED]',
      nonce: '[REDACTED]',
      csrf: '[REDACTED]',
    });
  });

  it('sorts keys by code unit without locale-dependent comparison', () => {
    const artifact = createPublicReport(publicReport(), FIXED_OPTIONS);
    artifact.sections[0].evidence[0].metadata = { 'ä': 1, z: 2, A: 3, a: 4 };

    const serialized = serializePublicReportJson(artifact);
    const reparsed = JSON.parse(serialized);
    expect(Object.keys(reparsed.sections[0].evidence[0].metadata)).toEqual(['A', 'a', 'z', 'ä']);
  });

  it('redacts again at serialization as a defense for directly constructed artifacts', () => {
    const artifact = createPublicReport(publicReport(), FIXED_OPTIONS);
    artifact.sections[0].evidence.push({
      message: 'Observed Bearer serializer-secret',
      metadata: {
        accessToken: 'metadata-secret',
        callback: 'https://client.example/callback?authorization_code=url-secret',
      },
    });

    const output = `${serializePublicReportJson(artifact)}${serializePublicReportMarkdown(artifact)}`;
    expect(output).not.toContain('serializer-secret');
    expect(output).not.toContain('metadata-secret');
    expect(output).not.toContain('url-secret');
  });

  it('never turns authorization, partial, or failed outcomes into a zero grade', () => {
    for (const makeReport of [authorizationRequiredReport, partialReport, failedReport]) {
      const artifact = createPublicReport(makeReport(), FIXED_OPTIONS);
      expect(artifact.score).toBeNull();
      expect(serializePublicReportMarkdown(artifact)).toContain('Not scored.');
    }

    const authorizationArtifact = createPublicReport(authorizationRequiredReport(), FIXED_OPTIONS);
    expect(authorizationArtifact.outcome.authorizationPrerequisite).toMatchObject({ required: true });
    expect(serializePublicReportMarkdown(authorizationArtifact)).toContain(
      'Authorization is a prerequisite, not a failed 0% grade.'
    );
    expect(createPublicReport(failedReport(), FIXED_OPTIONS).provenance).toEqual({
      route: 'authenticated-proxy',
      proxyUsed: true,
      attempts: [
        { route: 'direct', result: 'failed' },
        { route: 'authenticated-proxy', result: 'failed' },
      ],
    });
  });
});
