import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import reportSchema from '../../public/schemas/report/v2.schema.json';
import { createPublicReport, serializePublicReportJson } from '../../src/utils/reportArtifact.ts';
import { analyzeToolSurface } from '../../src/utils/toolSurfaceAnalysis.ts';
import { createCompatibilityMatrix, createReleaseDecision } from '../../src/utils/releaseReadiness.ts';
import {
  PUBLISHED_REPORT_RETENTION,
  publishedReportId,
} from '../../src/utils/publishedReportIdentity.ts';
import worker from './index.js';
import { PublishedReports } from './PublishedReports.js';
import { PUBLISH_RATE_LIMITS, PUBLISHED_REPORT_CACHE_CONTROL } from './publishedReportRoutes.js';
import {
  REPORT_REDACTION_STRING_FIXTURES,
  REPORT_REDACTION_VALUE_FIXTURES,
} from '../../src/utils/reportRedactionFixtures.ts';
import { findUnredactedSecret } from './redactionGuard.js';
import { CREDENTIAL_FUZZ_CASES, findEmbeddedSecret } from './redactionFuzzCases.js';
import { KNOWN_BADGE_CACHE_CONTROL, UNKNOWN_BADGE_CACHE_CONTROL } from './badges.js';

// Every publish now runs the full redaction transform plus two detector passes, which a
// cold CI runner cannot finish inside vitest's 5 s default for the multi-publish cases.
vi.setConfig({ testTimeout: 120_000 });

// The publish route stores only what the guard accepts after the transform. No
// real input reaches that branch (the transform neutralizes everything the guard
// recognizes), so one test swaps the transform for one that leaves a credential.
const transform = vi.hoisted(() => ({ override: undefined }));
vi.mock('./reportRedaction.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    redactReportValue: (value, key) => (transform.override ? transform.override(value, key) : actual.redactReportValue(value, key)),
  };
});

// In-memory stand-in for a Durable Object namespace: one PublishedReports instance per name.
class MemoryStorage {
  constructor() { this.map = new Map(); }
  async get(key) {
    if (Array.isArray(key)) return new Map(key.filter((k) => this.map.has(k)).map((k) => [k, this.map.get(k)]));
    return this.map.get(key);
  }
  async put(key, value) {
    if (typeof key === 'object') Object.entries(key).forEach(([k, v]) => this.map.set(k, v));
    else this.map.set(key, value);
  }
  async delete(key) {
    (Array.isArray(key) ? key : [key]).forEach((k) => this.map.delete(k));
  }
}

const createNamespace = () => {
  const instances = new Map();
  return {
    instances,
    idFromName: (name) => ({ name }),
    get: (id) => {
      if (!instances.has(id.name)) {
        instances.set(id.name, new PublishedReports({ storage: new MemoryStorage() }));
      }
      return instances.get(id.name);
    },
  };
};

