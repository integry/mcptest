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

  it('labels the performance baseline as connection setup and reserves negotiation for explicit metadata', () => {
    const report = publicReport();
    const artifact = createPublicReport(report, FIXED_OPTIONS);

    expect(artifact.timings).toEqual({
      connectionSetupMs: 240,
      checks: [{ name: 'tools/list', durationMs: 18 }],
    });
    expect(serializePublicReportMarkdown(artifact)).toContain(
      '- Connection setup (endpoint selection through MCP negotiation): 240 ms'
    );
    expect(serializePublicReportMarkdown(artifact)).not.toContain('- Negotiation: 240 ms');

    report.sections.protocol.details[0].metadata = {
      ...report.sections.protocol.details[0].metadata as Record<string, unknown>,
      negotiationMs: 125,
    };
    expect(createPublicReport(report, FIXED_OPTIONS).timings).toMatchObject({
      negotiationMs: 125,
      connectionSetupMs: 240,
    });
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

  it('rejects scored artifacts whose overall totals contradict their sections', () => {
    const earnedMismatch = structuredClone(createPublicReport(publicReport(), FIXED_OPTIONS));
    earnedMismatch.score!.earned = 54;
    earnedMismatch.score!.percentage = 54 / 55 * 100;

    const maximumMismatch = structuredClone(createPublicReport(publicReport(), FIXED_OPTIONS));
    maximumMismatch.score!.maximum = 56;
    maximumMismatch.score!.percentage = 55 / 56 * 100;

    expect(safeParsePublicReport(earnedMismatch).success).toBe(false);
    expect(() => parsePublicReportJson(JSON.stringify(earnedMismatch))).toThrow(
      'The overall earned score must equal the sum of the section earned scores.'
    );
    expect(safeParsePublicReport(maximumMismatch).success).toBe(false);
    expect(() => validatePublicReport(maximumMismatch)).toThrow(
      'The overall maximum score must equal the sum of the section maximum scores.'
    );

    const inconsistentEvaluation = publicReport();
    inconsistentEvaluation.finalScore = 54;
    expect(() => createPublicReport(inconsistentEvaluation, FIXED_OPTIONS)).toThrow(
      'The overall earned score must equal the sum of the section earned scores.'
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

  it('redacts JWT keys and standalone JWT values from every report path', () => {
    const standaloneJwt = [
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkphbmUgRG9lIn0',
      'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    ].join('.');
    const jwtUrl = 'https://example.test/?jwt=url-jwt-secret&visible=yes';

    expect(redactReportString(`Rejected JWT ${standaloneJwt}`)).toBe(
      'Rejected JWT [REDACTED]'
    );
    expect(redactReportString(jwtUrl)).toBe(
      'https://example.test/?jwt=%5BREDACTED%5D&visible=yes'
    );
    expect(redactReportValue({ jwt: 'structured-jwt-secret' })).toEqual({
      jwt: '[REDACTED]',
    });

    const report = publicReport();
    report.sections.protocol.details[0] = {
      text: `Rejected JWT ${standaloneJwt}`,
      context: jwtUrl,
      metadata: { jwt: 'evidence-jwt-secret' },
    };
    const artifact = createPublicReport(report, FIXED_OPTIONS);
    const json = serializePublicReportJson(artifact);
    const markdown = serializePublicReportMarkdown(artifact);

    for (const output of [json, markdown]) {
      expect(output).not.toContain(standaloneJwt);
      expect(output).not.toContain('url-jwt-secret');
      expect(output).not.toContain('evidence-jwt-secret');
      expect(output).toContain('[REDACTED]');
    }
  });

  it('redacts secrets in metadata keys through artifact creation and both serializers', () => {
    const standaloneJwt = [
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'eyJzdWIiOiJtZXRhZGF0YS1rZXkifQ',
      'c2VjcmV0LXNpZ25hdHVyZQ',
    ].join('.');
    const sensitiveKeys = [
      'https://example.test/?access_token=url-key-secret&visible=yes',
      'client_secret=assignment-key-secret',
      standaloneJwt,
    ];
    const report = publicReport();
    report.sections.protocol.details[0].metadata = Object.fromEntries(
      sensitiveKeys.map((key) => [key, true])
    );

    const artifact = createPublicReport(report, FIXED_OPTIONS);
    const createdMetadata = artifact.sections[0].evidence[0].metadata as Record<string, unknown>;
    const directlyConstructed = createPublicReport(publicReport(), FIXED_OPTIONS);
    directlyConstructed.sections[0].evidence[0].metadata = {
      'https://example.test/?code=serializer-url-key-secret': true,
      'password=serializer-assignment-key-secret': true,
      [standaloneJwt]: true,
    };

    expect(Object.keys(createdMetadata)).toEqual([
      'client_secret=[REDACTED]',
      '[REDACTED]',
      'https://example.test/?access_token=%5BREDACTED%5D&visible=yes',
    ]);
    for (const output of [
      serializePublicReportJson(artifact),
      serializePublicReportMarkdown(artifact),
      serializePublicReportJson(directlyConstructed),
      serializePublicReportMarkdown(directlyConstructed),
    ]) {
      for (const secret of [
        'url-key-secret',
        'assignment-key-secret',
        'serializer-url-key-secret',
        'serializer-assignment-key-secret',
        standaloneJwt,
      ]) {
        expect(output).not.toContain(secret);
      }
      expect(output).toContain('[REDACTED]');
    }
  });

  it('retains colliding redacted metadata keys with deterministic suffixes', () => {
    const first = redactReportValue({
      'access_token=beta-secret': false,
      'access_token=alpha-secret': true,
    });
    const second = redactReportValue({
      'access_token=alpha-secret': true,
      'access_token=beta-secret': false,
    });

    expect(first).toEqual({
      'access_token=[REDACTED]': '[REDACTED]',
      'access_token=[REDACTED]#2': '[REDACTED]',
    });
    expect(second).toEqual(first);

    const artifact = createPublicReport(publicReport(), FIXED_OPTIONS);
    artifact.sections[0].evidence[0].metadata = {
      'access_token=beta-secret': false,
      'access_token=alpha-secret': true,
    };
    for (const output of [
      serializePublicReportJson(artifact),
      serializePublicReportMarkdown(artifact),
    ]) {
      expect(output).toContain('access_token=[REDACTED]');
      expect(output).toContain('access_token=[REDACTED]#2');
      expect(output).not.toMatch(/alpha-secret|beta-secret/);
    }
  });

  it('redacts encoded sensitive query names through both serializers and fails closed at the decode bound', () => {
    const singlyEncodedUrl = 'https://client.example/?access%5Ftoken=single-name-secret';
    const repeatedlyEncodedUrl = 'https://client.example/?access%255Ftoken=repeated-name-secret';
    let overBoundKey = 'access%5Ftoken';
    for (let layer = 0; layer < 6; layer += 1) overBoundKey = encodeURIComponent(overBoundKey);
    const overBoundUrl = `https://client.example/?${overBoundKey}=bounded-name-secret`;

    for (const [url, secret] of [
      [singlyEncodedUrl, 'single-name-secret'],
      [repeatedlyEncodedUrl, 'repeated-name-secret'],
      [overBoundUrl, 'bounded-name-secret'],
    ]) {
      expect(redactReportString(url)).not.toContain(secret);
    }

    const artifact = createPublicReport(publicReport(), FIXED_OPTIONS);
    artifact.sections[0].evidence[0] = {
      message: singlyEncodedUrl,
      context: repeatedlyEncodedUrl,
      metadata: { callback: repeatedlyEncodedUrl, bounded: overBoundUrl },
    };
    const json = serializePublicReportJson(artifact);
    const markdown = serializePublicReportMarkdown(artifact);

    for (const secret of ['single-name-secret', 'repeated-name-secret', 'bounded-name-secret']) {
      expect(json).not.toContain(secret);
      expect(markdown).not.toContain(secret);
    }
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

  it('redacts punctuation- and whitespace-separated sensitive assignment keys everywhere', () => {
    const assignments = [
      ['api.key=punctuation-api-secret', 'punctuation-api-secret'],
      ['API Key: whitespace-api-secret', 'whitespace-api-secret'],
      ['private key=private-key-secret', 'private-key-secret'],
      ['code verifier: verifier-secret', 'verifier-secret'],
    ] as const;
    const report = publicReport();
    report.sections.protocol.details[0] = {
      text: assignments.map(([assignment]) => assignment).join('\n'),
    };

    const artifact = createPublicReport(report, FIXED_OPTIONS);
    const directlyConstructed = createPublicReport(publicReport(), FIXED_OPTIONS);
    directlyConstructed.sections[0].evidence[0].message = report.sections.protocol.details[0].text;
    const outputs = [
      artifact.sections[0].evidence[0].message,
      serializePublicReportJson(directlyConstructed),
      serializePublicReportMarkdown(directlyConstructed),
    ];

    for (const output of outputs) {
      for (const [, secret] of assignments) expect(output).not.toContain(secret);
    }
    expect(outputs[0].match(/\[REDACTED\]/g)).toHaveLength(assignments.length);
  });

  it('redacts compound and form-encoded secret names through both serializers', () => {
    const secretsByKey = {
      secret_key: 'compound-secret-value',
      token_value: 'compound-token-value',
      'x-amz-signature': 'compound-signature-value',
      'access%5Ftoken': 'encoded-form-token-value',
    };
    const report = publicReport();
    report.sections.protocol.details[0] = {
      text: Object.entries(secretsByKey).map(([key, secret]) => `${key}=${secret}`).join(' '),
      metadata: secretsByKey,
    };

    const artifact = createPublicReport(report, FIXED_OPTIONS);
    const json = serializePublicReportJson(artifact);
    const markdown = serializePublicReportMarkdown(artifact);

    for (const secret of Object.values(secretsByKey)) {
      expect(json).not.toContain(secret);
      expect(markdown).not.toContain(secret);
    }
    expect(artifact.sections[0].evidence[0].metadata).toEqual({
      secret_key: '[REDACTED]',
      token_value: '[REDACTED]',
      'x-amz-signature': '[REDACTED]',
      'access%5Ftoken': '[REDACTED]',
    });
  });

  it('redacts compound credential-family keys through both serializers', () => {
    const secretsByKey = {
      cookieJar: 'session=compound-cookie-secret',
      credentialValue: 'compound-credential-secret',
      passwordValue: 'compound-password-secret',
      apiKeyValue: 'compound-api-key-secret',
      api_key_header: 'compound-api-key-header-secret',
      authorizationHeader: 'ApiKey compound-authorization-secret',
      authorizationCodeValue: 'compound-authorization-code-secret',
    };
    expect(redactReportValue({
      apiKeyValue: secretsByKey.apiKeyValue,
      api_key_value: 'structured-snake-api-key-secret',
      apiKeySupported: true,
      api_key_placement: 'header',
    })).toEqual({
      apiKeyValue: '[REDACTED]',
      api_key_value: '[REDACTED]',
      apiKeySupported: true,
      api_key_placement: 'header',
    });

    const redactedString = redactReportString(
      'apiKeyValue=plain-api-key-secret https://example.test/?api_key_value=url-api-key-secret&api_key_supported=true'
    );
    expect(redactedString).not.toContain('plain-api-key-secret');
    expect(redactedString).not.toContain('url-api-key-secret');
    expect(redactedString).toContain('api_key_supported=true');

    const artifact = createPublicReport(publicReport(), FIXED_OPTIONS);
    artifact.sections[0].evidence[0].context = (
      'https://example.test/?apiKeyValue=serializer-url-secret&apiKeySupported=true'
    );
    artifact.sections[0].evidence[0].metadata = {
      ...secretsByKey,
      apiKeySupported: true,
      api_key_placement: 'header',
    };

    const json = serializePublicReportJson(artifact);
    const markdown = serializePublicReportMarkdown(artifact);

    for (const secret of [...Object.values(secretsByKey), 'serializer-url-secret']) {
      expect(json).not.toContain(secret);
      expect(markdown).not.toContain(secret);
    }
    for (const key of Object.keys(secretsByKey)) {
      expect(json).toContain(`"${key}": "[REDACTED]"`);
    }
    for (const output of [json, markdown]) {
      expect(output).toContain('apiKeySupported');
      expect(output).toContain('api_key_placement');
      expect(output).toContain('header');
    }
  });

  it('preserves non-secret authorization prerequisite and PKCE capability fields', () => {
    const artifact = createPublicReport(authorizationRequiredReport(), FIXED_OPTIONS);
    artifact.sections[0].evidence[0].metadata = {
      code_challenge_methods_supported: ['S256'],
    };

    for (const output of [
      serializePublicReportJson(artifact),
      serializePublicReportMarkdown(artifact),
    ]) {
      expect(output).toContain('Authorize access to the MCP server, then run the evaluation again.');
      expect(output).toContain('S256');
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
    const equalsCookies = 'Cookie=a=equals-cookie-one-secret; b=equals-cookie-two-secret';

    expect(redactReportString(jsonShaped)).toBe('{"access_token":"[REDACTED]"}');
    expect(redactReportString(authorization)).toBe('Authorization: [REDACTED]');
    expect(redactReportString(cookies)).toBe('Cookie: [REDACTED]');
    expect(redactReportString(equalsCookies)).toBe('Cookie=[REDACTED]');
    expect(redactReportValue({
      jsonShaped,
      authorizationHeader: authorization,
      cookieHeader: cookies,
      equalsCookieHeader: equalsCookies,
    })).toEqual({
      jsonShaped: '{"access_token":"[REDACTED]"}',
      authorizationHeader: '[REDACTED]',
      cookieHeader: '[REDACTED]',
      equalsCookieHeader: '[REDACTED]',
    });

    const artifact = createPublicReport(publicReport(), FIXED_OPTIONS);
    artifact.sections[0].evidence[0] = {
      message: jsonShaped,
      context: authorization,
      metadata: {
        jsonShaped,
        authorizationHeader: authorization,
        cookieHeader: cookies,
        equalsCookieHeader: equalsCookies,
      },
    };
    const json = serializePublicReportJson(artifact);
    const markdown = serializePublicReportMarkdown(artifact);

    for (const secret of [
      'json-report-secret',
      'authorization-report-secret',
      'cookie-one-secret',
      'cookie-two-secret',
      'equals-cookie-one-secret',
      'equals-cookie-two-secret',
    ]) {
      expect(json).not.toContain(secret);
      expect(markdown).not.toContain(secret);
    }
  });

  it('redacts backslash-escaped JSON credentials during report creation and serialization', () => {
    const escapedJson = String.raw`body="{\"access_token\":\"escaped-json-secret\"}"`;
    const escapedObject = String.raw`{\"client_secret\":\"escaped-object-secret\"}`;
    const report = publicReport();
    report.sections.protocol.details[0] = {
      text: escapedJson,
      context: escapedObject,
      metadata: { escapedJson, escapedObject },
    };

    expect(redactReportString(escapedJson)).toBe(
      String.raw`body="{\"access_token\":\"[REDACTED]\"}"`
    );
    expect(redactReportString(escapedObject)).toBe(
      String.raw`{\"client_secret\":\"[REDACTED]\"}`
    );
    let overBoundJson = '{"access_token":"over-bound-json-secret"}';
    for (let layer = 0; layer < 6; layer += 1) overBoundJson = JSON.stringify(overBoundJson);
    expect(redactReportString(overBoundJson)).not.toContain('over-bound-json-secret');
    expect(redactReportString(overBoundJson)).toContain('[REDACTED]');

    const artifact = createPublicReport(report, FIXED_OPTIONS);
    expect(JSON.stringify(artifact)).not.toContain('escaped-json-secret');
    expect(JSON.stringify(artifact)).not.toContain('escaped-object-secret');

    const directlyConstructed = createPublicReport(publicReport(), FIXED_OPTIONS);
    directlyConstructed.sections[0].evidence[0].message = String.raw`body="{\"access_token\":\"serializer-escaped-secret\"}"`;
    for (const output of [
      serializePublicReportJson(directlyConstructed),
      serializePublicReportMarkdown(directlyConstructed),
    ]) {
      expect(output).not.toContain('serializer-escaped-secret');
      expect(output).toContain('REDACTED');
    }
  });

  it('redacts complete array and object values for sensitive keys in every export path', () => {
    const arrayValue = '{"access_token":["array-report-secret"]}';
    const objectValue = '{"credentials":{"password":"object-report-secret"}}';

    expect(redactReportString(arrayValue)).toBe('{"access_token":"[REDACTED]"}');
    expect(redactReportString(objectValue)).toBe('{"credentials":"[REDACTED]"}');

    const artifact = createPublicReport(publicReport(), FIXED_OPTIONS);
    artifact.sections[0].evidence[0] = {
      message: arrayValue,
      context: objectValue,
      metadata: { arrayValue, objectValue },
    };

    for (const output of [
      serializePublicReportJson(artifact),
      serializePublicReportMarkdown(artifact),
    ]) {
      expect(output).not.toContain('array-report-secret');
      expect(output).not.toContain('object-report-secret');
      expect(output).toContain('[REDACTED]');
    }
  });

  it('redacts credential objects and arrays embedded within surrounding evidence text', () => {
    const objectValue = 'error body: {"credentials":{"value":"embedded-object-secret"}} after response';
    const arrayValue = 'error body: {"credentials":[{"value":"embedded-array-secret"}]} after response';

    expect(redactReportString(objectValue)).toBe(
      'error body: {"credentials":"[REDACTED]"} after response'
    );
    expect(redactReportString(arrayValue)).toBe(
      'error body: {"credentials":"[REDACTED]"} after response'
    );

    const artifact = createPublicReport(publicReport(), FIXED_OPTIONS);
    artifact.sections[0].evidence[0] = {
      message: objectValue,
      context: arrayValue,
      metadata: { objectValue, arrayValue },
    };

    for (const output of [
      serializePublicReportJson(artifact),
      serializePublicReportMarkdown(artifact),
    ]) {
      expect(output).not.toContain('embedded-object-secret');
      expect(output).not.toContain('embedded-array-secret');
      expect(output).toContain('after response');
      expect(output).toContain('[REDACTED]');
    }
  });

  it('redacts decoded sensitive keys in embedded and JSON-escaped fragments', () => {
    const embeddedJson = String.raw`error body: {"access token":"space-key-secret","api.key":"punctuation-key-secret","access\u0020token":"escaped-key-secret"} after response`;
    const escapedJson = String.raw`error body: {\"oauth credential\":\"escaped-fragment-secret\"} after response`;
    const report = publicReport();
    report.sections.protocol.details[0] = {
      text: embeddedJson,
      context: escapedJson,
      metadata: { embeddedJson, escapedJson },
    };

    const artifact = createPublicReport(report, FIXED_OPTIONS);
    expect(JSON.stringify(artifact)).not.toMatch(
      /space-key-secret|punctuation-key-secret|escaped-key-secret|escaped-fragment-secret/
    );

    const directlyConstructed = createPublicReport(publicReport(), FIXED_OPTIONS);
    directlyConstructed.sections[0].evidence[0] = {
      message: embeddedJson,
      context: escapedJson,
      metadata: { embeddedJson, escapedJson },
    };

    for (const output of [
      serializePublicReportJson(directlyConstructed),
      serializePublicReportMarkdown(directlyConstructed),
    ]) {
      expect(output).not.toMatch(
        /space-key-secret|punctuation-key-secret|escaped-key-secret|escaped-fragment-secret/
      );
      expect(output).toContain('REDACTED');
      expect(output).toContain('after response');
    }
  });

  it('redacts unmatched quotes inside credential assignments and URL values', () => {
    const apostropheAssignment = "password=apostrophe'secret-suffix";
    const quoteAssignment = 'client_secret=quote"secret-suffix';
    const apostropheUrl = "https://client.example/callback?access_token=url-apostrophe'secret-suffix&visible=yes";
    const quoteUrl = 'https://client.example/callback?password=url-quote"secret-suffix&visible=yes';

    expect(redactReportString(apostropheAssignment)).toBe('password=[REDACTED]');
    expect(redactReportString(quoteAssignment)).toBe('client_secret=[REDACTED]');
    expect(redactReportString(apostropheUrl)).not.toContain("'secret-suffix");
    expect(redactReportString(quoteUrl)).not.toContain('"secret-suffix');

    const report = publicReport();
    report.sections.protocol.details[0] = {
      text: apostropheAssignment,
      context: quoteAssignment,
      metadata: { apostropheUrl, quoteUrl },
    };
    const artifact = createPublicReport(report, FIXED_OPTIONS);

    const directlyConstructed = createPublicReport(publicReport(), FIXED_OPTIONS);
    directlyConstructed.sections[0].evidence[0] = {
      message: apostropheAssignment,
      context: quoteAssignment,
      metadata: { apostropheUrl, quoteUrl },
    };

    for (const output of [
      JSON.stringify(artifact),
      serializePublicReportJson(directlyConstructed),
      serializePublicReportMarkdown(directlyConstructed),
    ]) {
      expect(output).not.toContain('secret-suffix');
      expect(output).toContain('REDACTED');
    }
  });

  it('redacts complete unquoted authorization assignments in every export path', () => {
    const assignments = [
      'authorization=Bearer bearer-assignment-secret',
      'authorization=Basic basic-assignment-secret',
      'proxy-authorization=Bearer proxy-bearer-assignment-secret',
      'x-mcp-authorization=Basic proxy-basic-assignment-secret',
    ];

    for (const assignment of assignments) {
      expect(redactReportString(assignment)).toMatch(/=\[REDACTED\]$/);
    }

    const artifact = createPublicReport(publicReport(), FIXED_OPTIONS);
    artifact.sections[0].evidence[0] = {
      message: assignments[0],
      context: assignments[1],
      metadata: {
        proxyBearerEvidence: assignments[2],
        proxyBasicEvidence: assignments[3],
      },
    };
    const json = serializePublicReportJson(artifact);
    const markdown = serializePublicReportMarkdown(artifact);

    for (const secret of [
      'bearer-assignment-secret',
      'basic-assignment-secret',
      'proxy-bearer-assignment-secret',
      'proxy-basic-assignment-secret',
    ]) {
      expect(json).not.toContain(secret);
      expect(markdown).not.toContain(secret);
    }
  });

  it('redacts generic numeric codes while preserving an explicit JSON-RPC code field', () => {
    const report = publicReport();
    report.sections.protocol.details[0].metadata = {
      ...report.sections.protocol.details[0].metadata as Record<string, unknown>,
      code: 123456,
      jsonRpcCode: -32601,
    };

    const artifact = createPublicReport(report, FIXED_OPTIONS);
    const roundTripped = parsePublicReportJson(serializePublicReportJson(artifact));
    const metadata = roundTripped.sections[0].evidence[0].metadata as Record<string, unknown>;
    const json = serializePublicReportJson(artifact);
    const markdown = serializePublicReportMarkdown(artifact);

    expect(metadata.code).toBe('[REDACTED]');
    expect(metadata.jsonRpcCode).toBe(-32601);
    for (const output of [json, markdown]) {
      expect(output).not.toContain('"code": 123456');
      expect(output).toContain('"jsonRpcCode": -32601');
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

  it('keeps multiline Markdown-shaped generator metadata on the generator line', () => {
    const artifact = createPublicReport(publicReport(), {
      ...FIXED_OPTIONS,
      toolVersion: '1.2.3\n## Forged heading <script>',
      toolCommit: 'deadbeef\n- forged **content**',
    });

    const markdown = serializePublicReportMarkdown(artifact);
    expect(markdown).toContain(
      '- Generator: mcptest 1.2.3 ## Forged heading \\<script\\> (deadbeef - forged \\*\\*content\\*\\*)'
    );
    expect(markdown).not.toMatch(/^## Forged heading/m);
    expect(markdown).not.toMatch(/^- forged/m);
    expect(markdown).not.toContain('<script>');
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

  it('exports mixed evaluated and skipped legacy evidence as a partial section', () => {
    const report = publicReport();
    report.outcome = undefined;
    report.finalScore = 53;
    report.sections.capabilities = section('Capabilities', 8, 10, {}, {
      details: [
        { text: '✓ Tool discovery completed.' },
        { text: '⚠ Resource checks were skipped after the connection closed.' },
      ],
    });

    const artifact = createPublicReport(report, FIXED_OPTIONS);
    const capabilities = artifact.sections.find(({ id }) => id === 'capabilities');

    expect(artifact.outcome.status).toBe('partial');
    expect(artifact.score).toBeNull();
    expect(capabilities?.status).toBe('partial');
    expect(capabilities?.score.earned).toBe(8);
    expect(serializePublicReportJson(artifact)).toContain('"status": "partial"');
    expect(serializePublicReportMarkdown(artifact)).toContain('Not scored.');
  });

  it('keeps a fully evaluated scored report when evidence mentions a failed alternate attempt', () => {
    const report = publicReport();
    report.sections.protocol.details[0] = {
      ...report.sections.protocol.details[0],
      text: '✓ MCP negotiation succeeded after an alternate negotiation failed.',
      context: 'The alternate route had no MCP connection, but the direct route succeeded.',
    };

    const artifact = createPublicReport(report, FIXED_OPTIONS);

    expect(artifact.outcome.status).toBe('scored');
    expect(artifact.score).toEqual({ earned: 55, maximum: 55, percentage: 100 });
    expect(artifact.sections.every((reportSection) => reportSection.status === 'evaluated')).toBe(true);
    expect(serializePublicReportJson(artifact)).toContain('"status": "scored"');
    expect(serializePublicReportMarkdown(artifact)).toContain('55 / 55 (100.00%)');
  });

  it('keeps explicit scored reports when warning evidence mentions a skipped optional probe', () => {
    const report = publicReport();
    report.sections.protocol.details[0] = {
      ...report.sections.protocol.details[0],
      text: '⚠ Unsupported optional probe was skipped; scored checks completed.',
    };

    const artifact = createPublicReport(report, FIXED_OPTIONS);

    expect(artifact.outcome.status).toBe('scored');
    expect(artifact.score).toEqual({ earned: 55, maximum: 55, percentage: 100 });
    expect(artifact.sections.every((reportSection) => reportSection.status === 'evaluated')).toBe(true);
    expect(serializePublicReportJson(artifact)).toContain('"status": "scored"');
    expect(serializePublicReportMarkdown(artifact)).toContain('55 / 55 (100.00%)');
  });
});
