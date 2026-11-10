import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import serverCatalog from '../data/serverCatalog.json';
import submissionSchema from '../../public/schemas/catalog-submission/v1.schema.json';
import type { CatalogServerSeed } from '../types/catalog';
import {
  CATALOG_SUBMISSION_CATEGORIES,
  CATALOG_SUBMISSION_SCHEMA_URL,
  buildCatalogSubmission,
  catalogEndpointHost,
  deriveCatalogId,
  findCatalogDuplicate,
  getSubmissionEndpointError,
  isPrivateOrReservedHost,
  isSubmittableEvidence,
  normalizeCatalogEndpoint,
  validateCatalogSubmissionDraft,
  type CatalogSubmissionDraft,
  type CatalogSubmissionEvidence,
} from './catalogSubmission';
import { validateCatalogSubmission } from './catalogSubmissionSchema';

const evidence: CatalogSubmissionEvidence = {
  checkedAt: '2026-10-20T10:00:00.000Z',
  endpointUrl: 'https://mcp.acme.dev/mcp',
  outcome: 'mcp',
  transport: 'streamable-http',
  authChallenge: 'none',
  browserAccess: 'direct',
  toolCount: 2,
  detail: 'Negotiated.',
};

const draft = (overrides: Partial<CatalogSubmissionDraft> = {}): CatalogSubmissionDraft => ({
  url: 'https://mcp.acme.dev/mcp',
  name: 'Acme',
  description: 'Exposes Acme invoices as read-only MCP resources. OAuth required.',
  category: 'Finance',
  homepageUrl: 'https://acme.dev',
  logoUrl: '',
  logoLicense: 'none',
  contactEmail: '',
  authorized: true,
  ...overrides,
});

describe('catalog submission rules', () => {
  it('offers exactly the categories the catalog uses, and the schema agrees', () => {
    const used = new Set((serverCatalog as CatalogServerSeed[]).map((seed) => seed.category));
    expect(new Set(CATALOG_SUBMISSION_CATEGORIES)).toEqual(used);
    expect([...CATALOG_SUBMISSION_CATEGORIES]).toEqual(submissionSchema.properties.category.enum);
    expect(submissionSchema.$id).toBe(CATALOG_SUBMISSION_SCHEMA_URL);
    expect(submissionSchema.properties.$schema.const).toBe(CATALOG_SUBMISSION_SCHEMA_URL);
  });

  it.each([
    ['localhost', true],
    ['api.localhost', true],
    ['printer.local', true],
    ['db.corp.internal', true],
    ['router.home.arpa', true],
    ['intranet', true],
    ['10.1.2.3', true],
    ['169.254.169.254', true],
    ['[::1]', true],
    ['example.com', true],
    ['mcp.example', true],
    ['mcp.acme.dev', false],
    ['acme.co.uk', false],
  ])('treats %s as private or reserved: %s', (host, expected) => {
    expect(isPrivateOrReservedHost(host)).toBe(expected);
  });

  it.each([
    ['http://mcp.acme.dev/mcp', /HTTPS/],
    ['https://token@mcp.acme.dev/mcp', /credentials/],
    ['https://mcp.acme.dev/mcp?key=1', /query/],
    ['https://mcp.acme.dev/mcp#x', /query string or fragment/],
    ['https://127.0.0.1/mcp', /public host/],
    ['not a url', /not a valid URL/],
    ['', /required/],
  ])('rejects the endpoint %s', (url, message) => {
    expect(getSubmissionEndpointError(url)).toMatch(message);
  });

  it('accepts a public HTTPS endpoint', () => {
    expect(getSubmissionEndpointError('https://mcp.acme.dev/mcp')).toBeUndefined();
  });

  it('normalizes endpoints so transport siblings and cosmetic variants match', () => {
    const variants = [
      'https://mcp.acme.dev/mcp',
      'https://MCP.acme.dev/',
      'https://www.mcp.acme.dev:443/sse/',
      'https://mcp.acme.dev',
    ];
    expect(new Set(variants.map(normalizeCatalogEndpoint))).toEqual(new Set(['mcp.acme.dev']));
    expect(normalizeCatalogEndpoint('https://gw.acme.dev/a/mcp')).not.toBe(normalizeCatalogEndpoint('https://gw.acme.dev/b/mcp'));
  });

  it('keys the host quota by host name without the port', () => {
    for (const url of [
      'https://mcp.acme.dev/mcp',
      'https://mcp.acme.dev:8443/mcp',
      'https://MCP.acme.dev.:443/tenant-b',
      'https://www.mcp.acme.dev:9000/',
    ]) {
      expect(catalogEndpointHost(url)).toBe('mcp.acme.dev');
    }
    expect(catalogEndpointHost('not a url')).toBeUndefined();
  });

  it('finds catalog duplicates by primary, browser and alternative endpoints', () => {
    const seeds = [{
      id: 'acme',
      url: 'https://acme.dev/',
      browserUrl: 'https://acme.dev/mcp',
      alternativeEndpoints: [{ url: 'https://eu.acme.dev/mcp', description: 'EU' }],
    }] as CatalogServerSeed[];
    expect(findCatalogDuplicate('https://acme.dev/sse', seeds)?.id).toBe('acme');
    expect(findCatalogDuplicate('https://eu.acme.dev/', seeds)?.id).toBe('acme');
    expect(findCatalogDuplicate('https://us.acme.dev/mcp', seeds)).toBeUndefined();
    expect(findCatalogDuplicate('https://mcp.context7.com/mcp')?.id).toBe('context7');
  });

  it.each([
    ['https://mcp.acme.dev/mcp', 'acme'],
    ['https://api.acme.com/v1/mcp', 'acme'],
    ['https://docs.acme.com/mcp', 'acme-docs'],
    ['https://mcp.acme.co.uk/', 'acme'],
    ['https://weather-tools.workers.dev/sse', 'weather-tools'],
    ['https://acme-mcp.vercel.app/mcp', 'acme-mcp'],
    ['https://mcp.example-host.io/mcp', 'example-host'],
  ])('derives a catalog id from %s', (url, id) => {
    expect(deriveCatalogId(url, [])).toBe(id);
  });

  it('suffixes a derived id that is already taken', () => {
    expect(deriveCatalogId('https://mcp.acme.dev/mcp', ['acme'])).toBe('acme-2');
    expect(deriveCatalogId('https://mcp.acme.dev/mcp', ['acme', 'acme-2'])).toBe('acme-3');
    expect(deriveCatalogId('https://mcp.context7.com/mcp')).toBe('context7-2');
  });

  it('only allows submission for a handshake or a recognized challenge on the same URL', () => {
    expect(isSubmittableEvidence(undefined)).toBe(false);
    expect(isSubmittableEvidence(evidence, 'https://mcp.acme.dev/mcp')).toBe(true);
    expect(isSubmittableEvidence(evidence, 'https://mcp.acme.dev/other')).toBe(false);
    expect(isSubmittableEvidence({ ...evidence, outcome: 'auth-challenge', authChallenge: 'oauth', authStatus: 401 })).toBe(true);
    expect(isSubmittableEvidence({ ...evidence, outcome: 'auth-challenge', authChallenge: 'bearer', authStatus: 403 })).toBe(true);
    expect(isSubmittableEvidence({ ...evidence, outcome: 'auth-challenge', authChallenge: 'none', authStatus: 401 })).toBe(false);
    // A challenge without the target's HTTP 401/403 was never observed.
    expect(isSubmittableEvidence({ ...evidence, outcome: 'auth-challenge', authChallenge: 'unspecified' })).toBe(false);
    expect(isSubmittableEvidence({ ...evidence, outcome: 'auth-challenge', authChallenge: 'unspecified', authStatus: 500 })).toBe(false);
    expect(isSubmittableEvidence({ ...evidence, outcome: 'unreachable' })).toBe(false);
  });
});

