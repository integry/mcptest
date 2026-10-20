import { describe, expect, it } from 'vitest';
import {
  redactReportString as appRedactReportString,
  redactReportValue as appRedactReportValue,
} from '../../src/utils/reportArtifact.ts';
import {
  REPORT_REDACTION_STRING_FIXTURES,
  REPORT_REDACTION_VALUE_FIXTURES,
} from '../../src/utils/reportRedactionFixtures.ts';
import { findUnredactedSecret } from './redactionGuard.js';
import { REDACTED_VALUE, redactReportString, redactReportValue } from './reportRedaction.js';

const containsSecret = (output, secrets) => secrets.find((secret) => output.includes(secret));

describe('the Worker port of the app redaction', () => {
  it.each(REPORT_REDACTION_STRING_FIXTURES.map((fixture) => [fixture.name, fixture]))(
    'redacts %s exactly as the app does',
    (_name, { value, secrets }) => {
      const expected = appRedactReportString(value);
      expect(containsSecret(expected, secrets), `app output: ${expected}`).toBeUndefined();
      expect(redactReportString(value)).toBe(expected);
      // Redaction is idempotent, so the app's own output is stored unchanged.
      expect(redactReportString(expected)).toBe(expected);
    }
  );

  it.each(REPORT_REDACTION_VALUE_FIXTURES.map((fixture) => [fixture.name, fixture]))(
    'redacts the value fixture %s exactly as the app does',
    (_name, { value, secrets }) => {
      const expected = appRedactReportValue(value);
      expect(containsSecret(JSON.stringify(expected), secrets)).toBeUndefined();
      expect(redactReportValue(value)).toEqual(expected);
      expect(redactReportValue(expected)).toEqual(expected);
    }
  );

  it('rejects every fixture in the guard, then accepts the redacted result', () => {
    for (const { name, value, secrets } of REPORT_REDACTION_STRING_FIXTURES) {
      const artifact = { note: value };
      expect(findUnredactedSecret(artifact), name).toBeDefined();
      const redacted = redactReportValue(artifact);
      expect(containsSecret(JSON.stringify(redacted), secrets), name).toBeUndefined();
      expect(findUnredactedSecret(redacted), name).toBeUndefined();
    }
    for (const { name, value, secrets } of REPORT_REDACTION_VALUE_FIXTURES) {
      expect(findUnredactedSecret(value), name).toBeDefined();
      const redacted = redactReportValue(value);
      expect(containsSecret(JSON.stringify(redacted), secrets), name).toBeUndefined();
      expect(findUnredactedSecret(redacted), name).toBeUndefined();
    }
  });

  it('keeps the schema exemptions the app keeps', () => {
    const artifact = {
      outcome: { authorizationPrerequisite: { state: 'required', reason: 'r' } },
      authorizationSetup: { alternativeHeaderTemplate: 'Token token=<PAGERDUTY_API_TOKEN>', credential: 'kept' },
      capabilityInventory: { authentication: { scheme: 'bearer', token: 'leaked' } },
      error: { code: -32601 },
      sections: [{ evidence: [{ metadata: { referenceUrl: 'https://mcptest.io/learn/mcp-transport-diagnostics-reference#transport-accept-header-406' } }] }],
      nested: { token: 'secret' },
      referenceUrl: 'https://x.example/#frag',
    };
    const redacted = redactReportValue(artifact);
    expect(redacted).toEqual(appRedactReportValue(artifact));
    expect(redacted).toMatchObject({
      outcome: artifact.outcome,
      authorizationSetup: artifact.authorizationSetup,
      capabilityInventory: { authentication: { scheme: 'bearer', token: REDACTED_VALUE } },
      error: artifact.error,
      sections: artifact.sections,
      nested: { token: REDACTED_VALUE },
      referenceUrl: `https://x.example/#${REDACTED_VALUE}`,
    });
  });

  it('sanitizes stored tool input schemas with the closed vocabulary and marks the definitions partial', () => {
    const toolSurfaceAnalysis = {
      fingerprint: { algorithm: 'fnv1a64', value: 'stale', canonicalBytes: 0 },
      toolDefinitions: {
        status: 'complete',
        tools: [{
          name: 'search',
          inputSchema: {
            type: 'object',
            description: 'leaked default sk-abcdefghijklmnopqrstuvwxyz',
            properties: { query: { type: 'string', default: 'leaked' }, password: { type: 'string' } },
            required: ['query'],
            custom: 'dropped',
          },
        }],
      },
    };
    const expected = appRedactReportValue({ toolSurfaceAnalysis }).toolSurfaceAnalysis;
    const redacted = redactReportValue({ toolSurfaceAnalysis }).toolSurfaceAnalysis;
    expect(redacted).toEqual(expected);
    expect(redacted.toolDefinitions).toMatchObject({ status: 'partial', namesComplete: true });
    expect(redacted.toolDefinitions.tools[0].inputSchema).toEqual({
      type: 'object',
      description: REDACTED_VALUE,
      properties: { query: { type: 'string', default: REDACTED_VALUE }, password: REDACTED_VALUE },
      required: ['query'],
    });
    expect(redacted.fingerprint.value).toMatch(/^[0-9a-f]{16}$/);
    expect(redacted.fingerprint.value).not.toBe('stale');
  });
});
