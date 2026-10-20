import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../content/frontmatter';
import { extractHeadings } from '../content/outline';
import { TRANSPORT_DIAGNOSTIC_IDS } from '../types/transportDiagnostics';
import { OUTPUT_CONTRACT_FINDING_ID } from './outputContract';
import { redactReportValue } from './reportArtifact';
import {
  DIAGNOSTICS_REFERENCE_PATH,
  REFERENCED_FINDING_IDS,
  referenceAnchorFor,
  referencePathFor,
  referenceUrlFor,
} from './referenceLinks';
import { TRANSPORT_DIAGNOSTIC_DEFINITIONS } from './transportDiagnostics';

const articleHeadings = (slug: string) => {
  const raw = readFileSync(resolve(`src/content/articles/${slug}.md`), 'utf8');
  return extractHeadings(parseFrontmatter(raw).content);
};

/** Every quoted `transport.*` or `tool.*` id literal in a source file. */
const emittedIds = (file: string): string[] => [
  ...new Set(
    [...readFileSync(resolve(file), 'utf8').matchAll(/['"`]((?:transport|tool)\.[a-z0-9-]+)['"`]/g)]
      .map(([, id]) => id)
  ),
];

describe('reference links', () => {
  it('derives the anchor by replacing dots with hyphens', () => {
    expect(referenceAnchorFor('transport.accept-header-406')).toBe('transport-accept-header-406');
    expect(referenceAnchorFor('tool.output-contract-violation')).toBe('tool-output-contract-violation');
  });

  it('builds a site-relative path and a canonical absolute URL', () => {
    expect(referencePathFor('transport.accept-header-406'))
      .toBe('/learn/mcp-transport-diagnostics-reference#transport-accept-header-406');
    expect(referenceUrlFor('transport.accept-header-406'))
      .toBe('https://mcptest.io/learn/mcp-transport-diagnostics-reference#transport-accept-header-406');
  });

  it('returns nothing for ids without a reference section', () => {
    expect(referencePathFor('evaluation.partial')).toBeUndefined();
    expect(referenceUrlFor('tool.some-surface-finding')).toBeUndefined();
    expect(referenceUrlFor('transport')).toBeUndefined();
  });

  it('keeps canonical reference fragments through report redaction and redacts anything else', () => {
    const canonical = referenceUrlFor('transport.get-stream-405');
    expect(redactReportValue({ referenceUrl: canonical })).toEqual({ referenceUrl: canonical });
    expect(redactReportValue({ referenceUrl: 'https://example.com/cb#access_token=secret' }))
      .toEqual({ referenceUrl: 'https://example.com/cb#[REDACTED]' });
    expect(redactReportValue({ detail: canonical })).toEqual({
      detail: 'https://mcptest.io/learn/mcp-transport-diagnostics-reference#[REDACTED]',
    });
  });

  it('maps every id emitted by the transport diagnostics and output-contract modules', () => {
    const emitted = [
      ...TRANSPORT_DIAGNOSTIC_IDS,
      ...Object.keys(TRANSPORT_DIAGNOSTIC_DEFINITIONS),
      OUTPUT_CONTRACT_FINDING_ID,
      ...emittedIds('src/types/transportDiagnostics.ts'),
      ...emittedIds('src/utils/transportDiagnostics.ts'),
      ...emittedIds('src/utils/outputContract.ts'),
    ];
    expect(emitted.length).toBeGreaterThan(REFERENCED_FINDING_IDS.length);
    for (const id of new Set(emitted)) {
      expect(referencePathFor(id), id).toBeDefined();
    }
  });

  it('points every mapped id at an existing heading for that id in the reference article', () => {
    const slug = DIAGNOSTICS_REFERENCE_PATH.replace('/learn/', '');
    const headings = articleHeadings(slug);
    for (const id of REFERENCED_FINDING_IDS) {
      const heading = headings.find((item) => item.id === referenceAnchorFor(id));
      expect(heading, id).toBeDefined();
      expect(heading?.level).toBe(2);
      expect(heading?.text).toBe(id);
    }
  });
});

describe('pre-existing article anchors', () => {
  const pinned = JSON.parse(
    readFileSync(resolve('src/content/__fixtures__/original-article-heading-ids.json'), 'utf8')
  ) as Record<string, string[]>;

  it.each(Object.keys(pinned))('keeps every heading id of %s unchanged', (slug) => {
    expect(articleHeadings(slug).map(({ id }) => id)).toEqual(pinned[slug]);
  });
});
