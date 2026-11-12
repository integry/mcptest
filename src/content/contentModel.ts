/**
 * Shared content model for Markdown articles. This module is pure TypeScript
 * with no browser or React dependencies so it can be used by the Vite app,
 * tests, and the Node build script alike.
 */
import { expandCompatMatrixDirectives } from './compatMatrix.ts';
import type { OutlineHeading } from './outline.ts';


export const SITE_NAME = 'mcptest.io';
export const SITE_URL = 'https://mcptest.io';

export interface ContentTrack {
  id: 'understand' | 'use' | 'build' | 'reference';
  label: string;
  description: string;
}

export const CONTENT_TRACKS: readonly ContentTrack[] = [
  {
    id: 'understand',
    label: 'Understand',
    description: 'What MCP is, how remote servers differ from local ones, and when building one is worth it.',
  },
  {
    id: 'use',
    label: 'Use',
    description: 'Connect clients to remote servers, compare host support, and get through OAuth.',
  },
  {
    id: 'build',
    label: 'Build',
    description: 'Design, test, and harden a production remote MCP server.',
  },
  {
    id: 'reference',
    label: 'Reference',
    description: 'Error decoders and checklists to keep open while you debug.',
  },
] as const;

export type ContentTrackId = ContentTrack['id'];

export const CONTENT_LEVELS = ['newcomer', 'practitioner', 'expert'] as const;
export type ContentLevel = (typeof CONTENT_LEVELS)[number];

export const CONTENT_LEVEL_LABELS: Record<ContentLevel, string> = {
  newcomer: 'Newcomer',
  practitioner: 'Practitioner',
  expert: 'Expert',
};

/** Names of React components an article may embed through `component:`. */
export const CONTENT_COMPONENT_NAMES = ['DashboardDemo'] as const;
export type ContentComponentName = (typeof CONTENT_COMPONENT_NAMES)[number];

/** Marker line that positions the embedded component inside the body. */
export const COMPONENT_MARKER = '<!-- component -->';

/** Shape of an explicit anchor accepted after a heading, as in `## Title {#my-anchor}`. */
export const HEADING_ANCHOR_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export interface ContentSegment {
  /** Markdown handed to the parser for this segment. */
  markdown: string;
  /** Zero-based line of `markdown`'s first line within the original content. */
  line: number;
}

/**
 * Splits the body at the component marker so the embedded component can be
 * positioned between two independently parsed Markdown documents. The browser
 * renderer and the outline both parse exactly these segments, so heading ids
 * and reference-link resolution agree between them.
 */
export const splitAtComponentMarker = (content: string): ContentSegment[] => {
  const lines = content.split('\n');
  const markerIndex = lines.findIndex(line => line.trim() === COMPONENT_MARKER);
  if (markerIndex === -1) return [{ markdown: content, line: 0 }];
  return [[0, markerIndex], [markerIndex + 1, lines.length]].map(([start, end]) => {
    const raw = lines.slice(start, end).join('\n');
    const trimmedLeadingLines = raw.slice(0, raw.length - raw.trimStart().length).split('\n').length - 1;
    return { markdown: raw.trim(), line: start + trimmedLeadingLines };
  });
};

export interface LearnSourceLink {
  title: string;
  url: string;
}

/** Everything about an article except its body: what navigation, the Learn index and metadata need. */
export interface LearnArticleSummary {
  title: string;
  summary: string;
  slug: string;
  category: string;
  readingTimeMinutes: number;
  lastReviewed: string;
  relatedSlugs: string[];
  sourceLinks: LearnSourceLink[];
  track: ContentTrackId;
  level: ContentLevel;
  order: number;
  /** Canonical URL path, `/learn/<slug>` unless overridden in frontmatter. */
  path: string;
  /** Short label for navigation; defaults to the title. */
  navTitle: string;
  /** Optional `<title>` override; defaults to `${title} | mcptest.io`. */
  metaTitle?: string;
  /** Optional meta description override; defaults to the summary. */
  metaDescription?: string;
  /** Optional registered React component embedded in the page. */
  component?: string;
}

export interface LearnArticle extends LearnArticleSummary {
  /** Markdown body with `compat-matrix` directives expanded. */
  content: string;
}

/**
 * An article as the browser bundle carries it: the summary plus what the
 * page needs before the body arrives. Built at build time from the body
 * (scripts/content/loadArticles.js), which itself is loaded on demand.
 */
export interface LearnArticleEntry extends LearnArticleSummary {
  /** The h2/h3 outline of the body, as `extractOutline` returns it. */
  outline: OutlineHeading[];
  /** Whether the body has a fenced code block and so needs the highlighter. */
  hasCodeBlock: boolean;
}

export interface TrackNavigationItem {
  slug: string;
  title: string;
  navTitle: string;
  path: string;
  summary: string;
  order: number;
  level: ContentLevel;
  readingTimeMinutes: number;
}

