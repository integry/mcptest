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

/** Allocates unique ids for headings in document order. */
export const createHeadingIdAllocator = () => {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = slugifyHeading(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
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
    const text = headingPlainText(heading[2]);
    const id = allocate(text);
    if (level === 2 || level === 3) {
      headings.push({ level, text, id });
    }
  }

  return headings;
};
