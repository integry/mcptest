/**
 * In-page outline helpers shared by the reading layout (browser) and the
 * prerendered fallback HTML (Node). Both derive heading ids from the same
 * plain-text slug so anchors agree.
 */

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

/** Strips inline Markdown (code, emphasis, links) down to plain text. */
export const headingPlainText = (markdown: string) =>
  markdown
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]+/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .trim();

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