export interface TrackNavigation extends ContentTrack {
  items: TrackNavigationItem[];
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const REVIEW_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/**
 * Article paths must be one slug directly under a namespace the application
 * routes to the content view (`/docs/<slug>` or `/learn/<slug>`). Paths outside
 * these namespaces never reach the content view, and bare namespaces or deeper
 * nesting are not article destinations.
 */
export const PATH_PATTERN = /^\/(?:docs|learn)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Non-article destinations inside the content namespaces that no article may claim. */
export const CONTENT_RESERVED_PATHS: readonly string[] = ['/learn', '/docs'];

const TRACK_IDS = new Set<string>(CONTENT_TRACKS.map(track => track.id));
const LEVEL_IDS = new Set<string>(CONTENT_LEVELS);

export const slugFromFileName = (fileName: string) =>
  fileName.replace(/^.*[\\/]/, '').replace(/\.md$/i, '');

const expectString = (value: unknown, field: string, slug: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Article ${slug} is missing required field "${field}".`);
  }
  return value.trim();
};

const optionalString = (value: unknown, field: string, slug: string): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Article ${slug} has an invalid "${field}" value.`);
  }
  return value.trim();
};

const expectStringList = (value: unknown, field: string, slug: string): string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`Article ${slug} field "${field}" must be a list of strings.`);
  }
  return value as string[];
};

const expectSourceLinks = (value: unknown, slug: string): LearnSourceLink[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Article ${slug} field "sourceLinks" must be a list.`);
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Article ${slug} sourceLinks[${index}] must have a title and url.`);
    }
    const { title, url } = item as Record<string, unknown>;
    return {
      title: expectString(title, `sourceLinks[${index}].title`, slug),
      url: expectString(url, `sourceLinks[${index}].url`, slug),
    };
  });
};

const expectNumber = (value: unknown, field: string, slug: string): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`Article ${slug} field "${field}" must be a number.`);
  }
  return value;
};

/**
 * Builds a typed article from parsed frontmatter and body. The slug is the
 * Markdown file name without its extension. `compat-matrix` directives in the
 * body are expanded to Markdown tables here, so every output shares them.
 */
export const createArticle = (
  frontmatter: Record<string, unknown>,
  content: string,
  fileName: string
): LearnArticle => {
  const slug = slugFromFileName(fileName);
  const title = expectString(frontmatter.title, 'title', slug);
  const path = optionalString(frontmatter.path, 'path', slug) ?? `/learn/${slug}`;
  const article: LearnArticle = {
    title,
    summary: expectString(frontmatter.summary, 'summary', slug),
    slug,
    category: expectString(frontmatter.category, 'category', slug),
    readingTimeMinutes: expectNumber(frontmatter.readingTimeMinutes, 'readingTimeMinutes', slug),
    lastReviewed: String(frontmatter.lastReviewed ?? ''),
    relatedSlugs: expectStringList(frontmatter.relatedSlugs, 'relatedSlugs', slug),
    sourceLinks: expectSourceLinks(frontmatter.sourceLinks, slug),
    content: expandCompatMatrixDirectives(content, path),
    track: expectString(frontmatter.track, 'track', slug) as ContentTrackId,
    level: expectString(frontmatter.level, 'level', slug) as ContentLevel,
    order: expectNumber(frontmatter.order, 'order', slug),
    path,
    navTitle: optionalString(frontmatter.navTitle, 'navTitle', slug) ?? title,
  };
  const metaTitle = optionalString(frontmatter.metaTitle, 'metaTitle', slug);
  const metaDescription = optionalString(frontmatter.metaDescription, 'metaDescription', slug);
  const component = optionalString(frontmatter.component, 'component', slug);
  if (metaTitle) article.metaTitle = metaTitle;
  if (metaDescription) article.metaDescription = metaDescription;
  if (component) article.component = component;
  return article;
};

export interface ValidateArticlesOptions {
  /** Component names that `component:` may reference. */
  knownComponents?: readonly string[];
  /** Paths owned by non-article pages that articles must not claim. */
  reservedPaths?: readonly string[];
}

