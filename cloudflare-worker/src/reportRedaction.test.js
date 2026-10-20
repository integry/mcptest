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
import { CREDENTIAL_FUZZ_CASES, findEmbeddedSecret } from './redactionFuzzCases.js';
import { REDACTED_VALUE, redactReportString, redactReportValue } from './reportRedaction.js';

const containsSecret = (output, secrets) => secrets.find((secret) => output.includes(secret));

describe('the Worker port of the app redaction', () => {
  it.each(REPORT_REDACTION_STRING_FIXTURES.map((fixture) => [fixture.name, fixture]))(
    'redacts %s exactly as the app does',
    (_name, { value, secrets }) => {
      const expected = appRedactReportString(value);
      expect(containsSecret(expected, secrets), `app output: ${expected}`).toBeUndefined();
      const redacted = redactReportString(value);
      if (findUnredactedSecret({ note: expected }) === undefined) {
        expect(redacted).toBe(expected);
        // Redaction is idempotent, so the app's own output is stored unchanged.
        expect(redactReportString(expected)).toBe(expected);
      } else {
        // The port is stricter than the app only where the guard refuses the
        // app's output (a URL query name it cannot inspect): the stored form
        // must then pass the guard and be its own fixed point.
        expect(containsSecret(redacted, secrets)).toBeUndefined();
        expect(findUnredactedSecret({ note: redacted })).toBeUndefined();
        expect(redactReportString(redacted)).toBe(redacted);
      }
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

  it('redacts a credential carried by a URL query name to the marker', () => {
    // F8: the encoded name holds the credential while the value is already the marker.
    const f8 = 'https://example.test/?access_token%3Dopaquecredential123=%5BREDACTED%5D';
    const redacted = redactReportString(f8);
    expect(redacted).toBe('https://example.test/?%5BREDACTED%5D=%5BREDACTED%5D');
    expect(redacted).not.toContain('opaquecredential123');
    expect(findUnredactedSecret({ note: redacted })).toBeUndefined();
    expect(redactReportString(redacted)).toBe(redacted);

    for (const [name, secret] of [
      ['https://example.test/?Bearer%20name-bearer-secret=1', 'name-bearer-secret'],
      ['https://example.test/?%22token%22%3A%22name-json-secret%22=1', 'name-json-secret'],
      ['https://example.test/?access_token%253Dname-double-secret=x', 'name-double-secret'],
      ['see {"url":"https://example.test/?client_secret%3Dname-fragment-secret=%5BREDACTED%5D"}', 'name-fragment-secret'],
    ]) {
      const output = redactReportString(name);
      expect(output, name).not.toContain(secret);
      expect(findUnredactedSecret({ note: output }), name).toBeUndefined();
    }

    // Names that carry no credential are preserved exactly as the app preserves them.
    for (const kept of [
      'https://example.test/?access_token=%5BREDACTED%5D&page=2',
      'https://example.test/?access%5Ftoken=%5BREDACTED%5D&q=plain',
      'https://example.test/?redirect_uri=https%3A%2F%2Fapp.example%2Fcb&scope=read',
    ]) {
      expect(redactReportString(kept), kept).toBe(appRedactReportString(kept));
      expect(redactReportString(kept), kept).not.toContain(REDACTED_VALUE.repeat(2));
    }
    expect(redactReportString('https://example.test/?access_token=%5BREDACTED%5D&page=2'))
      .toBe('https://example.test/?access_token=%5BREDACTED%5D&page=2');

    // A name encoded past the decode bound cannot be inspected and becomes the marker too.
    const overBound = `https://example.test/?${Array.from({ length: 6 }).reduce((text) => encodeURIComponent(text), 'access_token=over-bound-name-secret')}=1`;
    expect(redactReportString(overBound)).toBe('https://example.test/?%5BREDACTED%5D=%5BREDACTED%5D');
  });

  it.each(CREDENTIAL_FUZZ_CASES)('stores nothing the guard recognizes for %s', (_name, text, secrets) => {
    // The storage invariant: an artifact the guard accepts after the transform
    // carries none of the fixture secrets, in any encoding the embeddings use.
    for (const artifact of [{ note: text }, { [text]: 'value' }]) {
      const redacted = redactReportValue(artifact);
      const stored = JSON.stringify(redacted);
      if (findUnredactedSecret(redacted) === undefined) {
        expect(findEmbeddedSecret(stored, secrets), stored).toBeUndefined();
      }
      // The guard must refuse the raw input or the transform must have neutralized it.
      expect(findUnredactedSecret(artifact) !== undefined || findEmbeddedSecret(stored, secrets) === undefined).toBe(true);
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
