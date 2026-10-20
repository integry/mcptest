import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import catalogValidation from '../data/catalogValidation.json';
import {
  BADGE_DEFINITIONS,
  BADGE_VARIANTS,
  createBadgeSnippets,
  createCatalogBadgeSnippets,
  createReportBadgeSnippets,
  getBadgeVariantForResult,
  getCatalogBadgeUrl,
  getCatalogBadgeVariant,
  getReportUrl,
  getStaticBadgeUrl,
  renderBadgeSvg,
} from './badges';
import type { ReleaseReadinessStatus } from './releaseReadiness';
import { readStylesheet } from '../styles/readStylesheet';

describe('badge selection by result', () => {
  it.each<[ReleaseReadinessStatus, string]>([
    ['ready', 'ready'],
    ['review', 'review'],
    ['blocked', 'blocked'],
    ['unknown', 'unknown'],
    ['authorization-required', 'auth required'],
  ])('maps the %s release status to its own badge', (status, message) => {
    const variant = getBadgeVariantForResult(status);
    expect(variant).toBe(status);
    expect(BADGE_DEFINITIONS[variant].message).toBe(message);
    expect(renderBadgeSvg(variant)).toContain(`<title>mcptest.io: ${message}</title>`);
  });

  it('falls back to the neutral badge without a result', () => {
    expect(getBadgeVariantForResult(undefined)).toBe('neutral');
    expect(getBadgeVariantForResult('passed' as ReleaseReadinessStatus)).toBe('neutral');
    expect(renderBadgeSvg('neutral')).toContain('<title>tested on: mcptest.io</title>');
  });

  it('uses the semantic design-token colors', () => {
    const css = readStylesheet('tokens');
    const token = (name: string) => css.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))?.[1];
    expect(BADGE_DEFINITIONS.ready.color).toBe(token('success-color'));
    expect(BADGE_DEFINITIONS.blocked.color).toBe(token('danger-color'));
    expect(BADGE_DEFINITIONS.review.color).toBe(token('warning-color'));
    expect(BADGE_DEFINITIONS['authorization-required'].color).toBe(token('warning-color'));
    expect(BADGE_DEFINITIONS.unknown.color).toBe(token('secondary-color'));
  });

  it('maps catalog validation evidence onto the release vocabulary', () => {
    expect(getCatalogBadgeVariant(undefined)).toBe('neutral');
    expect(getCatalogBadgeVariant({ status: 'online', protocolVersion: '2025-11-25', authType: 'none' })).toBe('ready');
    expect(getCatalogBadgeVariant({ status: 'online', requiresOAuth: true, authType: 'oauth' })).toBe('authorization-required');
    expect(getCatalogBadgeVariant({ status: 'online', authType: 'api-key' })).toBe('authorization-required');
    expect(getCatalogBadgeVariant({ status: 'online', authType: 'none' })).toBe('unknown');
    expect(getCatalogBadgeVariant({ status: 'offline', protocolVersion: '2025-11-25' })).toBe('blocked');
    expect(getCatalogBadgeVariant({ status: 'unknown' })).toBe('unknown');
  });

  it('gives every bundled catalog validation result a result badge', () => {
    for (const entry of catalogValidation as Parameters<typeof getCatalogBadgeVariant>[0][]) {
      expect(getCatalogBadgeVariant(entry)).not.toBe('neutral');
    }
  });
});

describe('static badge assets', () => {
  it.each(BADGE_VARIANTS)('public/badge asset for %s matches the renderer', (variant) => {
    const file = readFileSync(resolve(`public/badge/${BADGE_DEFINITIONS[variant].file}.svg`), 'utf8');
    expect(file).toBe(renderBadgeSvg(variant));
    expect(file).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"[^>]* role="img" aria-label="[^"]+">/);
    expect(file).not.toContain('<script');
    expect(file.length).toBeLessThan(1500);
  });
});

describe('badge snippets', () => {
  const endpoint = 'https://example.com/mcp?team=a b&x=(1)';
  const encoded = 'https%3A%2F%2Fexample.com%2Fmcp%3Fteam%3Da%20b%26x%3D(1)';

  it('builds the canonical report URL with the endpoint percent-encoded', () => {
    expect(getReportUrl(endpoint)).toBe(`https://mcptest.io/report/${encoded}`);
    expect(decodeURIComponent(getReportUrl(endpoint).slice('https://mcptest.io/report/'.length))).toBe(endpoint);
  });

  it('generates Markdown, HTML and reStructuredText that link to the report', () => {
    const snippets = createReportBadgeSnippets(endpoint, 'ready');
    const markdownUrl = `https://mcptest.io/report/${encoded.replace('(', '%28').replace(')', '%29')}`;
    expect(snippets.markdown).toBe(`[![mcptest.io: ready](https://mcptest.io/badge/ready.svg)](${markdownUrl})`);
    expect(snippets.html).toBe(`<a href="https://mcptest.io/report/${encoded}"><img src="https://mcptest.io/badge/ready.svg" alt="mcptest.io: ready"></a>`);
    expect(snippets.restructuredText).toBe([
      '.. image:: https://mcptest.io/badge/ready.svg',
      '   :alt: mcptest.io: ready',
      `   :target: https://mcptest.io/report/${encoded}`,
    ].join('\n'));
  });

  it('escapes markup characters in HTML and Markdown snippets', () => {
    const snippets = createBadgeSnippets({
      imageUrl: 'https://mcptest.io/badge/mcptest.svg',
      linkUrl: 'https://mcptest.io/report/a"b',
      alt: 'Tested [on] <mcptest>',
    });
    expect(snippets.html).toContain('href="https://mcptest.io/report/a&quot;b"');
    expect(snippets.html).toContain('alt="Tested [on] &lt;mcptest&gt;"');
    expect(snippets.markdown).toContain('[![Tested \\[on\\] <mcptest>]');
  });

  it('points catalog snippets at the worker badge and the server profile', () => {
    expect(getCatalogBadgeUrl('my server/x')).toBe('https://mcptest.io/badge/server/my%20server%2Fx.svg');
    expect(getStaticBadgeUrl('review', '')).toBe('/badge/review.svg');
    expect(createCatalogBadgeSnippets('context7').markdown).toBe(
      '[![Tested on mcptest.io](https://mcptest.io/badge/server/context7.svg)](https://mcptest.io/servers/context7/)'
    );
  });
});