describe('submission draft validation', () => {
  it('accepts a complete draft', () => {
    expect(validateCatalogSubmissionDraft(draft())).toEqual({});
  });

  it('reports each missing or invalid field', () => {
    const errors = validateCatalogSubmissionDraft(draft({
      url: 'http://mcp.acme.dev',
      name: '',
      description: 'Short.',
      category: 'Gardening',
      homepageUrl: 'ftp://acme.dev',
      logoLicense: '',
      contactEmail: 'nope',
      authorized: false,
    }));
    expect(Object.keys(errors).sort()).toEqual([
      'authorized', 'category', 'contactEmail', 'description', 'homepageUrl', 'logoLicense', 'name', 'url',
    ]);
  });

  it('ties the logo URL to the license statement', () => {
    expect(validateCatalogSubmissionDraft(draft({ logoLicense: 'simple-icons' })).logoUrl).toMatch(/required/);
    expect(validateCatalogSubmissionDraft(draft({ logoLicense: 'none', logoUrl: 'https://acme.dev/logo.svg' })).logoUrl).toMatch(/Remove/);
    expect(validateCatalogSubmissionDraft(draft({ logoLicense: 'official-brand', logoUrl: 'https://acme.dev/logo.svg' }))).toEqual({});
  });

  it('builds a body that the Worker schema accepts, without empty optional fields', () => {
    const body = buildCatalogSubmission(draft({ description: '  Exposes   Acme invoices as read-only MCP resources.  ' }), evidence);
    expect(body).not.toHaveProperty('logoUrl');
    expect(body).not.toHaveProperty('contactEmail');
    expect(body).not.toHaveProperty('turnstileToken');
    expect(body.description).toBe('Exposes Acme invoices as read-only MCP resources.');
    expect(validateCatalogSubmission(body)).toEqual({ valid: true, submission: body });

    const withExtras = buildCatalogSubmission(
      draft({ contactEmail: 'a@acme.dev', logoLicense: 'official-brand', logoUrl: 'https://acme.dev/logo.svg' }),
      evidence,
      'turnstile-token'
    );
    expect(withExtras).toMatchObject({ contactEmail: 'a@acme.dev', logoUrl: 'https://acme.dev/logo.svg', turnstileToken: 'turnstile-token' });
    expect(validateCatalogSubmission(withExtras).valid).toBe(true);
  });
});

describe('reviewed community submission entries', () => {
  const futureinfra = (serverCatalog as CatalogServerSeed[]).find((seed) => seed.id === 'futureinfra');

  it('uses the FI monogram for FutureInfra in the logo and its license note', () => {
    const svg = readFileSync(resolve('public/server-logos/futureinfra.svg'), 'utf8');
    expect(svg).toMatch(/>FI<\/text>/);
    expect(futureinfra?.logoLicenseNote).toContain('generated FI monogram');
  });

  it('keeps FutureInfra limitations in caveats and records its publisher-documented OAuth flow', () => {
    expect(futureinfra?.description).not.toMatch(/prepaid|South Korea/);
    expect(futureinfra?.caveats).toEqual([
      expect.stringContaining('prepaid account credits'),
      expect.stringContaining('limited to South Korea'),
    ]);
    expect(futureinfra?.transport).toBe('streamable-http');
    expect(futureinfra?.oauthRegistration).toMatchObject({
      mode: 'automatic',
      clientId: { required: false },
      clientSecret: { required: false },
      browserPublicClientSupported: true,
      evidenceUrl: 'https://futureinfra.ai/docs/mcp/',
    });
  });
});
