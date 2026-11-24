import React, { Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LearnArticle, LearnArticleEntry } from '../../content/learnRegistry';
import { ARTICLE_PROSE_PROPS, getPrerenderedArticle } from '../../content/prerenderedArticle';
import { handleCodeCopyClick } from '../../utils/codeCopy';
import { internalLinkPath } from '../../utils/internalLink';
import { ViewFallback } from '../../views/deferredViews';
import LearnArticleLayout from './LearnArticleLayout';
import { markdownLearnArticle } from './deferredMarkdownArticle';

interface LearnArticlePageProps {
  /** A registry entry, whose body is loaded on demand, or an article that carries its body. */
  article: LearnArticleEntry | LearnArticle;
}

/**
 * A guide page. When the app mounted over the page the build prerendered for
 * this guide, it keeps that body and outline as they are (issue #405), so
 * neither the Markdown parser, highlight.js nor the guide's body chunk is
 * downloaded. Otherwise, and for guides with an embedded component,
 * MarkdownLearnArticle renders it, loading the body on demand.
 */
const LearnArticlePage: React.FC<LearnArticlePageProps> = ({ article }) => {
  const navigate = useNavigate();
  const prerendered = article.component ? null : getPrerenderedArticle(article.slug);

  if (!prerendered) {
    return (
      <Suspense fallback={<ViewFallback label="Loading the guide" />}>
        <markdownLearnArticle.Component article={article} />
      </Suspense>
    );
  }

  // The prerendered body is plain HTML: wire its copy buttons, and keep its
  // internal links in the app the way ArticleMarkdown's <Link>s do.
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (handleCodeCopyClick(event)) return;
    const path = internalLinkPath(event);
    if (!path) return;
    event.preventDefault();
    navigate(path);
  };

  return (
    <LearnArticleLayout
      article={article}
      outline={prerendered.outline}
      prose={<div {...ARTICLE_PROSE_PROPS} onClick={handleClick} dangerouslySetInnerHTML={{ __html: prerendered.html }} />}
    />
  );
};

export default LearnArticlePage;
