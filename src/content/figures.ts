/**
 * Article figures: hand-authored SVG diagrams in `src/content/figures/<article-slug>/<name>.svg`,
 * placed in an article with a standalone Markdown image line:
 *
 *   ![Alt text](../figures/<article-slug>/<name>.svg "Caption")
 *
 * The SVG is inlined into the page, so it is styled by the site's tokens
 * through the `fig-*` classes in ReadingLayout.css and follows the light and
 * dark themes. This module has no browser, React or Node dependencies; the
 * app, the tests and the build script share it. See docs/article-figures.md.
 */

export interface FigureReference {
  /** Article slug that owns the figure; also its directory name. */
  slug: string;
  /** File name without `.svg`. */
  name: string;
  alt: string;
  caption?: string;
}

export interface FigureSvg {
  /** Value of the root `viewBox`, always `0 0 <width> <height>`. */
  viewBox: string;
  width: number;
  height: number;
  /** Markup between the root `<svg>` tags. */
  inner: string;
}

/** Classes a figure may use. ReadingLayout.css defines every one of them. */
export const FIGURE_CLASSES = [
  'fig-box',
  'fig-box-accent',
  'fig-line',
  'fig-line-accent',
  'fig-line-danger',
  'fig-dashed',
  'fig-guide',
  'fig-rule',
  'fig-head',
  'fig-head-accent',
  'fig-head-danger',
  'fig-dot',
  'fig-dot-accent',
  'fig-label',
  'fig-title',
  'fig-mono',
  'fig-muted',
  'fig-accent-text',
  'fig-danger-text',
] as const;

/** Widest figure the reading column shows without scaling it down. */
export const FIGURE_MAX_WIDTH = 720;

const SRC_PATTERN = /^\.\.\/figures\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*)\.svg$/;
const LINE_PATTERN = /^!\[([^\]]+)\]\((\S+?)(?:\s+"([^"]+)")?\)$/;
const FENCE_PATTERN = /^(`{3,}|~{3,})/;

/** The figure a Markdown image `src` points to, or null for any other URL. */
export const parseFigureSrc = (src: string): Pick<FigureReference, 'slug' | 'name'> | null => {
  const match = SRC_PATTERN.exec(src);
  return match ? { slug: match[1], name: match[2] } : null;
};

/** The figure a whole Markdown line places, or null when the line is not a figure. */
export const parseFigureLine = (line: string): FigureReference | null => {
  const match = LINE_PATTERN.exec(line);
  const target = match && parseFigureSrc(match[2]);
  if (!match || !target) return null;
  return { ...target, alt: match[1].trim(), ...(match[3] ? { caption: match[3].trim() } : {}) };
};

interface BodyLine {
  text: string;
  index: number;
  inFence: boolean;
}

const bodyLines = (markdown: string): BodyLine[] => {
  let fence: string | null = null;
  return markdown.replace(/\r\n/g, '\n').split('\n').map((text, index) => {
    const marker = FENCE_PATTERN.exec(text)?.[1];
    if (fence) {
      const closes = marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length
        && text.trim() === marker;
      if (closes) fence = null;
      return { text, index, inFence: true };
    }
    if (marker) {
      fence = marker;
      return { text, index, inFence: true };
    }
    return { text, index, inFence: false };
  });
};

/** Every figure the Markdown places, in order. Lines inside code fences are ignored. */
export const findFigures = (markdown: string): FigureReference[] => bodyLines(markdown)
  .filter(line => !line.inFence)
  .map(line => parseFigureLine(line.text))
  .filter((figure): figure is FigureReference => figure !== null);

/**
 * Problems with how an article's Markdown uses images. Articles carry no
 * other images, so every `![...](...)` must be a figure line of its own,
 * owned by this article, with blank lines around it.
 */
export const validateFigureUsage = (markdown: string, slug: string): string[] => {
  const errors: string[] = [];
  const lines = bodyLines(markdown);
  const seen = new Set<string>();
  lines.forEach((line, position) => {
    if (line.inFence || !/!\[[^\]]*\]\(/.test(line.text.replace(/`[^`]*`/g, ''))) return;
    const where = `line ${line.index + 1}`;
    const figure = parseFigureLine(line.text);
    if (!figure) {
      errors.push(`${where}: an image must be a figure on its own line, ![alt](../figures/${slug}/<name>.svg "Caption")`);
      return;
    }
    if (figure.slug !== slug) errors.push(`${where}: figure belongs to ${figure.slug}, not ${slug}`);
    if (figure.alt.length < 20) errors.push(`${where}: figure alt text must say what the figure shows`);
    if (!figure.caption) errors.push(`${where}: figure needs a caption`);
    if (seen.has(figure.name)) errors.push(`${where}: figure ${figure.name} is placed twice`);
    seen.add(figure.name);
    const before = lines[position - 1];
    const after = lines[position + 1];
    if ((before && before.text.trim()) || (after && after.text.trim())) {
      errors.push(`${where}: a figure needs a blank line before and after it`);
    }
  });
  return errors;
};

