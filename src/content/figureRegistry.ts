/**
 * Loads article figures (src/content/figures) on demand. An article's figures
 * are fetched with its body, so ArticleMarkdown can render them without a
 * loading state; the build prerenders them the same way.
 */
import { findFigures, parseFigureSvg, type FigureSvg } from './figures';

const figureFiles = import.meta.glob('./figures/*/*.svg', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

const loaded = new Map<string, FigureSvg>();
const pending = new Map<string, Promise<FigureSvg>>();

const keyFor = (slug: string, name: string) => `./figures/${slug}/${name}.svg`;

/** The figure if it has already been loaded. */
export const getLoadedFigure = (slug: string, name: string): FigureSvg | undefined => loaded.get(keyFor(slug, name));

/** Loads one figure once; a failed load is retried on the next call. */
export const loadFigure = (slug: string, name: string): Promise<FigureSvg> => {
  const key = keyFor(slug, name);
  let request = pending.get(key);
  if (!request) {
    const file = figureFiles[key];
    request = (file ? file() : Promise.reject(new Error(`No figure file ${key}.`)))
      .then(source => {
        const figure = parseFigureSvg(source);
        loaded.set(key, figure);
        return figure;
      })
      .catch(error => {
        pending.delete(key);
        throw error;
      });
    pending.set(key, request);
  }
  return request;
};

/** Loads every figure the Markdown places. A figure that fails to load is left for ArticleFigure to report. */
export const loadFiguresFor = async (markdown: string): Promise<void> => {
  await Promise.all(findFigures(markdown).map(figure => loadFigure(figure.slug, figure.name).catch(() => undefined)));
};
