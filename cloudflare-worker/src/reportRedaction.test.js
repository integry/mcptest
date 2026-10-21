import { vi, describe, expect, it } from 'vitest';
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
import {

  INSPECTION_BUDGET_MAX_SCANNED_CHARACTERS,
  InspectionBudgetExceededError,
  REDACTED_VALUE,
  createInspectionBudget,
  findUrlsInText,
  redactReportString,
  redactReportValue,
  withInspectionBudget,
} from './reportRedaction.js';

// The budget-bound scans do real work on large fixtures; a cold CI runner exceeds vitest's 5 s default.
vi.setConfig({ testTimeout: 60_000 });

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

  it('bounds the embedded fragment scan to balanced spans within the guard budget', () => {
    // F11: the scan used to try every closing bracket after every opening one,
    // so a long run of ordinary bracketed text cost quadratic work in the Worker.
    const repeated = `${'[INFO] '.repeat(50000)}done`;
    expect(findUnredactedSecret({ note: repeated })).toBeUndefined();
    const started = Date.now();
    expect(redactReportString(repeated)).toBe(repeated);
    expect(Date.now() - started).toBeLessThan(5000);

    // Credential-bearing fragments among the harmless brackets are still redacted.
    const mixed = `${'[INFO] '.repeat(20000)}{"token":"plain-fragment-secret"} ${'[WARN] '.repeat(20000)}done`;
    const redactedMixed = redactReportString(mixed);
    expect(redactedMixed).toBe(mixed.replace('plain-fragment-secret', REDACTED_VALUE));
    expect(findUnredactedSecret({ note: redactedMixed })).toBeUndefined();

    // Fragments inside one that parsed are covered by its traversal, as in the guard.
    const nested = `${'['.repeat(64)}0${']'.repeat(64)}`;
    expect(findUnredactedSecret({ note: nested })).toBeUndefined();
    expect(redactReportString(nested)).toBe(nested);
    const nestedSecret = `log: [[{"headers":{"x-api-key":"plain"}}]] end`;
    expect(redactReportString(nestedSecret)).toBe(appRedactReportString(nestedSecret));
    expect(redactReportString(nestedSecret)).not.toContain('"plain"');

    // Past the guard's parse budget the string cannot be inspected: the guard
    // refuses it and the transform redacts it whole rather than storing it unseen.
    const uninspectable = `prefix ${'{"a":'.repeat(40)}x${'}'.repeat(40)}`;
    expect(findUnredactedSecret({ note: uninspectable }))
      .toEqual({ path: 'note', reason: 'contains too many JSON-shaped fragments to inspect' });
    expect(redactReportString(uninspectable)).toBe(REDACTED_VALUE);
    expect(redactReportValue({ note: uninspectable })).toEqual({ note: REDACTED_VALUE });
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

  it('redacts userinfo passwords in URLs of any scheme and in the bare user:password@host shape', () => {
    // F9: discovery is not limited to http(s); the password is a credential whatever the scheme.
    const f9 = 'ftp://alice:opaquecredential123@files.example/report';
    expect(findUnredactedSecret({ note: f9 })?.reason).toBe('URL carries credentials');
    expect(appRedactReportString(f9)).toBe(f9);
    const redacted = redactReportString(f9);
    expect(redacted).toBe('ftp://%5BREDACTED%5D:%5BREDACTED%5D@files.example/report');
    expect(findUnredactedSecret({ note: redacted })).toBeUndefined();
    expect(redactReportString(redacted)).toBe(redacted);

    for (const [text, secret, expected] of [
      ['wss://alice:ws-userinfo-secret@relay.example/mcp', 'ws-userinfo-secret',
        'wss://%5BREDACTED%5D:%5BREDACTED%5D@relay.example/mcp'],
      ['x-mcp+v1://alice:custom-userinfo-secret@broker.example/session?a=1#frag', 'custom-userinfo-secret',
        'x-mcp+v1://%5BREDACTED%5D:%5BREDACTED%5D@broker.example/session?a=1#[REDACTED]'],
      ['see "sftp://alice:quoted-userinfo-secret@files.example".', 'quoted-userinfo-secret',
        'see "sftp://%5BREDACTED%5D:%5BREDACTED%5D@files.example".'],
      ['file://alice:file-userinfo-secret@files.example/report', 'file-userinfo-secret',
        'file://alice:[REDACTED]@files.example/report'],
      ['sftp alice:bare-userinfo-secret@files.example:22', 'bare-userinfo-secret',
        'sftp alice:[REDACTED]@files.example:22'],
      ['user alice:bare-ipv6-secret@[::1]/share', 'bare-ipv6-secret', 'user alice:[REDACTED]@[::1]/share'],
      // The shape is syntactic, so a scheme-prefixed address is redacted as a password too.
      ['write to mailto:ops@example.com', 'ops@example.com', 'write to mailto:[REDACTED]@example.com'],
      ['wss://relay.example/mcp?access_token=ws-query-secret', 'ws-query-secret',
        'wss://relay.example/mcp?access_token=%5BREDACTED%5D'],
      ['{"note":"ftp://alice:json-userinfo-secret@files.example/ failed"}', 'json-userinfo-secret',
        '{"note":"ftp://%5BREDACTED%5D:%5BREDACTED%5D@files.example/ failed"}'],
    ]) {
      expect(findUnredactedSecret({ note: text }), text).toBeDefined();
      const output = redactReportString(text);
      expect(output, text).toBe(expected);
      expect(output, text).not.toContain(secret);
      expect(findUnredactedSecret({ note: output }), text).toBeUndefined();
      expect(redactReportString(output), text).toBe(output);
    }

    // Shapes that are not userinfo are preserved and accepted.
    for (const kept of [
      '{"email":"alice@example.com"}',
      'Contact: ops@example.com',
      'wss://relay.example/mcp',
      'ftp://%5BREDACTED%5D:%5BREDACTED%5D@files.example/report',
      'alice:[REDACTED]@files.example',
      'see https://docs.example/path and ops@example.com',
    ]) {
      expect(redactReportString(kept), kept).toBe(kept);
      expect(findUnredactedSecret({ note: kept }), kept).toBeUndefined();
    }
  });

  it('redacts a user:password@host run whatever precedes it, including a scheme without //', () => {
    // F10: `https:alice:secret@host` is a valid URL whose userinfo the URL parser
    // sees, but URL discovery needs `://`; the userinfo rule is context-free instead.
    const f10 = 'https:alice:opaquecredential123@files.example/report';
    expect(new URL(f10).password).toBe('opaquecredential123');
    expect(findUnredactedSecret({ note: f10 })?.reason).toBe('userinfo carries a password');
    expect(appRedactReportString(f10)).toBe(f10);
    const redacted = redactReportString(f10);
    expect(redacted).toBe('https:[REDACTED]@files.example/report');
    expect(findUnredactedSecret({ note: redacted })).toBeUndefined();
    expect(redactReportString(redacted)).toBe(redacted);

    for (const [text, secret, expected] of [
      ['mailto:alice:mail-userinfo-secret@mail.example', 'mail-userinfo-secret', 'mailto:[REDACTED]@mail.example'],
      ['alice:p%40ss%2Fw0rd%3A1@files.example', 'p%40ss%2Fw0rd%3A1', 'alice:[REDACTED]@files.example'],
      // Everything between the first colon and the `@` is the password, as in URL userinfo.
      ['alice:colon:userinfo-secret@files.example', 'colon:userinfo-secret', 'alice:[REDACTED]@files.example'],
      ['"alice:quote\'d-userinfo-secret@files.example"', 'quote\'d-userinfo-secret', '"alice:[REDACTED]@files.example"'],
      ['(alice:paren-userinfo-secret@files.example)', 'paren-userinfo-secret', '(alice:[REDACTED]@files.example)'],
      ['{"url":"alice:json-value-userinfo-secret@files.example"}', 'json-value-userinfo-secret',
        '{"url":"alice:[REDACTED]@files.example"}'],
      ['seen {"url":"alice:fragment-userinfo-secret@files.example"} end', 'fragment-userinfo-secret',
        'seen {"url":"alice:[REDACTED]@files.example"} end'],
    ]) {
      expect(findUnredactedSecret({ note: text }), text).toBeDefined();
      const output = redactReportString(text);
      expect(output, text).toBe(expected);
      expect(output, text).not.toContain(secret);
      expect(findUnredactedSecret({ note: output }), text).toBeUndefined();
      expect(redactReportString(output), text).toBe(output);
    }

    // The JSON pair separator is the one colon that never splits a run.
    for (const kept of [
      '{"email":"alice@example.com"}',
      '{"a":"x","b":"alice@example.com"}',
      'response: {"contact":"ops@example.com"} end',
    ]) {
      expect(redactReportString(kept), kept).toBe(kept);
      expect(findUnredactedSecret({ note: kept }), kept).toBeUndefined();
    }
  });

  it('redacts userinfo passwords before internationalized, punycode and Unicode hosts', () => {
    // F13: the host after the `@` is not restricted to ASCII, so an
    // internationalized label is no escape, with or without `://`.
    const f13 = 'https:alice:opaquecredential123@éxample.com/report';
    expect(findUnredactedSecret({ note: f13 })?.reason).toBe('userinfo carries a password');
    const redacted = redactReportString(f13);
    expect(redacted).toBe('https:[REDACTED]@éxample.com/report');
    expect(redacted).not.toContain('opaquecredential123');
    expect(findUnredactedSecret({ note: redacted })).toBeUndefined();
    expect(redactReportString(redacted)).toBe(redacted);

    for (const [text, secret, expected] of [
      ['https://alice:idn-url-secret@éxample.com/report', 'idn-url-secret',
        'https://%5BREDACTED%5D:%5BREDACTED%5D@xn--xample-9ua.com/report'],
      ['sftp alice:punycode-secret@xn--xample-9ua.com:22', 'punycode-secret', 'sftp alice:[REDACTED]@xn--xample-9ua.com:22'],
      ['mailto:alice:cyrillic-host-secret@пример.рф', 'cyrillic-host-secret', 'mailto:[REDACTED]@пример.рф'],
      ['user alice:cjk-host-secret@例え.jp/share', 'cjk-host-secret', 'user alice:[REDACTED]@例え.jp/share'],
      ['alice:emoji-host-secret@🔒.example', 'emoji-host-secret', 'alice:[REDACTED]@🔒.example'],
      // The password is likewise any run of non-boundary characters.
      ['alice:pässwörd-ünïcode@éxample.com', 'pässwörd-ünïcode', 'alice:[REDACTED]@éxample.com'],
      ['ftp alice:пароль@files.example', 'пароль', 'ftp alice:[REDACTED]@files.example'],
      ['{"url":"alice:json-idn-secret@éxample.com"}', 'json-idn-secret', '{"url":"alice:[REDACTED]@éxample.com"}'],
      ['seen {"url":"https:alice:fragment-idn-secret@éxample.com"} end', 'fragment-idn-secret',
        'seen {"url":"https:[REDACTED]@éxample.com"} end'],
    ]) {
      // The `://` forms are found by the URL scanner first; every other form by the userinfo scanner.
      expect(findUnredactedSecret({ note: text }), text).toBeDefined();
      const output = redactReportString(text);
      expect(output, text).toBe(expected);
      expect(output, text).not.toContain(secret);
      expect(findUnredactedSecret({ note: output }), text).toBeUndefined();
      expect(redactReportString(output), text).toBe(output);
    }

    // Internationalized addresses and hosts without a password are preserved.
    for (const kept of [
      'Contact: ops@éxample.com',
      '{"email":"alice@пример.рф"}',
      'https://xn--xample-9ua.com/mcp',
      'alice:[REDACTED]@éxample.com',
      'https:%5BREDACTED%5D@xn--xample-9ua.com/report',
    ]) {
      expect(redactReportString(kept), kept).toBe(kept);
      expect(findUnredactedSecret({ note: kept }), kept).toBeUndefined();
    }
    // The URL scanner serializes an IDN host as punycode, which is not a redaction.
    expect(redactReportString('https://éxample.com/mcp')).toBe('https://xn--xample-9ua.com/mcp');
    expect(findUnredactedSecret({ note: 'https://éxample.com/mcp' })).toBeUndefined();
  });

  it('redacts a quoted userinfo run outside established JSON while keeping JSON email fields', () => {
    // F17: `":"` is a pair separator only inside a span that parses as JSON;
    // elsewhere it is two ordinary characters, so this run has the user
    // `alice"` and the password `"opaquecredential123`.
    const f17 = 'sftp alice":"opaquecredential123@files.example';
    expect(findUnredactedSecret({ note: f17 })?.reason).toBe('userinfo carries a password');
    const redacted = redactReportString(f17);
    expect(redacted).toBe('sftp alice":[REDACTED]@files.example');
    expect(redacted).not.toContain('opaquecredential123');
    expect(findUnredactedSecret({ note: redacted })).toBeUndefined();
    expect(redactReportString(redacted)).toBe(redacted);

    for (const [text, secret, expected] of [
      // Unbalanced or unparseable JSON-looking text earns no exception either.
      ['"alice":"unterminated-pair-secret@files.example', 'unterminated-pair-secret',
        '"alice":[REDACTED]@files.example'],
      ['{"alice":"unclosed-object-secret@files.example', 'unclosed-object-secret',
        '{"alice":[REDACTED]@files.example'],
      ['{alice":"bare-key-secret@files.example}', 'bare-key-secret', '{alice":[REDACTED]@files.example}'],
      ['alice,"x":"comma-key-secret@files.example', 'comma-key-secret', 'alice,"x":[REDACTED]@files.example'],
      // The string values of established JSON are scanned decoded, at every depth.
      ['{"url":"alice:json-value-secret@files.example"}', 'json-value-secret', '{"url":"alice:[REDACTED]@files.example"}'],
      // A key is scanned too; the fragment transform then redacts the value under the rewritten key.
      ['{"alice:json-key-secret@files.example":1}', 'json-key-secret', '{"alice:[REDACTED]@files.example":"[REDACTED]"}'],
      ['{"note":"{\\"url\\":\\"alice:nested-json-secret@files.example\\"}"}', 'nested-json-secret',
        '{"note":"{\\"url\\":\\"alice:[REDACTED]@files.example\\"}"}'],
      ['{"note":"alice\\u003aescaped-colon-secret@files.example"}', 'escaped-colon-secret',
        '{"note":"alice:[REDACTED]@files.example"}'],
      // Established JSON is a boundary for the runs around it, not a shelter.
      ['seen {"a":1} alice:after-json-secret@files.example', 'after-json-secret',
        'seen {"a":1} alice:[REDACTED]@files.example'],
      ['alice:before-json-secret@{"a":1}', 'before-json-secret', 'alice:[REDACTED]@{"a":1}'],
    ]) {
      expect(findUnredactedSecret({ note: text }), text).toBeDefined();
      const output = redactReportString(text);
      expect(output, text).toBe(expected);
      expect(output, text).not.toContain(secret);
      expect(findUnredactedSecret({ note: output }), text).toBeUndefined();
      expect(redactReportString(output), text).toBe(output);
    }

    // Ordinary JSON email fields, nested or embedded in prose, are preserved and accepted.
    for (const kept of [
      '{"email":"alice@example.com"}',
      '{"a":"x","b":"alice@example.com"}',
      '{"cc":["alice@example.com"],"contact":{"email":"ops@example.com"}}',
      '{"note":"{\\"email\\":\\"alice@example.com\\"}"}',
      'response: {"contact":"ops@example.com"} end',
      '[{"email":"alice@example.com"}]',
      'sftp alice@files.example',
    ]) {
      expect(redactReportString(kept), kept).toBe(kept);
      expect(findUnredactedSecret({ note: kept }), kept).toBeUndefined();
    }
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

  it('scans 400 KB of hyphenated runs without separators in well under a second (F14)', () => {
    // Every letter after a hyphen is a word boundary and the key and scheme
    // classes accept hyphens, so the app's expressions restart a suffix scan at
    // each of them; the tokenizers walk the text once in both the detector and
    // the transform. No `:`, `=` or `://` ever follows, so nothing is found and
    // the transform is the identity.
    const runs = 'a-'.repeat(200000);
    expect(runs.length).toBe(400000);
    const mixedRuns = 'Xy-z9.w+v-'.repeat(40000);
    for (const text of [runs, mixedRuns]) {
      const detectorStarted = performance.now();
      expect(findUnredactedSecret({ note: text })).toBeUndefined();
      expect(performance.now() - detectorStarted).toBeLessThan(1000);
      const transformStarted = performance.now();
      expect(redactReportString(text)).toBe(text);
      expect(performance.now() - transformStarted).toBeLessThan(1000);
    }
    // The tokenizers still find what the expressions find around such runs.
    expect(findUnredactedSecret({ note: `${runs}; api-key=plain-secret` }))
      .toEqual({ path: 'note', reason: 'assignment "api-key" is not redacted' });
    expect(redactReportString(`${runs}; api-key=plain-secret`)).toBe(`${runs}; api-key=${REDACTED_VALUE}`);
    // A run that ends in a hyphen joins the key after it into one compound key, as the app's expression does.
    const compound = findUnredactedSecret({ note: `${runs} api-key=plain-secret` });
    expect(compound.path).toBe('note');
    expect(compound.reason.startsWith('assignment "a-a-')).toBe(true);
    expect(compound.reason.endsWith('a- api-key" is not redacted')).toBe(true);
    expect(findUnredactedSecret({ note: `${runs} x-scheme://alice:pw@host/` }))
      .toEqual({ path: 'note', reason: 'URL carries credentials' });
    const encodedMarker = encodeURIComponent(REDACTED_VALUE);
    expect(redactReportString(`${runs} x-scheme://alice:pw@host/`))
      .toBe(`${runs} x-scheme://${encodedMarker}:${encodedMarker}@host/`);
  });

  it('scans 300 KB of repeated invalid scheme prefixes in well under a second (F16)', () => {
    // `9a://` carries a separator but no scheme: `9` cannot start one and `a`
    // has no word boundary before it. The tokenizer must skip such a separator
    // without reading the whitespace-free body after it, or each of the 60,000
    // separators rescans nearly the whole string. No candidate exists, so the
    // transform is the identity and the budget is charged once per character walked.
    const invalidPrefixes = '9a://'.repeat(60000);
    expect(invalidPrefixes.length).toBe(300000);
    const emptyBodies = 'a:// '.repeat(60000);
    for (const text of [invalidPrefixes, emptyBodies]) {
      const detectorStarted = performance.now();
      expect(findUnredactedSecret({ note: text })).toBeUndefined();
      expect(performance.now() - detectorStarted).toBeLessThan(1000);
      const transformStarted = performance.now();
      expect(redactReportString(text)).toBe(text);
      expect(performance.now() - transformStarted).toBeLessThan(1000);
      // The tokenizer charges the text once plus every character it walks, so
      // its spend is linear: more than one pass, far from the quadratic cost.
      const tokenizer = createInspectionBudget();
      expect(withInspectionBudget(tokenizer, () => findUrlsInText(text))).toEqual([]);
      expect(tokenizer.candidates).toBe(0);
      expect(tokenizer.scannedCharacters).toBeGreaterThan(text.length);
      expect(tokenizer.scannedCharacters).toBeLessThanOrEqual(text.length * 3);
      const shared = createInspectionBudget();
      withInspectionBudget(shared, () => findUnredactedSecret({ note: text }));
      expect(shared.scannedCharacters).toBeLessThan(text.length * 64);
    }
    // A URL after the run is still found, and the body after an invalid prefix may itself start one.
    expect(findUnredactedSecret({ note: `${invalidPrefixes} x-scheme://alice:pw@host/` }))
      .toEqual({ path: 'note', reason: 'URL carries credentials' });
    const encodedMarker = encodeURIComponent(REDACTED_VALUE);
    expect(redactReportString(`${invalidPrefixes} x-scheme://alice:pw@host/`))
      .toBe(`${invalidPrefixes} x-scheme://${encodedMarker}:${encodedMarker}@host/`);
    expect(redactReportString('see 9a://b://alice:pw@host/ now'))
      .toBe(`see 9a://b://${encodedMarker}:${encodedMarker}@host/ now`);
  });

  it('charges the detector and the transform to one inspection budget and refuses the text past it', () => {
    const text = 'plain words '.repeat(1000);
    const shared = createInspectionBudget();
    withInspectionBudget(shared, () => {
      expect(findUnredactedSecret({ note: text })).toBeUndefined();
      const afterDetector = shared.scannedCharacters;
      expect(afterDetector).toBeGreaterThan(text.length);
      expect(redactReportValue({ note: text })).toEqual({ note: text });
      expect(shared.scannedCharacters).toBeGreaterThan(afterDetector);
    });
    expect(shared.maxScannedCharacters).toBe(INSPECTION_BUDGET_MAX_SCANNED_CHARACTERS);

    const tooSmall = () => createInspectionBudget({ maxScannedCharacters: text.length });
    expect(() => withInspectionBudget(tooSmall(), () => findUnredactedSecret({ note: text }))).toThrow(InspectionBudgetExceededError);
    expect(() => withInspectionBudget(tooSmall(), () => redactReportString(text))).toThrow(InspectionBudgetExceededError);
    const fewCandidates = () => createInspectionBudget({ maxCandidates: 10 });
    expect(() => withInspectionBudget(fewCandidates(), () => findUnredactedSecret({ note: 'a=1 '.repeat(20) }))).toThrow(InspectionBudgetExceededError);
    expect(() => withInspectionBudget(fewCandidates(), () => redactReportString('a=1 '.repeat(20)))).toThrow(InspectionBudgetExceededError);
    // The budget is restored after a throw, so the next standalone call starts fresh.
    expect(findUnredactedSecret({ note: 'a=1 '.repeat(20) })).toBeUndefined();

    // A standalone call runs under a default budget: a shape whose assignment
    // walks the app repeats per sensitive key is refused rather than scanned on.
    const quadratic = '/secret=%5BREDACTED%5D '.repeat(21000);
    expect(findUnredactedSecret({ note: quadratic })).toBeUndefined();
    const started = performance.now();
    expect(() => redactReportString(quadratic)).toThrow(InspectionBudgetExceededError);
    expect(performance.now() - started).toBeLessThan(10000);
  });
});
