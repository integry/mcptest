import type { ReleaseReadinessStatus } from './releaseReadiness';
import type { CatalogServerStatus } from '../types/catalog';

// This module is shared by the React app, the SEO prerender script, and the
// main Cloudflare Worker (bundled by wrangler). Keep it free of runtime
// imports so the worker bundle stays small.

export const BADGE_SITE_URL = 'https://mcptest.io';

/** A badge either names a release result from the evaluator or is the neutral brand badge. */
export type BadgeVariant = ReleaseReadinessStatus | 'neutral';

interface BadgeDefinition {
  label: string;
  message: string;
  /** Right-hand segment color, taken from the light-theme semantic tokens in src/styles/tokens.css. */
  color: string;
  /** File name under public/badge/. */
  file: string;
}

const LABEL_COLOR = '#555';

export const BADGE_DEFINITIONS: Record<BadgeVariant, BadgeDefinition> = {
  neutral: { label: 'tested on', message: 'mcptest.io', color: '#047857', file: 'mcptest' },
  ready: { label: 'mcptest.io', message: 'ready', color: '#047857', file: 'ready' },
  review: { label: 'mcptest.io', message: 'review', color: '#d97706', file: 'review' },
  'authorization-required': {
    label: 'mcptest.io',
    message: 'auth required',
    color: '#d97706',
    file: 'authorization-required',
  },
  blocked: { label: 'mcptest.io', message: 'blocked', color: '#dc2626', file: 'blocked' },
  unknown: { label: 'mcptest.io', message: 'unknown', color: '#64748b', file: 'unknown' },
};

export const BADGE_VARIANTS = Object.keys(BADGE_DEFINITIONS) as BadgeVariant[];

const isBadgeVariant = (value: unknown): value is BadgeVariant => (
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(BADGE_DEFINITIONS, value)
);

/** Selects the badge for a release decision status; anything unrecognized gets the neutral badge. */
export const getBadgeVariantForResult = (status: ReleaseReadinessStatus | undefined): BadgeVariant => (
  isBadgeVariant(status) ? status : 'neutral'
);

/** The subset of a catalog validation result the badge mapping reads. */
export interface CatalogBadgeEvidence {
  status: CatalogServerStatus;
  requiresOAuth?: boolean;
  authType?: string;
  protocolVersion?: string;
}

/**
 * Maps the latest catalog validation run onto the evaluator's result vocabulary.
 * Catalog validation is a connection probe, so it can only claim what it observed:
 * an offline endpoint is blocked, a negotiated MCP session without credentials is
 * ready, an authentication challenge is authorization-required, and anything else
 * is unknown.
 */
export const getCatalogBadgeVariant = (evidence: CatalogBadgeEvidence | undefined): BadgeVariant => {
  if (!evidence) return 'neutral';
  if (evidence.status === 'offline') return 'blocked';
  if (evidence.status !== 'online') return 'unknown';
  if (evidence.protocolVersion) return 'ready';
  if (evidence.requiresOAuth || (evidence.authType && evidence.authType !== 'none')) {
    return 'authorization-required';
  }
  return 'unknown';
};

// Approximate Verdana 11px advance widths, matching the font shields.io uses.
const CHARACTER_WIDTHS: Record<string, number> = {
  ' ': 3.9, '.': 3.9, '-': 4.9,
  a: 6.7, b: 6.9, c: 5.8, d: 6.9, e: 6.7, f: 3.9, g: 6.9, h: 7.0, i: 3.0, j: 3.8,
  k: 6.5, l: 3.0, m: 10.7, n: 7.0, o: 6.7, p: 6.9, q: 6.9, r: 4.7, s: 5.7, t: 4.3,
  u: 7.0, v: 6.5, w: 9.0, x: 6.5, y: 6.5, z: 5.8,
};

const textWidth = (text: string) => Math.round(
  [...text].reduce((total, character) => total + (CHARACTER_WIDTHS[character] ?? 7.0), 0)
);

const escapeXml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Accessible name for a badge, e.g. "mcptest.io: ready". */
export const getBadgeTitle = (variant: BadgeVariant) => {
  const { label, message } = BADGE_DEFINITIONS[variant];
  return `${label}: ${message}`;
};