const ENDPOINT = 'https://Published.Example/mcp';
const evaluation = (overrides = {}) => ({
  serverUrl: ENDPOINT,
  outcome: 'scored',
  finalScore: 55,
  toolSurfaceAnalysis: analyzeToolSurface([{
    name: 'search',
    description: 'Search records.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  }]),
  sections: {
    protocol: {
      name: 'Protocol', description: 'Protocol', score: 15, maxScore: 15,
      details: [{ text: 'Negotiated', metadata: {
        protocolEra: 'modern', protocolVersion: '2026-07-28', endpoint: ENDPOINT, route: 'direct',
      } }],
    },
    capabilities: {
      name: 'Capabilities', description: 'Capabilities', score: 10, maxScore: 10,
      details: [{ text: 'Tools', metadata: { method: 'tools/list', itemCount: 1 } }],
    },
    transport: {
      name: 'Transport', description: 'Transport', score: 15, maxScore: 15,
      details: [{ text: 'Connected', metadata: { transportType: 'streamable-http' } }],
    },
    performance: {
      name: 'Performance', description: 'Performance', score: 15, maxScore: 15,
      details: [{ text: 'Fast', metadata: { durationMs: 200 } }],
    },
  },
  ...overrides,
});

const artifactFor = (report, generatedAt = '2026-10-20T09:00:00.000Z') => {
  const compatibilityMatrix = createCompatibilityMatrix(report);
  const releaseDecision = createReleaseDecision(report, compatibilityMatrix, report.toolSurfaceAnalysis);
  return JSON.parse(serializePublicReportJson(createPublicReport(report, {
    generatedAt, releaseDecision, compatibilityMatrix, toolSurfaceAnalysis: report.toolSurfaceAnalysis,
  })));
};

// Building an artifact through the evaluator is slow, so variants clone one base
// artifact: a distinct evidence message changes the content hash, a distinct
// tested endpoint moves the run to another host.
const baseArtifact = artifactFor(evaluation());
const clone = (value) => JSON.parse(JSON.stringify(value));
const scoredRun = (run) => {
  const artifact = clone(baseArtifact);
  artifact.sections[3].evidence[0].message = `Fast (run ${run})`;
  return artifact;
};
const forHost = (host) => {
  const artifact = clone(baseArtifact);
  artifact.target.testedEndpoint = `https://${host}/mcp`;
  return artifact;
};
const failedRun = () => artifactFor(evaluation({
  outcome: 'failed',
  finalScore: 0,
  sections: { protocol: { name: 'Protocol', description: 'Protocol', score: 0, maxScore: 15, status: 'failed', details: [{ text: 'Unreachable' }] } },
}));
const CANONICAL_REFERENCE = 'https://mcptest.io/learn/mcp-transport-diagnostics-reference#transport-accept-header-406';
const encodeTimes = (value, times) => Array.from({ length: times }).reduce((text) => JSON.stringify(text), value);
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

let env;
let ipCounter = 0;
const request = (path, init = {}, ip = '203.0.113.7') => worker.fetch(
  new Request(`https://mcptest.io${path}`, {
    ...init,
    headers: { 'CF-Connecting-IP': ip, Origin: 'https://mcptest.io', ...(init.headers || {}) },
  }),
  env,
  {}
);
const publish = (body, ip) => request('/r', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}, ip ?? `198.51.100.${(ipCounter += 1) % 250}`);

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateStored = ajv.compile(reportSchema);

afterEach(() => {
  vi.useRealTimers();
  transform.override = undefined;
});

beforeEach(() => {
  env = {
    FIREBASE_PROJECT_ID: 'test-project',
    USER_STATE: { idFromName: () => { throw new Error('published report routes must not reach UserState'); } },
    PUBLISHED_REPORTS: createNamespace(),
  };
});

describe('publishing a report', () => {
  it('stores the redacted artifact, returns a removal token once and serves the permalink', async () => {
    const artifact = artifactFor(evaluation());
    const response = await publish(artifact);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.endpoint).toBe('https://published.example/mcp');
    expect(body.id).toMatch(/^[a-f0-9]{20}-[a-f0-9]{20}$/);
    expect(body.url).toBe(`https://mcptest.io/r/${body.id}`);
    expect(body.removalToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(body.deduplicated).toBe(false);
    expect(body.entry.summary).toMatchObject({ status: 'scored', releaseStatus: expect.any(String), scorePercentage: 100 });
    expect(body.entry).not.toHaveProperty('removalTokenHash');

    const read = await request(`/r/${body.id}`);
    expect(read.status).toBe(200);
    expect(read.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(read.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(read.headers.get('Cache-Control')).toBe(PUBLISHED_REPORT_CACHE_CONTROL);
    expect(read.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const stored = await read.json();
    expect(stored).toEqual(artifact);
    expect(validateStored(stored), JSON.stringify(validateStored.errors)).toBe(true);
  });

  it('deduplicates identical runs by content hash without issuing a second removal token', async () => {
    const first = await (await publish(artifactFor(evaluation(), '2026-10-20T09:00:00.000Z'))).json();
    const again = await publish(artifactFor(evaluation(), '2026-10-20T10:00:00.000Z'));
    expect(again.status).toBe(200);
    const body = await again.json();
    expect(body.deduplicated).toBe(true);
    expect(body.id).toBe(first.id);
    expect(body.removalToken).toBeUndefined();
    expect(body.snapshotCount).toBe(1);
    expect(body.entry.createdAt).toBe(first.entry.createdAt);
    expect(Date.parse(body.entry.lastPublishedAt)).toBeGreaterThanOrEqual(Date.parse(first.entry.lastPublishedAt));

    const changed = await publish(scoredRun(3));
    expect(changed.status).toBe(201);
    const index = await (await request(`/r/endpoint/${encodeURIComponent(ENDPOINT)}`)).json();
    expect(index.endpoint).toBe('https://published.example/mcp');
    expect(index.retention).toBe(PUBLISHED_REPORT_RETENTION);
    expect(index.snapshots.map((entry) => entry.id)).toEqual([(await changed.json()).id, first.id]);
    expect(index.snapshots[0]).not.toHaveProperty('removalTokenHash');
  });

  it('moves a republished identical run to the front and keeps its permalink and removal token', async () => {
    const first = await (await publish(artifactFor(evaluation(), '2026-10-20T09:00:00.000Z'))).json();
    const changed = await (await publish(failedRun())).json();
    const badgePath = `/badge/report/${encodeURIComponent(ENDPOINT)}.svg`;
    expect((await request(badgePath)).headers.get('X-Badge-Result')).toBe('blocked');

    const again = await (await publish(artifactFor(evaluation(), '2026-10-20T11:00:00.000Z'))).json();
    expect(again.deduplicated).toBe(true);
    expect(again.id).toBe(first.id);
    expect(again.entry.createdAt).toBe(first.entry.createdAt);
    expect(Date.parse(again.entry.lastPublishedAt)).toBeGreaterThanOrEqual(Date.parse(changed.entry.createdAt));
    expect(again.snapshotCount).toBe(2);

    const index = await (await request(`/r/endpoint/${encodeURIComponent(ENDPOINT)}`)).json();
    expect(index.snapshots.map((entry) => entry.id)).toEqual([first.id, changed.id]);
    expect(index.snapshots[0]).toMatchObject({ createdAt: first.entry.createdAt, lastPublishedAt: again.entry.lastPublishedAt });
    expect((await request(badgePath)).headers.get('X-Badge-Result')).toBe('review');
    expect((await request(`/r/${first.id}`)).status).toBe(200);
    expect((await request(`/r/${changed.id}`)).status).toBe(200);

    const removed = await request(`/r/${first.id}`, { method: 'DELETE', headers: { 'X-Removal-Token': first.removalToken } });
    expect(removed.status).toBe(204);
    expect((await request(badgePath)).headers.get('X-Badge-Result')).toBe('blocked');
  });

  it('keeps only the newest snapshots per endpoint', async () => {
    // Spread the runs over several hours so the per-host publish limit never applies.
    vi.useFakeTimers({ toFake: ['Date'] });
    const ids = [];
    for (let run = 0; run < PUBLISHED_REPORT_RETENTION + 2; run += 1) {
      vi.setSystemTime(Date.parse('2026-10-20T00:00:00.000Z') + run * 10 * 60 * 1000);
      const response = await publish(scoredRun(run));
      expect(response.status).toBe(201);
      ids.push((await response.json()).id);
    }
    vi.useRealTimers();
    const index = await (await request(`/r/endpoint/${encodeURIComponent(ENDPOINT)}`)).json();
    expect(index.snapshots).toHaveLength(PUBLISHED_REPORT_RETENTION);
    expect(index.snapshots[0].id).toBe(ids[ids.length - 1]);
    expect((await request(`/r/${ids[0]}`)).status).toBe(404);
    expect((await request(`/r/${ids[ids.length - 1]}`)).status).toBe(200);
  });

  it('rejects artifacts that fail schema validation', async () => {
    const artifact = artifactFor(evaluation());
    delete artifact.outcome;
    const response = await publish(artifact);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe('schema_validation_failed');
    expect(body.errors[0].message).toContain('outcome');

    const extra = await publish({ ...artifactFor(evaluation()), extraField: true });
    expect((await extra.json()).error).toBe('schema_validation_failed');
    expect((await publish('{not json')).status).toBe(400);
    expect((await publish([])).status).toBe(400);
  });

  it.each([
    ['an Authorization header in evidence metadata', (artifact) => {
      artifact.sections[0].evidence[0].metadata = { Authorization: 'Bearer target-token' };
    }],
    ['a bearer credential in evidence text', (artifact) => {
      artifact.sections[0].evidence[0].message = 'Retry with Bearer secret-access-token';
    }],
    ['a sensitive query parameter in a URL', (artifact) => {
      artifact.sections[0].evidence[0].context = 'Tried https://published.example/mcp?access_token=abc';
    }],
    ['an unredacted assignment', (artifact) => {
      artifact.sections[0].evidence[0].context = 'response: api_key=sk_live_123456789012';
    }],
    ['a JWT', (artifact) => {
      artifact.sections[0].evidence[0].message = 'Got eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    }],
    ['a well-known provider key shape', (artifact) => {
      artifact.sections[0].evidence[0].message = 'token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
    }],
    ['a JSON-shaped string with a secret', (artifact) => {
      artifact.sections[0].evidence[0].context = '{"headers":{"x-api-key":"plain-key"}}';
    }],
    ['a sensitive key in a tool schema', (artifact) => {
      artifact.toolSurfaceAnalysis.toolDefinitions.tools[0].inputSchema.properties.password = { type: 'string' };
    }],
    ['a credential appended to the redaction marker of an assignment', (artifact) => {
      artifact.sections[0].evidence[0].message = 'Retry with api_key=[REDACTED]plain-secret';
    }],
    ['a credential appended to an encoded redaction marker inside nested metadata', (artifact) => {
      artifact.sections[0].evidence[0].metadata = { request: { query: { raw: 'token=%5BREDACTED%5Dplain-secret' } } };
    }],
    ['an Authorization header nested several objects deep', (artifact) => {
      artifact.sections[0].evidence[0].metadata = { request: { headers: { nested: { Authorization: 'Bearer deep-token' } } } };
    }],
    ['a bearer credential after the canonical reference prefix in evidence metadata', (artifact) => {
      artifact.sections[0].evidence[0].metadata = { referenceUrl: `${CANONICAL_REFERENCE} Bearer plain-secret` };
    }],
    ['a JWT after the canonical reference prefix in a transport diagnostic', (artifact) => {
      artifact.sections[0].evidence[0].metadata = { transportDiagnostic: { id: 'transport.accept-header-406', referenceUrl: `${CANONICAL_REFERENCE}.${JWT}` } };
    }],
    ['a query credential after the canonical reference prefix in a release priority', (artifact) => {
      artifact.releaseDecision.priorities.push({
        id: 'transport.accept-header-406', severity: 'high', title: 'Accept header', detail: 'Rejected', remediation: 'Fix it', source: 'Evaluation',
        referenceUrl: `${CANONICAL_REFERENCE}?access_token=plain-secret`,
      });
    }],
    ['a canonical reference URL under a key the app never writes it to', (artifact) => {
      artifact.sections[0].evidence[0].metadata = { extra: { referenceUrl: `${CANONICAL_REFERENCE}-plain-secret-with-sk-abcdefghijklmnopqrstuvwxyz` } };
    }],
    ['a JSON-encoded bearer string inside nested evidence metadata', (artifact) => {
      artifact.sections[0].evidence[0].metadata = { nested: { note: '"Bearer\\u0020example-access-token"' } };
    }],
    ['a bearer string JSON-encoded inside a JSON-encoded object', (artifact) => {
      artifact.sections[0].evidence[0].context = JSON.stringify({ response: '"Bearer\\u0020example-access-token"' });
    }],
    ['a JSON-encoded string nested too deeply to inspect', (artifact) => {
      artifact.sections[0].evidence[0].context = encodeTimes('plain text', 5);
    }],
    ['a JSON fragment with an escaped bearer separator after a prefix in evidence text', (artifact) => {
      artifact.sections[0].evidence[0].message = 'response: {"note":"Bearer\\u0020example-access-token"}';
    }],
    ['a bearer credential whose separator is a literal JSON escape', (artifact) => {
      artifact.sections[0].evidence[0].message = 'Retry with Bearer\\u0020example-access-token';
    }],
    ['a backslash-escaped JSON credential inside a quoted body', (artifact) => {
      artifact.sections[0].evidence[0].context = String.raw`body="{\"access_token\":\"escaped-json-secret\"}"`;
    }],
    ['a JSON fragment with a sensitive key embedded between prose and a stray quote', (artifact) => {
      artifact.sections[0].evidence[0].message = 'the server said "no" then {"x-api-key":"plain-key"} and gave up';
    }],
    ['a JSON fragment after the canonical reference prefix in evidence metadata', (artifact) => {
      artifact.sections[0].evidence[0].metadata = { referenceUrl: `${CANONICAL_REFERENCE} {"note":"Bearer\\u0020plain-secret"}` };
    }],
    ['a credential assignment encoded into a URL query name whose value is the marker', (artifact) => {
      artifact.sections[0].evidence[0].message = 'https://example.test/?access_token%3Dopaquecredential123=%5BREDACTED%5D';
    }],
    ['a bearer credential encoded into a URL query name', (artifact) => {
      artifact.sections[0].evidence[0].message = 'https://example.test/?Bearer%20opaque-name-value77=1';
    }],
    ['a URL query name encoded past the decode bound', (artifact) => {
      artifact.sections[0].evidence[0].message = `https://example.test/?${Array.from({ length: 6 }).reduce((text) => encodeURIComponent(text), 'access%5Ftoken')}=%5BREDACTED%5D`;
    }],
    // F9: a userinfo password is a credential in a URL of any scheme and outside a URL.
    ['a password in the userinfo of an ftp URL', (artifact) => {
      artifact.sections[0].evidence[0].message = 'ftp://alice:opaquecredential123@files.example/report';
    }],
    ['a password in the userinfo of a wss URL', (artifact) => {
      artifact.sections[0].evidence[0].message = 'Connected to wss://alice:opaquecredential123@relay.example/mcp';
    }],
    ['a password in the userinfo of a custom-scheme URL', (artifact) => {
      artifact.sections[0].evidence[0].message = 'x-mcp+v1://alice:opaquecredential123@broker.example/session';
    }],
    ['a password in the userinfo of a URL whose scheme cannot carry one', (artifact) => {
      artifact.sections[0].evidence[0].message = 'file://alice:opaquecredential123@files.example/report';
    }],
    ['a bare user:password@host outside a URL', (artifact) => {
      artifact.sections[0].evidence[0].metadata = { command: 'sftp alice:opaquecredential123@files.example:22' };
    }],
    ['a query credential in a wss URL', (artifact) => {
      artifact.sections[0].evidence[0].message = 'wss://relay.example/mcp?access_token=opaquecredential123';
    }],
    // F10: userinfo detection is context-free; a scheme without `//` is no escape.
    ['a password in the userinfo of an https URL written without //', (artifact) => {
      artifact.sections[0].evidence[0].message = 'https:alice:opaquecredential123@files.example/report';
    }],
    ['a mailto-style user:password@host', (artifact) => {
      artifact.sections[0].evidence[0].message = 'mailto:alice:opaquecredential123@mail.example';
    }],
    ['a percent-encoded userinfo password after a scheme without //', (artifact) => {
      artifact.sections[0].evidence[0].metadata = { command: 'curl https:alice:opaque%40credential%2F123%3Ax@files.example/report' };
    }],
  ])('rejects %s even when the schema is satisfied', async (_name, poison) => {
    const artifact = artifactFor(evaluation());
    poison(artifact);
    const response = await publish(artifact);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe('unredacted_content');
    expect(body.message).toContain('redacted');
    // Nothing is stored for a rejected publish.
    const index = await (await request(`/r/endpoint/${encodeURIComponent(ENDPOINT)}`)).json();
    expect(index.snapshots).toHaveLength(0);
  });

  it.each([
    ...REPORT_REDACTION_STRING_FIXTURES.map((fixture) => [fixture.name, fixture.secrets, (artifact) => {
      artifact.sections[0].evidence[0].message = fixture.value;
    }]),
    ...REPORT_REDACTION_VALUE_FIXTURES.map((fixture) => [fixture.name, fixture.secrets, (artifact) => {
      artifact.sections[0].evidence[0].metadata = clone(fixture.value);
    }]),
  ])('rejects the app redaction fixture %s and stores nothing', async (_name, secrets, poison) => {
    const artifact = artifactFor(evaluation());
    poison(artifact);
    const serialized = JSON.stringify(artifact);
    expect(secrets.some((secret) => serialized.includes(JSON.stringify(secret).slice(1, -1)))).toBe(true);
    const response = await publish(artifact);
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe('unredacted_content');
    const index = await (await request(`/r/endpoint/${encodeURIComponent(ENDPOINT)}`)).json();
    expect(index.snapshots).toHaveLength(0);
  });

  it('stores only artifacts that pass the guard after the transform, for every fixture in every embedding', async () => {
    // Each case gets its own host so accepted cases never trip the host rate limit,
    // which also lets the cases run in parallel batches; a cold CI runner needs that.
    const runCase = async ([index, [name, text, secrets]]) => {
      const endpoint = `https://fuzz-${index}.example/mcp`;
      const artifact = clone(baseArtifact);
      artifact.target.testedEndpoint = endpoint;
      artifact.sections[0].evidence[0].message = text;
      const response = await publish(artifact);
      expect([201, 422], `${name}: ${response.status}`).toContain(response.status);
      const index_ = await (await request(`/r/endpoint/${encodeURIComponent(endpoint)}`)).json();
      if (response.status === 422) {
        expect((await response.json()).error, name).toBe('unredacted_content');
        expect(index_.snapshots, name).toHaveLength(0);
        return;
      }
      const { id } = await response.json();
      const stored = await (await request(`/r/${id}`)).json();
      expect(findEmbeddedSecret(JSON.stringify(stored), secrets), name).toBeUndefined();
      expect(findUnredactedSecret(stored), name).toBeUndefined();
      expect(validateStored(stored), name).toBe(true);
    };
    const cases = [...CREDENTIAL_FUZZ_CASES.entries()];
    const BATCH = 16;
    for (let start = 0; start < cases.length; start += BATCH) {
      await Promise.all(cases.slice(start, start + BATCH).map(runCase));
    }
  }, 240_000);

  it('refuses to store an artifact the guard still recognizes after the transform', async () => {
    const artifact = artifactFor(evaluation());
    expect(findUnredactedSecret(artifact)).toBeUndefined();
    transform.override = (value) => {
      const leaked = clone(value);
      leaked.sections[0].evidence[0].message = 'Retry with Bearer transform-left-this';
      return leaked;
    };
    const response = await publish(artifact);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe('unredacted_content');
    expect(body.message).toContain('once redacted: contains a Bearer or Basic credential at sections.0.evidence.0.message');
    const index = await (await request(`/r/endpoint/${encodeURIComponent(ENDPOINT)}`)).json();
    expect(index.snapshots).toHaveLength(0);

    transform.override = undefined;
    expect((await publish(artifact)).status).toBe(201);
  });

  it('stores the artifact through the redaction transform and derives the permalink from the stored form', async () => {
    // An unknown schema keyword is not a credential, so the guard accepts it; the
    // app's transform drops it, and the Worker stores what the app would have.
    const artifact = artifactFor(evaluation());
    artifact.toolSurfaceAnalysis.toolDefinitions.tools[0].inputSchema['x-internal'] = 'not part of the stored vocabulary';
    expect(findUnredactedSecret(artifact)).toBeUndefined();
    const response = await publish(artifact);
    expect(response.status).toBe(201);
    const { id } = await response.json();

    const stored = await (await request(`/r/${id}`)).json();
    expect(stored.toolSurfaceAnalysis.toolDefinitions.tools[0].inputSchema['x-internal']).toBeUndefined();
    expect(stored.toolSurfaceAnalysis.toolDefinitions.status).toBe('partial');
    expect(JSON.stringify(stored)).not.toContain('not part of the stored vocabulary');
    expect(validateStored(stored), JSON.stringify(validateStored.errors)).toBe(true);
    expect(findUnredactedSecret(stored)).toBeUndefined();

    // The stored form is its own fixed point, so republishing it is a duplicate of the same permalink.
    const republished = await publish(stored);
    expect(republished.status).toBe(200);
    expect(await republished.json()).toMatchObject({ id, deduplicated: true });
  });

  it('accepts redacted markers the app produces and the schema fields that look sensitive', async () => {
    const artifact = artifactFor(evaluation({
      serverUrl: 'https://published.example/mcp?token=secret',
      sections: {
        ...evaluation().sections,
        auth: {
          name: 'Authorization Required', description: 'OAuth', score: 0, maxScore: 0,
          details: [{
            text: 'Authorization: Bearer secret-token', context: 'Set-Cookie: sid=abc',
            metadata: { authorization: 'Bearer x', responseHeaders: { 'WWW-Authenticate': 'Bearer realm="mcp"' } },
          }],
        },
      },
    }));
    expect(JSON.stringify(artifact)).not.toContain('secret');
    expect(findUnredactedSecret(artifact)).toBeUndefined();
    expect((await publish(artifact)).status).toBe(201);
  });

  it('accepts complete redaction markers and canonical reference links where the app writes them', async () => {
    const artifact = artifactFor(evaluation());
    artifact.sections[0].evidence[0].message = 'Retry with api_key=[REDACTED] and token="[REDACTED]"';
    artifact.sections[0].evidence[0].context = 'https://published.example/mcp?token=%5BREDACTED%5D&page=2';
    artifact.sections[0].evidence[0].metadata = {
      referenceUrl: CANONICAL_REFERENCE,
      transportDiagnostic: { id: 'transport.accept-header-406', referenceUrl: CANONICAL_REFERENCE },
      request: { headers: { Authorization: '[REDACTED]' } },
    };
    artifact.releaseDecision.priorities.push({
      id: 'transport.accept-header-406', severity: 'high', title: 'Accept header', detail: 'Rejected', remediation: 'Fix it', source: 'Evaluation',
      referenceUrl: CANONICAL_REFERENCE,
    });
    expect(validateStored(artifact), JSON.stringify(validateStored.errors)).toBe(true);
    expect(findUnredactedSecret(artifact)).toBeUndefined();
    expect((await publish(artifact)).status).toBe(201);
  });

  it('scans decoded JSON strings with the same guard and refuses uninspectable decoding', () => {
    expect(findUnredactedSecret({ note: '"Bearer\\u0020example-access-token"' }))
      .toEqual({ path: 'note', reason: 'contains a Bearer or Basic credential (inside JSON-encoded text)' });
    expect(findUnredactedSecret({ note: JSON.stringify({ headers: { note: '"Bearer\\u0020example-access-token"' } }) }))
      .toEqual({ path: 'note', reason: 'contains a Bearer or Basic credential (inside JSON-encoded text) (inside JSON-encoded text at headers.note)' });
    expect(findUnredactedSecret({ note: JSON.stringify({ headers: { 'x-api-key': 'plain' } }) })).toMatchObject({ path: 'note' });
    expect(findUnredactedSecret({ authorizationSetup: { alternativeHeaderTemplate: '"Bearer\\u0020plain-secret"' } }))
      .toMatchObject({ path: 'authorizationSetup.alternativeHeaderTemplate' });
    expect(findUnredactedSecret({ authorizationSetup: { alternativeHeaderTemplate: 'Authorization: Bearer <token>' } })).toBeUndefined();

    expect(findUnredactedSecret({ note: encodeTimes('plain text', 4) })).toBeUndefined();
    expect(findUnredactedSecret({ note: encodeTimes('Bearer secret-access-token', 4) })).toMatchObject({ path: 'note' });
    expect(findUnredactedSecret({ note: encodeTimes('plain text', 5) }))
      .toEqual({ path: 'note', reason: 'JSON-encoded text is nested too deeply to inspect' });
    expect(findUnredactedSecret({ note: `${'['.repeat(64)}0${']'.repeat(64)}` })).toBeUndefined();
    expect(findUnredactedSecret({ note: `${'['.repeat(65)}0${']'.repeat(65)}` }))
      .toEqual({ path: 'note', reason: 'JSON-encoded text is nested too deeply to inspect' });
    expect(findUnredactedSecret({ note: `[${'0,'.repeat(99998)}0]` })).toBeUndefined();
    expect(findUnredactedSecret({ note: `[${'0,'.repeat(100000)}0]` }))
      .toEqual({ path: 'note', reason: 'JSON-encoded text is too large to inspect' });
    expect(findUnredactedSecret({ note: '"not json' })).toBeUndefined();
    expect(findUnredactedSecret({ note: '"42"' })).toBeUndefined();
  });

  it('finds credentials in JSON fragments embedded anywhere in a string and behind JSON escapes', () => {
    expect(findUnredactedSecret({ note: 'response: {"note":"Bearer\\u0020example-access-token"}' }))
      .toEqual({ path: 'note', reason: 'contains a Bearer or Basic credential (inside an embedded JSON fragment at note)' });
    expect(findUnredactedSecret({ note: 'Retry with Bearer\\u0020example-access-token' }))
      .toEqual({ path: 'note', reason: 'contains a Bearer or Basic credential (after decoding JSON escapes)' });
    expect(findUnredactedSecret({ note: 'log: [{"headers":{"note":"Bearer\\u0020plain"}}] end' }))
      .toEqual({ path: 'note', reason: 'contains a Bearer or Basic credential (inside an embedded JSON fragment at 0.headers.note)' });
    expect(findUnredactedSecret({ note: 'log: [{"headers":{"x-api-key":"plain"}}] end' })).toMatchObject({ path: 'note' });
    expect(findUnredactedSecret({ note: String.raw`body="{\"access_token\":\"escaped-json-secret\"}"` })).toMatchObject({ path: 'note' });
    expect(findUnredactedSecret({ note: 'said "no" then {"token":"plain"} done' })).toMatchObject({ path: 'note' });
    expect(findUnredactedSecret({ note: 'prefix {"nested":"{\\"note\\":\\"Bearer\\u0020plain\\"}"} suffix' })).toMatchObject({ path: 'note' });
    expect(findUnredactedSecret({ authorizationSetup: { alternativeHeaderTemplate: 'X {"note":"Bearer\\u0020plain-secret"}' } }))
      .toMatchObject({ path: 'authorizationSetup.alternativeHeaderTemplate' });

    // Redacted fragments, ordinary brackets and ordinary backslashes are accepted.
    expect(findUnredactedSecret({ note: 'response: {"note":"Bearer [REDACTED]","token":"[REDACTED]"}' })).toBeUndefined();
    expect(findUnredactedSecret({ note: String.raw`body="{\"access_token\":\"[REDACTED]\"}"` })).toBeUndefined();
    expect(findUnredactedSecret({ note: '[INFO] started [WARN] {unbalanced [ok] C:\\temp\\new\\file' })).toBeUndefined();
    expect(findUnredactedSecret({ note: `${'[INFO] '.repeat(5000)}done` })).toBeUndefined();
    expect(findUnredactedSecret({ note: `${'{a:'.repeat(20)}1${'}'.repeat(20)}` })).toBeUndefined();

    // Decoding is bounded: escapes past the budget and fragments past the parse budget are refused.
    expect(findUnredactedSecret({ note: `prefix ${encodeTimes('plain text', 4)}` })).toBeUndefined();
    expect(findUnredactedSecret({ note: `prefix ${encodeTimes('plain text', 6)}` }))
      .toEqual({ path: 'note', reason: 'JSON escapes are nested too deeply to inspect' });
    expect(findUnredactedSecret({ note: `prefix ${encodeTimes('Bearer secret-access-token', 4)}` })).toMatchObject({ path: 'note' });
    expect(findUnredactedSecret({ note: `prefix ${'{"a":'.repeat(40)}x${'}'.repeat(40)}` }))
      .toEqual({ path: 'note', reason: 'contains too many JSON-shaped fragments to inspect' });
    expect(findUnredactedSecret({ note: `prefix ${'['.repeat(65)}0${']'.repeat(65)}` }))
      .toEqual({ path: 'note', reason: 'JSON-encoded text is nested too deeply to inspect' });
  });

  it('refuses credentials in nested objects regardless of their key', () => {
    expect(findUnredactedSecret({ a: [{ b: { c: { note: `see ${JWT}` } } }] })).toEqual({ path: 'a.0.b.c.note', reason: 'contains a JWT' });
    expect(findUnredactedSecret({ a: { b: { 'x-api-key': 'plain' } } })).toEqual({ path: 'a.b.x-api-key', reason: 'sensitive key "x-api-key" must be redacted' });
    expect(findUnredactedSecret({ a: { b: { 'x-api-key': '[REDACTED]', note: 'secret=[REDACTED]' } } })).toBeUndefined();
    expect(findUnredactedSecret({ a: { b: { note: 'secret=[REDACTED]-still-a-secret' } } })).toMatchObject({ path: 'a.b.note' });
  });

  it('rejects oversized bodies and non-public endpoints', async () => {
    const artifact = artifactFor(evaluation());
    artifact.sections[0].evidence[0].context = 'x'.repeat(600 * 1024);
    expect((await publish(artifact)).status).toBe(413);
    for (const serverUrl of ['http://localhost:3000/mcp', 'http://127.0.0.1/mcp', 'ftp://files.example/mcp']) {
      const local = await publish(artifactFor(evaluation({ serverUrl })));
      expect(local.status).toBe(422);
      expect((await local.json()).error).toBe('endpoint_not_publishable');
    }
  });

  it('rate limits publishing per endpoint host and per address', async () => {
    const hostLimit = PUBLISH_RATE_LIMITS.host.limit;
    for (let run = 0; run < hostLimit; run += 1) {
      expect((await publish(scoredRun(run))).status).toBe(201);
    }
    const limited = await publish(scoredRun(99));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect((await limited.json()).message).toContain('endpoint host');

    const ipLimit = PUBLISH_RATE_LIMITS.ip.limit;
    for (let run = 0; run < ipLimit; run += 1) {
      const response = await publish(forHost(`host-${run}.example`), '192.0.2.1');
      expect(response.status).toBe(201);
    }
    const ipLimited = await publish(forHost('host-x.example'), '192.0.2.1');
    expect(ipLimited.status).toBe(429);
    expect((await ipLimited.json()).message).toContain('address');
  }, 30_000);

  it('answers preflight and refuses other methods', async () => {
    const preflight = await request('/r', { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://mcptest.io');
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('X-Removal-Token');
    expect((await request('/r', { method: 'GET' })).status).toBe(405);
    expect((await request('/r/not-an-id')).status).toBe(404);
    expect((await request('/r/a/b')).status).toBe(404);
  });

  it('returns 503 when the binding is missing and leaves other routes to the state API', async () => {
    delete env.PUBLISHED_REPORTS;
    expect((await request(`/r/${publishedReportId('a'.repeat(20), 'b'.repeat(20))}`)).status).toBe(503);
    expect((await request('/api/state')).status).toBe(401);
  });
});

describe('removing a published report', () => {
  it('deletes with the removal token and refuses without it', async () => {
    const published = await (await publish(artifactFor(evaluation()))).json();
    const missing = await request(`/r/${published.id}`, { method: 'DELETE' });
    expect(missing.status).toBe(401);
    const wrong = await request(`/r/${published.id}`, { method: 'DELETE', headers: { 'X-Removal-Token': 'nope' } });
    expect(wrong.status).toBe(403);
    expect((await request(`/r/${published.id}`)).status).toBe(200);

    const removed = await request(`/r/${published.id}`, {
      method: 'DELETE',
      headers: { 'X-Removal-Token': published.removalToken },
    });
    expect(removed.status).toBe(204);
    expect((await request(`/r/${published.id}`)).status).toBe(404);
    const again = await request(`/r/${published.id}`, {
      method: 'DELETE',
      headers: { 'X-Removal-Token': published.removalToken },
    });
    expect(again.status).toBe(404);
    const index = await (await request(`/r/endpoint/${encodeURIComponent(ENDPOINT)}`)).json();
    expect(index.snapshots).toHaveLength(0);
  });
});

describe('published report badges', () => {
  it('serves the neutral badge until a report is published, then the latest result', async () => {
    const path = `/badge/report/${encodeURIComponent(ENDPOINT)}.svg`;
    const neutral = await request(path);
    expect(neutral.status).toBe(200);
    expect(neutral.headers.get('X-Badge-Result')).toBe('neutral');
    expect(neutral.headers.get('Cache-Control')).toBe(UNKNOWN_BADGE_CACHE_CONTROL);
    expect(await neutral.text()).toContain('<title>tested on: mcptest.io</title>');

    await publish(artifactFor(evaluation()));
    const published = await request(path);
    expect(published.headers.get('Content-Type')).toBe('image/svg+xml; charset=utf-8');
    expect(published.headers.get('Cache-Control')).toBe(KNOWN_BADGE_CACHE_CONTROL);
    const index = await (await request(`/r/endpoint/${encodeURIComponent(ENDPOINT)}`)).json();
    expect(index.snapshots[0].summary.releaseStatus).toBe('review');
    expect(published.headers.get('X-Badge-Result')).toBe('review');
    expect(await published.text()).toContain('<title>mcptest.io: review</title>');

    await publish(failedRun());
    expect((await request(path)).headers.get('X-Badge-Result')).toBe('blocked');
  });

  it('keeps the catalog badge route and answers HEAD', async () => {
    const catalog = await request('/badge/server/context7.svg');
    expect(catalog.headers.get('X-Badge-Result')).toBe('ready');
    const head = await request(`/badge/report/${encodeURIComponent(ENDPOINT)}.svg`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect((await request('/badge/report/not-a-url.svg')).headers.get('X-Badge-Result')).toBe('neutral');
    expect((await request('/badge/report/x.svg', { method: 'POST' })).status).toBe(405);
  });
});
