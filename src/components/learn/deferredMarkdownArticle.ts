import { createDeferredComponent } from '../../utils/deferredComponent';

/**
 * MarkdownLearnArticle with the Markdown parser and renderer (react-markdown,
 * remark, micromark) in its own chunk. A guide the build prerendered keeps
 * its static body and never loads it; client-side navigation to another
 * guide does.
 */
export const markdownLearnArticle = createDeferredComponent(() => import('./MarkdownLearnArticle'));
