import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import assetValidator from './validate-catalog-assets.js';
import catalogValidator from './validate-catalog.js';
import {
  applySubmission,
  escapeMarkdown,
  generateMonogramSvg,
  parseSubmissionPayload,
  reconcileWithValidation,
  renderPullRequest,
  resolveLogoDownloadUrl,
  type CatalogSubmissionPayload,
  type SubmissionPaths,
} from './apply-catalog-submission';
import type { CatalogServerSeed, CatalogValidationResult } from '../src/types/catalog';

const fixture = (): CatalogSubmissionPayload => JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'catalog-submission', 'payload.json'),
  'utf8'
));

const SIMPLE_ICONS_URL = 'https://github.com/simple-icons/simple-icons/blob/16.35.0/icons/acme.svg';
const VALID_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';

let root: string;
let paths: SubmissionPaths;
const seedsBefore = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'serverCatalog.json'), 'utf8')) as CatalogServerSeed[];
const readCatalog = () => JSON.parse(fs.readFileSync(paths.catalog, 'utf8')) as CatalogServerSeed[];
const last = <T>(items: T[]): T => items[items.length - 1];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-submission-'));
  paths = {
    catalog: path.join(root, 'serverCatalog.json'),
    validation: path.join(root, 'catalogValidation.json'),
    logos: path.join(root, 'public', 'server-logos'),
    catalogSizeTest: path.join(root, 'catalogUtils.test.ts'),
  };
  fs.mkdirSync(paths.logos, { recursive: true });
  fs.writeFileSync(paths.catalog, `${JSON.stringify(seedsBefore, null, 2)}\n`);
  fs.writeFileSync(paths.catalogSizeTest, [
    `expect(catalog).toHaveLength(${seedsBefore.length});`,
    `expect(catalogValidation).toHaveLength(${seedsBefore.length});`,
    `expect(new Set(ids).size).toBe(${seedsBefore.length});`,
    'expect(other).toHaveLength(3);',
  ].join('\n'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const noFetch = vi.fn(async () => { throw new Error('no network in this test'); });

describe('apply-catalog-submission', () => {
  it('appends a community-submission entry with a generated monogram that passes the catalog checks', async () => {
    const result = await applySubmission(fixture(), { paths, today: '2026-10-20', fetchImpl: noFetch as unknown as typeof fetch });

    expect(result.id).toBe('acme-weather');
    const catalog = readCatalog();
    expect(catalog).toHaveLength(seedsBefore.length + 1);
    expect(catalog.slice(0, -1)).toEqual(seedsBefore);
    expect(last(catalog)).toEqual({
      id: 'acme-weather',
      name: 'Acme Weather',
      url: 'https://mcp.acme-weather.dev/mcp',
      browserAccess: 'direct',
      description: 'Read-only forecasts and severe-weather alerts for any coordinates. No authentication is required.',
      category: 'Search',
      tags: ['search', 'community-submission', 'no-auth'],
      listingSource: { kind: 'community-submission', url: 'https://acme-weather.dev/docs/mcp' },
      transport: 'streamable-http',
      requiresOAuth: false,
      authType: 'none',
      logoUrl: '/server-logos/acme-weather.svg',
      logoSourceKind: 'generated-fallback',
      logoRetrievedAt: '2026-10-20',
      logoLicenseNote: 'Locally generated AW monogram for a community submission; it is not an official Acme Weather mark.',
      homepageUrl: 'https://acme-weather.dev/docs/mcp',
    });
    expect(JSON.stringify(catalog)).not.toContain('maintainers@acme-weather.dev');
    expect(noFetch).not.toHaveBeenCalled();

    expect(() => catalogValidator.validateCatalogSeed(last(catalog))).not.toThrow();
    expect(assetValidator.validateCatalogAssets([last(catalog)], { publicRoot: path.join(root, 'public') })).toEqual([]);
    expect(fs.readFileSync(paths.catalogSizeTest, 'utf8')).toBe([
      `expect(catalog).toHaveLength(${seedsBefore.length + 1});`,
      `expect(catalogValidation).toHaveLength(${seedsBefore.length + 1});`,
      `expect(new Set(ids).size).toBe(${seedsBefore.length + 1});`,
      'expect(other).toHaveLength(3);',
    ].join('\n'));
  });

  it('downloads a licensed Simple Icons logo from the raw URL and records its provenance', async () => {
    const payload = fixture();
    payload.submission.logoLicense = 'simple-icons';
    payload.submission.logoUrl = SIMPLE_ICONS_URL;
    const fetchImpl = vi.fn(async () => new Response(VALID_SVG, { headers: { 'content-type': 'image/svg+xml' } }));

    const { entry } = await applySubmission(payload, { paths, today: '2026-10-20', fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/simple-icons/simple-icons/16.35.0/icons/acme.svg',
      expect.objectContaining({ redirect: 'follow' })
    );
    expect(entry).toMatchObject({
      logoUrl: '/server-logos/acme-weather.svg',
      logoSourceUrl: SIMPLE_ICONS_URL,
      logoSourceKind: 'simple-icons',
      logoLicenseNote: expect.stringContaining('Simple Icons version 16.35.0'),
    });
    expect(fs.readFileSync(path.join(paths.logos, 'acme-weather.svg'), 'utf8')).toBe(VALID_SVG);
    expect(assetValidator.validateCatalogAssets([entry], { publicRoot: path.join(root, 'public') })).toEqual([]);
  });

  it.each([
    ['an unsafe SVG', () => new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script></svg>', { headers: { 'content-type': 'image/svg+xml' } }), /unsafe <script/],
    ['an HTML page', () => new Response('<!doctype html><title>x</title>', { headers: { 'content-type': 'text/html' } }), /neither an SVG nor a PNG/],
    ['a 404', () => new Response('missing', { status: 404 }), /HTTP 404/],
    ['an oversized file', () => new Response('x'.repeat(300 * 1024), { headers: { 'content-type': 'image/svg+xml' } }), /maximum is/],
  ])('falls back to the monogram when the logo is %s', async (_label, respond, reason) => {
    const payload = fixture();
    payload.submission.logoLicense = 'official-brand';
    payload.submission.logoUrl = 'https://acme-weather.dev/brand/logo.svg';

    const { entry, logo } = await applySubmission(payload, {
      paths,
      today: '2026-10-20',
      fetchImpl: (async () => respond()) as unknown as typeof fetch,
    });

    expect(entry.logoSourceKind).toBe('generated-fallback');
    expect(entry).not.toHaveProperty('logoSourceUrl');
    expect(logo.fallbackReason).toMatch(reason);
    expect(fs.readdirSync(paths.logos)).toEqual(['acme-weather.svg']);
    expect(assetValidator.validateCatalogAssets([entry], { publicRoot: path.join(root, 'public') })).toEqual([]);
  });

  it('maps an OAuth challenge to an OAuth entry and suffixes a colliding id', async () => {
    const payload = fixture();
    payload.evidence = {
      ...payload.evidence,
      outcome: 'auth-challenge',
      authChallenge: 'oauth',
      authStatus: 401,
      transport: undefined,
      protocolVersion: undefined,
      protocolEra: undefined,
      toolCount: undefined,
      browserAccess: 'proxy-required',
    };
    const seeds = readCatalog();
    fs.writeFileSync(paths.catalog, JSON.stringify([...seeds, { ...seeds[0], id: 'acme-weather', url: 'https://other.example-host.dev/mcp' }]));

    const { id, entry } = await applySubmission(payload, { paths, fetchImpl: noFetch as unknown as typeof fetch });

    expect(id).toBe('acme-weather-2');
    expect(entry).toMatchObject({ authType: 'oauth', requiresOAuth: true, browserAccess: 'proxy-required', transport: 'streamable-http' });
    expect(entry.tags).toContain('oauth');
  });

  it('refuses an endpoint that is already listed and a payload that fails the schema', async () => {
    const duplicate = fixture();
    duplicate.submission.url = 'https://mcp.context7.com/mcp';
    duplicate.evidence.endpointUrl = duplicate.submission.url;
    await expect(applySubmission(duplicate, { paths })).rejects.toThrow(/already listed as context7/);

    const tampered = fixture();
    (tampered.submission as Record<string, unknown>).logoUrl = 'https://acme-weather.dev/logo.svg';
    expect(() => parseSubmissionPayload(tampered)).toThrow(/invalid/);
    expect(() => parseSubmissionPayload({ ...fixture(), submission_id: '../../etc' })).toThrow(/submission_id/);
    expect(() => parseSubmissionPayload({ ...fixture(), evidence: { ...fixture().evidence, outcome: 'unreachable' } })).toThrow(/invalid/);
    expect(readCatalog()).toHaveLength(seedsBefore.length);
  });

  it('takes transport and auth from the runner result when the server is online', async () => {
    await applySubmission(fixture(), { paths, fetchImpl: noFetch as unknown as typeof fetch });
    const runner: CatalogValidationResult = {
      serverId: 'acme-weather',
      status: 'online',
      transport: 'legacy-sse',
      authType: 'oauth',
      requiresOAuth: true,
      protocolEra: 'legacy',
      checkedAt: '2026-10-20T10:20:00.000Z',
    };
    fs.writeFileSync(paths.validation, JSON.stringify([runner]));

    expect(reconcileWithValidation('acme-weather', { paths })).toEqual(runner);
    expect(last(readCatalog())).toMatchObject({
      transport: 'legacy-sse',
      authType: 'oauth',
      requiresOAuth: true,
      tags: ['search', 'community-submission', 'oauth'],
    });

    fs.writeFileSync(paths.validation, JSON.stringify([{ ...runner, status: 'offline', authType: 'none' }]));
    reconcileWithValidation('acme-weather', { paths });
    expect(last(readCatalog())).toMatchObject({ authType: 'oauth' });
  });
});

describe('submission pull request body', () => {
  const online: CatalogValidationResult = {
    serverId: 'acme-weather',
    status: 'online',
    transport: 'streamable-http',
    authType: 'none',
    requiresOAuth: false,
    protocolEra: 'stateless',
    protocolVersion: '2025-06-18',
    checkedAt: '2026-10-20T10:20:00.000Z',
    message: 'Negotiated stateless MCP 2025-06-18.',
  };

  it('contains the description, both kinds of evidence, the contact email and the checklist', () => {
    const { title, body, draft } = renderPullRequest({
      payload: fixture(),
      id: 'acme-weather',
      validation: online,
      validationOutcome: 'success',
      assetsOutcome: 'success',
      runUrl: 'https://github.com/integry/mcptest/actions/runs/1',
    });

    expect(draft).toBe(false);
    expect(title).toBe('Add Acme Weather to the catalog (community submission)');
    expect(body).toContain('> Read-only forecasts and severe-weather alerts for any coordinates. No authentication is required.');
    expect(body).toContain('### Browser-side evidence');
    expect(body).toContain('| Tools without credentials | 4 |');
    expect(body).toContain('### Runner-side validation');
    expect(body).toContain('`npm run validate-catalog -- --only acme-weather`: passed');
    expect(body).toContain('`maintainers@acme-weather.dev`');
    expect(body).toContain('### Maintainer checklist');
    expect(body).toMatch(/- \[ \] The runner reports the server `online`/);
    expect(body).toContain('`6f1c2a9e-4b7d-4c1e-9a53-2f8e0d4b7c11`');
  });

  it('becomes a draft that shows the failure when a runner check fails', () => {
    const logFile = path.join(root, 'validate.log');
    fs.writeFileSync(logFile, 'acme-weather: offline, unknown - network_error\n```injected```');
    const { body, draft } = renderPullRequest({
      payload: fixture(),
      id: 'acme-weather',
      validation: { ...online, status: 'offline', errorCode: 'network_error' },
      validationOutcome: 'failure',
      validationLog: logFile,
      assetsOutcome: 'success',
    });

    expect(draft).toBe(true);
    expect(body).toContain('opened as a draft');
    expect(body).toContain('`npm run validate-catalog -- --only acme-weather`: **failed**');
    expect(body).toContain('error `network_error`');
    expect(body).toContain('acme-weather: offline, unknown - network_error');
    expect(body.match(/```/g)).toHaveLength(2);
  });

  it('neutralizes markup, links and mentions in submitter text', () => {
    expect(escapeMarkdown('Ping @octocat <img src=x> [x](https://evil.example) `code`'))
      .toBe('Ping \\@octocat \\<img src=x\\> \\[x\\]\\(https://evil.example\\) \\`code\\`');
    const payload = fixture();
    payload.submission.description = 'Hello @octocat, see [here](https://evil.example) for **details** today.';
    const { body } = renderPullRequest({ payload, id: 'x', validationOutcome: 'success', assetsOutcome: 'success' });
    expect(body).not.toContain('[here](');
    expect(body).not.toMatch(/(?<!\\)@octocat/);
  });
});

describe('logo helpers', () => {
  it('generates a well-formed monogram SVG that escapes the name', () => {
    const svg = generateMonogramSvg('acme', 'Acme & <Co>');
    expect(svg).toContain('Acme &amp; &lt;Co&gt; generated fallback monogram');
    expect(svg).toContain('>AC</text>');
    expect(assetValidator.validateSvg(svg)).toEqual([]);
  });

  it('rewrites GitHub blob links to raw content and leaves other URLs alone', () => {
    expect(resolveLogoDownloadUrl(SIMPLE_ICONS_URL)).toBe('https://raw.githubusercontent.com/simple-icons/simple-icons/16.35.0/icons/acme.svg');
    expect(resolveLogoDownloadUrl('https://acme.dev/logo.svg')).toBe('https://acme.dev/logo.svg');
  });
});
