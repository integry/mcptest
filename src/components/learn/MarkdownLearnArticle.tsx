import React, { useEffect, useMemo, useState } from 'react';
import { getContentComponent } from '../../content/componentRegistry';
import type { LearnArticle, LearnArticleEntry } from '../../content/learnRegistry';
import { getLoadedLearnArticleBody, loadLearnArticleBody } from '../../content/learnRegistry';
import { extractOutline } from '../../content/outline';
import { ARTICLE_PROSE_PROPS } from '../../content/prerenderedArticle';
import ArticleMarkdown from './ArticleMarkdown';
import LearnArticleLayout from './LearnArticleLayout';

/**
 * The article's Markdown body: the one it carries, the one already loaded
 * (main.tsx loads it before mounting a guide route), or undefined while it
 * is fetched after client-side navigation.
 */
const useArticleBody = (article: LearnArticleEntry | LearnArticle) => {
  const content = 'content' in article ? article.content : getLoadedLearnArticleBody(article.slug);
  const [, setLoadedSlug] = useState<string>();
  const [failedSlug, setFailedSlug] = useState<string>();
  const failed = content === undefined && failedSlug === article.slug;

  useEffect(() => {
    if (content !== undefined || failed) return undefined;
    let active = true;
    loadLearnArticleBody(article).then(
      () => active && setLoadedSlug(article.slug),
      () => active && setFailedSlug(article.slug)
    );
    return () => {
      active = false;
    };
  }, [article, content, failed]);

  return { content, failed, retry: () => setFailedSlug(undefined) };
};

/**
 * A guide rendered from its Markdown: the body comes from the Markdown parser
 * (remark), so this lives in its own chunk with it. The build renders every
 * guide with this component (src/prerender); the browser loads it only for a
 * guide it did not get prerendered.
 */
const MarkdownLearnArticle: React.FC<{ article: LearnArticleEntry | LearnArticle }> = ({ article }) => {
  const { content, failed, retry } = useArticleBody(article);
  const bodyReady = content !== undefined;
  // Registry entries carry the outline precomputed from their body, so it is
  // in place while the body loads; an article with its own body derives it.
  const outline = useMemo(
    () => ('content' in article ? extractOutline(article.content) : article.outline),
    [article]
  );
  const Embedded = getContentComponent(article.component);
  return (
    <LearnArticleLayout
      article={article}
      outline={outline}
      bodyReady={bodyReady}
      prose={(
        <div {...ARTICLE_PROSE_PROPS}>
          {bodyReady ? (
            <ArticleMarkdown
              content={content}
              embedded={Embedded ? <div className="reading-embed"><Embedded /></div> : undefined}
            />
          ) : failed ? (
            <div className="reading-body-status" role="alert">
              <p>This guide could not be loaded.</p>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={retry}>Try again</button>
            </div>
          ) : (
            <div className="reading-body-status" role="status" aria-live="polite">
              <span className="spinner-border spinner-border-sm" aria-hidden="true"></span>
              <span>Loading guide…</span>
            </div>
          )}
        </div>
      )}
    />
  );
};

export default MarkdownLearnArticle;
