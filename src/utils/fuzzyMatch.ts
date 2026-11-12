/**
 * A small, dependency-free fuzzy matcher for the playground capability search.
 *
 * Every whitespace-separated query token must match at least one searchable
 * field. Identifiers (names and titles) accept substring and subsequence
 * matches; prose (descriptions, URIs) accepts substring matches only, so a
 * short query does not light up every long description by accident.
 */

export type MatchRange = readonly [start: number, end: number];

export interface FieldMatch {
  score: number;
  ranges: MatchRange[];
}

export type SearchFieldKind = 'identifier' | 'prose';

export interface SearchField {
  key: string;
  text: string;
  kind: SearchFieldKind;
  weight: number;
}

/** A field prepared once per item so repeated queries only scan lowercase text. */
export interface PreparedField extends SearchField {
  lower: string;
}

export interface FuzzyResult {
  score: number;
  ranges: Record<string, MatchRange[]>;
}

const BOUNDARY_CHARACTERS = new Set([' ', '_', '-', '.', '/', ':', '(', '[', '{']);

const isBoundary = (text: string, index: number): boolean => {
  if (index === 0) return true;
  const previous = text[index - 1];
  if (BOUNDARY_CHARACTERS.has(previous)) return true;
  const current = text[index];
  // camelCase: a capital that follows a lowercase letter starts a word.
  return current !== current.toLowerCase() && previous === previous.toLowerCase()
    && previous !== previous.toUpperCase();
};

export const tokenizeQuery = (query: string): string[] => (
  query.trim().toLowerCase().split(/\s+/).filter(Boolean)
);

export const prepareFields = (fields: readonly SearchField[]): PreparedField[] => (
  fields.filter((field) => field.text).map((field) => ({ ...field, lower: field.text.toLowerCase() }))
);

const substringMatch = (field: PreparedField, token: string): FieldMatch | null => {
  let best: FieldMatch | null = null;
  let from = 0;
  // Prefer an occurrence on a word boundary over the first occurrence.
  while (from <= field.lower.length - token.length) {
    const index = field.lower.indexOf(token, from);
    if (index < 0) break;
    const boundary = isBoundary(field.text, index);
    let score = 10 + token.length * 2 + (boundary ? 8 : 0) + (index === 0 ? 6 : 0);
    if (index === 0 && token.length === field.lower.length) score += 20;
    if (!best || score > best.score) best = { score, ranges: [[index, index + token.length]] };
    if (boundary) break;
    from = index + 1;
  }
  return best;
};

const greedySubsequence = (
  field: PreparedField,
  token: string,
  preferBoundaries: boolean
): FieldMatch | null => {
  const ranges: Array<[number, number]> = [];
  let score = 0;
  let position = 0;
  let previous = -2;
  for (const character of token) {
    let index = field.lower.indexOf(character, position);
    if (index < 0) return null;
    // Jump ahead to a word-boundary occurrence when one exists before the
    // next consecutive hit would be lost; `gc` should prefer get_catalog's c.
    if (preferBoundaries && index !== previous + 1) {
      let candidate = index;
      while (candidate >= 0 && !isBoundary(field.text, candidate)) {
        candidate = field.lower.indexOf(character, candidate + 1);
      }
      if (candidate >= 0) index = candidate;
    }
    if (index === previous + 1) {
      score += 4;
      ranges[ranges.length - 1][1] = index + 1;
    } else {
      score += 1 - Math.min(3, (index - position) * 0.1);
      ranges.push([index, index + 1]);
    }
    if (isBoundary(field.text, index)) score += 5;
    previous = index;
    position = index + 1;
  }
  return { score, ranges };
};

// Jumping to boundaries can strand later characters, so fall back to a plain scan.
const subsequenceMatch = (field: PreparedField, token: string): FieldMatch | null => (
  greedySubsequence(field, token, true) ?? greedySubsequence(field, token, false)
);

export const matchField = (field: PreparedField, token: string): FieldMatch | null => (
  substringMatch(field, token)
  ?? (field.kind === 'identifier' && token.length > 1 ? subsequenceMatch(field, token) : null)
);

const mergeRanges = (ranges: readonly MatchRange[]): MatchRange[] => {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
};

/** Scores an item for the query, or returns null when any token is unmatched. */
export const fuzzyMatchFields = (
  fields: readonly PreparedField[],
  tokens: readonly string[]
): FuzzyResult | null => {
  if (tokens.length === 0) return { score: 0, ranges: {} };
  const ranges: Record<string, MatchRange[]> = {};
  let total = 0;
  for (const token of tokens) {
    let bestScore = 0;
    let matched = false;
    for (const field of fields) {
      const match = matchField(field, token);
      if (!match) continue;
      matched = true;
      // Every matching field is highlighted; the best one decides the score.
      ranges[field.key] = [...(ranges[field.key] ?? []), ...match.ranges];
      bestScore = Math.max(bestScore, match.score * field.weight);
    }
    if (!matched) return null;
    total += bestScore;
  }
  for (const key of Object.keys(ranges)) ranges[key] = mergeRanges(ranges[key]);
  return { score: total, ranges };
};

export const fuzzyMatch = (query: string, text: string): FuzzyResult | null => (
  fuzzyMatchFields(prepareFields([{ key: 'text', text, kind: 'identifier', weight: 1 }]), tokenizeQuery(query))
);

export interface RankedItem<T> {
  item: T;
  index: number;
  score: number;
  ranges: Record<string, MatchRange[]>;
}

/** Filters and ranks items, keeping the original order for equal scores. */
export const rankItems = <T>(
  items: readonly T[],
  prepared: readonly PreparedField[][],
  query: string
): RankedItem<T>[] => {
  const tokens = tokenizeQuery(query);
  const results: RankedItem<T>[] = [];
  items.forEach((item, index) => {
    const result = fuzzyMatchFields(prepared[index] ?? [], tokens);
    if (result) results.push({ item, index, score: result.score, ranges: result.ranges });
  });
  if (tokens.length === 0) return results;
  return results.sort((left, right) => right.score - left.score || left.index - right.index);
};

export interface TextSegment {
  text: string;
  match: boolean;
}

/** Splits text into plain and highlighted segments for rendering. */
export const highlightSegments = (text: string, ranges: readonly MatchRange[] | undefined): TextSegment[] => {
  if (!ranges || ranges.length === 0) return [{ text, match: false }];
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const [start, end] of mergeRanges(ranges)) {
    if (start >= text.length) break;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    segments.push({ text: text.slice(start, Math.min(end, text.length)), match: true });
    cursor = Math.min(end, text.length);
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
};