/** Renders a flat shields.io-style badge using system fonts and a <title> for screen readers. */
export const renderBadgeSvg = (variant: BadgeVariant): string => {
  const { label, message, color } = BADGE_DEFINITIONS[variant];
  const labelTextWidth = textWidth(label);
  const messageTextWidth = textWidth(message);
  const labelWidth = labelTextWidth + 10;
  const messageWidth = messageTextWidth + 10;
  const width = labelWidth + messageWidth;
  const title = escapeXml(getBadgeTitle(variant));
  const labelX = labelWidth / 2;
  const messageX = labelWidth + messageWidth / 2;
  const text = (value: string, x: number, length: number) => (
    `<text x="${x}" y="15" fill="#010101" fill-opacity=".3" textLength="${length}">${escapeXml(value)}</text>`
    + `<text x="${x}" y="14" textLength="${length}">${escapeXml(value)}</text>`
  );
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${title}">`,
    `<title>${title}</title>`,
    '<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>',
    `<clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)"><rect width="${labelWidth}" height="20" fill="${LABEL_COLOR}"/><rect x="${labelWidth}" width="${messageWidth}" height="20" fill="${color}"/><rect width="${width}" height="20" fill="url(#s)"/></g>`,
    '<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">',
    text(label, labelX, labelTextWidth),
    text(message, messageX, messageTextWidth),
    '</g>',
    '</svg>',
    '',
  ].join('\n');
};

/** URL of the static badge asset served from public/badge/. */
export const getStaticBadgeUrl = (variant: BadgeVariant, siteUrl = BADGE_SITE_URL) => (
  `${siteUrl}/badge/${BADGE_DEFINITIONS[variant].file}.svg`
);

/** URL of the worker-served badge for a catalog server. */
export const getCatalogBadgeUrl = (serverId: string, siteUrl = BADGE_SITE_URL) => (
  `${siteUrl}/badge/server/${encodeURIComponent(serverId)}.svg`
);

/** URL of the worker-served badge that follows the latest published report for an endpoint. */
export const getPublishedReportBadgeUrl = (endpoint: string, siteUrl = BADGE_SITE_URL) => (
  `${siteUrl}/badge/report/${encodeURIComponent(endpoint)}.svg`
);

/** Canonical public report URL for an endpoint, matching ReportView's /report/<encoded> route. */
export const getReportUrl = (endpoint: string, siteUrl = BADGE_SITE_URL) => (
  `${siteUrl}/report/${encodeURIComponent(endpoint)}`
);

/** Canonical catalog profile URL, matching the prerendered /servers/<id>/ page. */
export const getServerProfileUrl = (serverId: string, siteUrl = BADGE_SITE_URL) => (
  `${siteUrl}/servers/${encodeURIComponent(serverId)}/`
);

export interface BadgeSnippets {
  markdown: string;
  html: string;
  restructuredText: string;
}

const escapeMarkdownText = (value: string) => value.replace(/([\\[\]])/g, '\\$1');
// Markdown destinations break on whitespace and unbalanced parentheses.
const escapeMarkdownUrl = (value: string) => value
  .replace(/ /g, '%20')
  .replace(/\(/g, '%28')
  .replace(/\)/g, '%29');

/** Builds copyable embed snippets for a badge image that links to a report page. */
export const createBadgeSnippets = ({
  imageUrl,
  linkUrl,
  alt,
}: {
  imageUrl: string;
  linkUrl: string;
  alt: string;
}): BadgeSnippets => ({
  markdown: `[![${escapeMarkdownText(alt)}](${escapeMarkdownUrl(imageUrl)})](${escapeMarkdownUrl(linkUrl)})`,
  html: `<a href="${escapeXml(linkUrl)}"><img src="${escapeXml(imageUrl)}" alt="${escapeXml(alt)}"></a>`,
  restructuredText: [
    `.. image:: ${imageUrl}`,
    `   :alt: ${alt.replace(/\s+/g, ' ')}`,
    `   :target: ${linkUrl}`,
  ].join('\n'),
});

/** Snippets for a live report: the static result badge linking to the report for the endpoint. */
export const createReportBadgeSnippets = (endpoint: string, variant: BadgeVariant) => createBadgeSnippets({
  imageUrl: getStaticBadgeUrl(variant),
  linkUrl: getReportUrl(endpoint),
  alt: getBadgeTitle(variant),
});

/** Snippets for a published report: the live badge that follows the latest published snapshot. */
export const createPublishedReportBadgeSnippets = (endpoint: string) => createBadgeSnippets({
  imageUrl: getPublishedReportBadgeUrl(endpoint),
  linkUrl: getReportUrl(endpoint),
  alt: 'Tested on mcptest.io',
});

/** Snippets for a catalog server: the worker badge that follows the latest validation data. */
export const createCatalogBadgeSnippets = (serverId: string) => createBadgeSnippets({
  imageUrl: getCatalogBadgeUrl(serverId),
  linkUrl: getServerProfileUrl(serverId),
  alt: 'Tested on mcptest.io',
});