const ROOT_PATTERN = /^<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/;
const FORBIDDEN_MARKUP: ReadonlyArray<[RegExp, string]> = [
  [/<(script|style|foreignObject|image|use|a|iframe|animate\w*|set)\b/i, 'only static shapes and text are allowed'],
  [/<!DOCTYPE|<!ENTITY|<\?/i, 'no doctype, entities or processing instructions'],
  [/\son[a-z]+\s*=/i, 'no event handler attributes'],
  [/\s(?:style|id|href|xlink:href|font-family|font-size|color|opacity|filter|mask|clip-path)\s*=/i,
    'style, id, href and font or colour attributes are not allowed; use the fig-* classes'],
  [/#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|url)\(/i, 'no colour values or url() references; colours come from the fig-* classes'],
];

/** Problems with a figure's SVG source; empty when it follows the contract. */
export const validateFigureSvg = (source: string): string[] => {
  const svg = source.trim();
  const root = ROOT_PATTERN.exec(svg);
  if (!root) return ['the file must be a single <svg> element'];
  const errors: string[] = [];
  const [, attributes, inner] = root;
  if (!/\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(attributes)) errors.push('the root needs xmlns="http://www.w3.org/2000/svg"');
  const viewBox = /\sviewBox="0 0 (\d+) (\d+)"/.exec(attributes);
  if (!viewBox) {
    errors.push('the root needs viewBox="0 0 <width> <height>" in whole numbers');
  } else if (Number(viewBox[1]) > FIGURE_MAX_WIDTH) {
    errors.push(`the viewBox may be at most ${FIGURE_MAX_WIDTH} wide`);
  }
  if (/\s(?:width|height|class)=/.test(attributes)) errors.push('the root takes only xmlns and viewBox');
  const body = attributes.replace(/\sxmlns="[^"]*"/, '') + inner;
  for (const [pattern, message] of FORBIDDEN_MARKUP) {
    if (pattern.test(body)) errors.push(message);
  }
  for (const [, name, value] of body.matchAll(/\s(fill|stroke)="([^"]*)"/g)) {
    if (value !== 'none') errors.push(`${name}="${value}" is not allowed; use a fig-* class (only "none" may be set inline)`);
  }
  const known = new Set<string>(FIGURE_CLASSES);
  for (const [, classes] of body.matchAll(/\sclass="([^"]*)"/g)) {
    for (const name of classes.split(/\s+/).filter(Boolean)) {
      if (!known.has(name)) errors.push(`unknown class ${name}`);
    }
  }
  if (!/<text\b/.test(inner)) errors.push('a figure needs text labels');
  for (const [, attrs] of inner.matchAll(/<(?:text|tspan)\b([^>]*)>/g)) {
    if (!/\sclass="[^"]+"/.test(` ${attrs}`)) errors.push('every <text> needs a fig-* class');
  }
  for (const [, attrs] of inner.matchAll(/<(?:rect|path|line|circle|ellipse|polygon|polyline)\b([^>]*)>/g)) {
    if (!/\sclass="[^"]+"/.test(` ${attrs}`)) errors.push('every shape needs a fig-* class');
  }
  return [...new Set(errors)];
};

/** Splits a valid figure into its viewBox and inner markup; throws on an invalid one. */
export const parseFigureSvg = (source: string): FigureSvg => {
  const errors = validateFigureSvg(source);
  if (errors.length) throw new Error(`Invalid figure SVG: ${errors.join('; ')}`);
  const [, attributes, inner] = ROOT_PATTERN.exec(source.trim())!;
  const [, width, height] = /\sviewBox="0 0 (\d+) (\d+)"/.exec(attributes)!;
  return { viewBox: `0 0 ${width} ${height}`, width: Number(width), height: Number(height), inner: inner.trim() };
};

const escapeAttribute = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

/** The `<svg>` element ArticleFigure renders, for the static renderer in the build script. */
export const renderFigureSvgHtml = (svg: FigureSvg, alt: string): string => (
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${svg.viewBox}" width="${svg.width}" height="${svg.height}" role="img" aria-label="${escapeAttribute(alt)}">${svg.inner}</svg>`
);

/**
 * The Markdown with each figure line replaced by its description, for the
 * raw `.md` export and other text-only outputs where the SVG path means nothing.
 */
export const describeFiguresAsText = (markdown: string): string => bodyLines(markdown)
  .map(line => {
    const figure = line.inFence ? null : parseFigureLine(line.text);
    if (!figure) return line.text;
    return `_Figure: ${figure.alt}${figure.caption ? ` ${figure.caption}` : ''}_`;
  })
  .join('\n');
