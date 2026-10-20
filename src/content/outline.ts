/**
 * In-page outline helpers shared by the reading layout (browser) and the
 * prerendered fallback HTML (Node). Both derive heading ids from the same
 * plain-text slug so anchors agree.
 */

import { decodeNamedCharacterReference } from 'decode-named-character-reference';

export interface OutlineHeading {
  level: 2 | 3;
  text: string;
  id: string;
}

export const slugifyHeading = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-') || 'section';

const HEADING_ANCHOR_PATTERN = /\s*\{#([^}\s]+)\}\s*$/;

/** Shape of an explicit anchor accepted after a heading, as in `## Title {#my-anchor}`. */
export const HEADING_ANCHOR_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Splits an explicit `{#anchor}` suffix off a heading. Authors use it to keep
 * a published fragment working when the heading text changes.
 */
export const splitHeadingAnchor = (text: string): { text: string; anchor?: string } => {
  const match = text.match(HEADING_ANCHOR_PATTERN);
  if (!match) return { text: text.trim() };
  return { text: text.slice(0, match.index).trim(), anchor: match[1] };
};

/**
 * Allocates unique ids for headings in document order. Every emitted id is
 * reserved, so a literal heading such as `Example-2` can never collide with
 * the `-2` suffix generated for a repeated `Example`. An explicit anchor is
 * used verbatim when it is still free and otherwise suffixed like any slug.
 */
export const createHeadingIdAllocator = () => {
  const used = new Set<string>();
  const nextSuffix = new Map<string, number>();
  return (text: string, anchor?: string) => {
    const base = anchor && HEADING_ANCHOR_ID_PATTERN.test(anchor) ? anchor : slugifyHeading(text);
    let id = base;
    let suffix = nextSuffix.get(base) ?? 2;
    while (used.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    nextSuffix.set(base, suffix);
    used.add(id);
    return id;
  };
};

/** A code span: a backtick run, its literal content, and a closing run of the same length. */
const CODE_SPAN_PATTERN = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;

/** A CommonMark backslash escape of ASCII punctuation, or a character reference such as `&amp;`, `&#38;`, `&#x26;`. */
const ESCAPE_OR_CHARACTER_REFERENCE_PATTERN = /\\([!-/:-@[-`{-~])|&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{0,30});/gi;

/**
 * Decodes a numeric character reference the way CommonMark parsers do:
 * control characters, surrogates, noncharacters, and out-of-range code
 * points become U+FFFD instead of throwing or leaking into ids.
 */
const decodeNumericCharacterReference = (reference: string): string => {
  const hex = reference[1] === 'x' || reference[1] === 'X';
  const code = Number.parseInt(reference.slice(hex ? 2 : 1), hex ? 16 : 10);
  const invalid =
    code < 9 ||
    code === 11 ||
    (code > 13 && code < 32) ||
    (code > 126 && code < 160) ||
    (code > 0xd7ff && code < 0xe000) ||
    (code > 0xfdcf && code < 0xfdf0) ||
    (code & 0xffff) === 0xffff ||
    (code & 0xffff) === 0xfffe ||
    code > 0x10ffff;
  return invalid ? '\uFFFD' : String.fromCodePoint(code);
};

/** Decodes one character reference (without `&` and `;`), or returns undefined when Markdown would keep it literal. */
const decodeCharacterReference = (reference: string): string | undefined => {
  if (reference[0] === '#') return decodeNumericCharacterReference(reference);
  const decoded = decodeNamedCharacterReference(reference);
  return decoded === false ? undefined : decoded;
};

/** Plain text of a heading fragment outside code spans: links become labels, emphasis markers go, escapes and entities decode. */
const inlinePlainText = (markdown: string) =>
  markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]+/g, '')
    .replace(ESCAPE_OR_CHARACTER_REFERENCE_PATTERN, (match, escaped: string | undefined, reference: string | undefined) =>
      escaped ?? decodeCharacterReference(reference ?? '') ?? match
    );

/**
 * Strips inline Markdown (code, emphasis, links, images) down to the plain
 * text a Markdown parser would produce, so ids computed from source agree
 * with ids computed from the parsed tree. Code span contents stay literal and
 * character references such as `&amp;` decode exactly as they do in the
 * browser renderer.
 */
export const headingPlainText = (markdown: string) => {
  let text = '';
  let cursor = 0;
  for (const match of markdown.matchAll(CODE_SPAN_PATTERN)) {
    text += inlinePlainText(markdown.slice(cursor, match.index)) + match[2];
    cursor = match.index + match[0].length;
  }
  text += inlinePlainText(markdown.slice(cursor));
  return text.trim();
};

/** Extracts h2 and h3 headings from Markdown source, skipping fenced code. */
export const extractOutline = (markdown: string): OutlineHeading[] => {
  const headings: OutlineHeading[] = [];
  const allocate = createHeadingIdAllocator();
  let inFence = false;
  let fenceMarker = '';

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    const level = heading[1].length;
    const { text: rawText, anchor } = splitHeadingAnchor(heading[2]);
    const text = headingPlainText(rawText);
    const id = allocate(text, anchor);
    if (level === 2 || level === 3) {
      headings.push({ level, text, id });
    }
  }

  return headings;
};
