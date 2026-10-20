/**
 * Single source of truth for linking a diagnostic or finding id to its
 * section of the transport diagnostics reference article.
 *
 * Each id's section heading in `mcp-transport-diagnostics-reference.md`
 * carries an explicit `{#anchor}` suffix, so the fragment never depends on
 * how the heading slugger treats the dot in an id. The anchor is the id with
 * every `.` replaced by `-`: `transport.accept-header-406` links to
 * `#transport-accept-header-406`.
 */

import { SITE_URL } from '../content/contentModel';
import { TRANSPORT_DIAGNOSTIC_IDS } from '../types/transportDiagnostics';
import { OUTPUT_CONTRACT_FINDING_ID } from './outputContract';

export const DIAGNOSTICS_REFERENCE_PATH = '/learn/mcp-transport-diagnostics-reference';

/** Every id that has a section in the reference article. */
export const REFERENCED_FINDING_IDS = [...TRANSPORT_DIAGNOSTIC_IDS, OUTPUT_CONTRACT_FINDING_ID] as const;

export type ReferencedFindingId = typeof REFERENCED_FINDING_IDS[number];

/** The heading anchor for an id: dots become hyphens, nothing else changes. */
export const referenceAnchorFor = (id: string): string => id.replace(/\./g, '-');

const REFERENCED = new Set<string>(REFERENCED_FINDING_IDS);

export const hasReference = (id: string): id is ReferencedFindingId => REFERENCED.has(id);

/** Site-relative link for in-app navigation, or undefined when the id is not documented. */
export const referencePathFor = (id: string): string | undefined => (
  hasReference(id) ? `${DIAGNOSTICS_REFERENCE_PATH}#${referenceAnchorFor(id)}` : undefined
);

/** Canonical absolute link for downloaded artifacts, or undefined when the id is not documented. */
export const referenceUrlFor = (id: string): string | undefined => {
  const path = referencePathFor(id);
  return path ? `${SITE_URL}${path}` : undefined;
};

const REFERENCE_URLS = new Set(REFERENCED_FINDING_IDS.map((id) => referenceUrlFor(id)));

/** True only for the exact canonical URLs above, so report redaction can keep their fragment. */
export const isCanonicalReferenceUrl = (value: unknown): value is string => (
  typeof value === 'string' && REFERENCE_URLS.has(value)
);