export const validateArticles = (
  articles: readonly LearnArticle[],
  options: ValidateArticlesOptions = {}
) => {
  const knownComponents = new Set(options.knownComponents ?? CONTENT_COMPONENT_NAMES);
  const slugs = new Set<string>();
  const paths = new Map<string, string>();
  const orders = new Map<string, string>();
  for (const reserved of [...CONTENT_RESERVED_PATHS, ...(options.reservedPaths ?? [])]) {
    paths.set(reserved, '(reserved page)');
  }

  for (const article of articles) {
    if (!SLUG_PATTERN.test(article.slug)) {
      throw new Error(`Invalid Learn article slug: ${article.slug}`);
    }
    if (slugs.has(article.slug)) {
      throw new Error(`Duplicate Learn article slug: ${article.slug}`);
    }
    if (!article.title || !article.summary || !article.category || !article.content) {
      throw new Error(`Learn article ${article.slug} is missing required content metadata.`);
    }
    if (!Number.isInteger(article.readingTimeMinutes) || article.readingTimeMinutes < 1) {
      throw new Error(`Learn article ${article.slug} has an invalid reading time.`);
    }
    if (!REVIEW_DATE_PATTERN.test(article.lastReviewed)) {
      throw new Error(`Learn article ${article.slug} has an invalid last-reviewed date.`);
    }
    if (!article.sourceLinks.length) {
      throw new Error(`Learn article ${article.slug} must include source links.`);
    }
    if (!TRACK_IDS.has(article.track)) {
      throw new Error(`Learn article ${article.slug} has an unknown track: ${article.track}`);
    }
    if (!LEVEL_IDS.has(article.level)) {
      throw new Error(`Learn article ${article.slug} has an unknown level: ${article.level}`);
    }
    if (!Number.isInteger(article.order) || article.order < 1) {
      throw new Error(`Learn article ${article.slug} has an invalid order; use a positive integer.`);
    }
    const orderKey = `${article.track}:${article.order}`;
    if (orders.has(orderKey)) {
      throw new Error(
        `Learn articles ${orders.get(orderKey)} and ${article.slug} share order ${article.order} in the ${article.track} track.`
      );
    }
    if (paths.has(article.path)) {
      throw new Error(
        `Learn article ${article.slug} reuses path ${article.path} already owned by ${paths.get(article.path)}.`
      );
    }
    if (!PATH_PATTERN.test(article.path)) {
      throw new Error(
        `Learn article ${article.slug} has an invalid path: ${article.path}. Use /docs/<slug> or /learn/<slug>.`
      );
    }
    if (article.component && !knownComponents.has(article.component)) {
      throw new Error(`Learn article ${article.slug} references unknown component ${article.component}.`);
    }
    if (!article.component && article.content.includes(COMPONENT_MARKER)) {
      throw new Error(`Learn article ${article.slug} contains a component marker but declares no component.`);
    }
    for (const anchor of article.content.match(/\{#[^}]*\}\s*$/gm) ?? []) {
      if (!HEADING_ANCHOR_ID_PATTERN.test(anchor.replace(/^\{#|\}\s*$/g, ''))) {
        throw new Error(
          `Learn article ${article.slug} has an invalid heading anchor ${anchor.trim()}; use lowercase letters, digits, and hyphens.`
        );
      }
    }
    slugs.add(article.slug);
    paths.set(article.path, article.slug);
    orders.set(orderKey, article.slug);
  }

  for (const article of articles) {
    for (const relatedSlug of article.relatedSlugs) {
      if (!slugs.has(relatedSlug)) {
        throw new Error(`Learn article ${article.slug} references unknown article ${relatedSlug}.`);
      }
    }
  }
};

const byOrder = (a: LearnArticleSummary, b: LearnArticleSummary) => a.order - b.order;

export const getTrack = (id: string) => CONTENT_TRACKS.find(track => track.id === id);

/** Articles grouped by track, each track's items sorted by `order`. Empty tracks are omitted. */
export const buildTrackNavigation = (articles: readonly LearnArticleSummary[]): TrackNavigation[] =>
  CONTENT_TRACKS.map(track => ({
    ...track,
    items: articles
      .filter(article => article.track === track.id)
      .sort(byOrder)
      .map(article => ({
        slug: article.slug,
        title: article.title,
        navTitle: article.navTitle,
        path: article.path,
        summary: article.summary,
        order: article.order,
        level: article.level,
        readingTimeMinutes: article.readingTimeMinutes,
      })),
  })).filter(track => track.items.length > 0);

/** Articles in reading order: by track, then by `order`. */
export const sortArticlesForReading = <T extends LearnArticleSummary>(articles: readonly T[]): T[] => {
  const trackIndex = new Map(CONTENT_TRACKS.map((track, index) => [track.id, index]));
  return [...articles].sort(
    (a, b) => (trackIndex.get(a.track) ?? 0) - (trackIndex.get(b.track) ?? 0) || a.order - b.order
  );
};

export const getTrackNeighbors = <T extends LearnArticleSummary>(article: LearnArticleSummary, articles: readonly T[]) => {
  const siblings = articles.filter(item => item.track === article.track).sort(byOrder);
  const index = siblings.findIndex(item => item.slug === article.slug);
  return {
    previous: index > 0 ? siblings[index - 1] : undefined,
    next: index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : undefined,
  };
};

export const getArticleMetaTitle = (article: LearnArticleSummary) =>
  article.metaTitle ?? `${article.title} | ${SITE_NAME}`;

export const getArticleMetaDescription = (article: LearnArticleSummary) =>
  article.metaDescription ?? article.summary;

export const getArticleCanonicalUrl = (article: LearnArticleSummary) => `${SITE_URL}${article.path}`;

/** Body text without the component marker, for Markdown output and prerendering. */
export const getArticleBodyMarkdown = (article: LearnArticle) =>
  article.content
    .split('\n')
    .filter(line => line.trim() !== COMPONENT_MARKER)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
