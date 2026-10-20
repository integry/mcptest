/**
 * In-page outline helpers shared by the reading layout (browser) and the
 * prerendered fallback HTML (Node). Headings are read from the same parsed
 * Markdown tree the browser renderer uses, so every outline link targets an
 * id that the rendered heading actually carries.
 */

import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { HEADING_ANCHOR_ID_PATTERN, splitAtComponentMarker } from './contentModel.ts';

export interface OutlineHeading {
  level: 2 | 3;
  text: string;
  id: string;
}

/** Every heading of a document in order, with the zero-based source line it starts on. */
export interface ParsedHeading {
  level: number;
  text: string;
  id: string;
  line: number;
}

/** The subset of an mdast node the heading helpers touch. */
export interface MarkdownNode {
  type: string;
  depth?: number;
  value?: string;
  alt?: string | null;
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, unknown> };
  position?: { start: { line: number } };
}

export type HeadingIdAllocator = (text: string, anchor?: string) => string;

export const slugifyHeading = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-') || 'section';

const HEADING_ANCHOR_PATTERN = /\s*\{#([^}\s]+)\}\s*$/;

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
export const createHeadingIdAllocator = (): HeadingIdAllocator => {
  const used = new Set<string>();
  const nextSuffix = new Map<string, number>();
  return (text, anchor) => {
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

/** Parses Markdown with the same parser and extensions the browser renderer uses. */
export const parseMarkdown = (markdown: string): MarkdownNode =>
  unified().use(remarkParse).use(remarkGfm).parse(markdown) as MarkdownNode;

/**
 * Plain text of a parsed heading: links (inline or reference) contribute
 * their label, images their alt text, code its content, and character
 * references arrive already decoded by the parser.
 */
export const headingText = (node: MarkdownNode): string => {
  if (node.type === 'image') return node.alt ?? '';
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(headingText).join('');
};

/** Removes a trailing `{#anchor}` from the heading's last text node and returns it. */
const takeHeadingAnchor = (node: MarkdownNode): string | undefined => {
  const children = node.children ?? [];
  const last = children[children.length - 1];
  if (!last || typeof last.value !== 'string') return undefined;
  const { text, anchor } = splitHeadingAnchor(last.value);
  if (!anchor) return undefined;
  if (text) {
    last.value = text;
  } else {
    children.pop();
  }
  return anchor;
};

/**
 * Walks every heading of a parsed tree in document order, strips its explicit
 * anchor, allocates its id, stores the id on the node for rendering, and
 * returns the headings. `lineOffset` shifts reported lines when the tree was
 * parsed from a slice of a larger document.
 */
export const assignHeadingIds = (tree: MarkdownNode, allocate: HeadingIdAllocator, lineOffset = 0): ParsedHeading[] => {
  const headings: ParsedHeading[] = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === 'heading') {
      const anchor = takeHeadingAnchor(node);
      const text = headingText(node).trim();
      const id = allocate(text, anchor);
      node.data = { ...(node.data ?? {}), hProperties: { ...(node.data?.hProperties ?? {}), id } };
      headings.push({ level: node.depth ?? 1, text, id, line: lineOffset + (node.position?.start.line ?? 1) - 1 });
    }
    node.children?.forEach(visit);
  };
  visit(tree);
  return headings;
};

/**
 * Remark plugin that assigns stable ids to headings so the in-page outline
 * (built from the same parsed tree with the same allocator rules) can link to
 * them. A heading may pin its id with a trailing `{#anchor}`.
 */
export const remarkHeadingIds = (allocate: HeadingIdAllocator) => () => (tree: MarkdownNode) => {
  assignHeadingIds(tree, allocate);
};

/**
 * Every heading of an article body in document order, parsed exactly as the
 * browser renders it: one document per component-marker segment, ids
 * allocated across the whole body.
 */
export const extractHeadings = (markdown: string): ParsedHeading[] => {
  const allocate = createHeadingIdAllocator();
  return splitAtComponentMarker(markdown).flatMap(segment =>
    segment.markdown ? assignHeadingIds(parseMarkdown(segment.markdown), allocate, segment.line) : []
  );
};

/** The h2 and h3 entries of the reading outline, with the ids the rendered headings carry. */
export const extractOutline = (markdown: string): OutlineHeading[] =>
  extractHeadings(markdown).flatMap(({ level, text, id }) =>
    level === 2 || level === 3 ? [{ level, text, id }] : []
  );
