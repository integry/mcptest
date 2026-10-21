import React, { useMemo } from 'react';
import { getContentComponent } from '../../content/componentRegistry';
import type { LearnArticle } from '../../content/learnRegistry';
import { extractOutline } from '../../content/outline';
import { ARTICLE_PROSE_PROPS } from '../../content/prerenderedArticle';
import ArticleMarkdown from './ArticleMarkdown';
import LearnArticleLayout from './LearnArticleLayout';

/**
 * A guide rendered from its Markdown: the outline and the body both come from
 * the Markdown parser (remark), so this lives in its own chunk with it. The
 * build renders every guide with this component (src/prerender); the browser
 * loads it only for a guide it did not get prerendered.
 */
const MarkdownLearnArticle: React.FC<{ article: LearnArticle }> = ({ article }) => {
  const outline = useMemo(() => extractOutline(article.content), [article.content]);
  const Embedded = getContentComponent(article.component);
  return (
    <LearnArticleLayout
      article={article}
      outline={outline}
      prose={(
        <div {...ARTICLE_PROSE_PROPS}>
          <ArticleMarkdown
            content={article.content}
            embedded={Embedded ? <div className="reading-embed"><Embedded /></div> : undefined}
          />
        </div>
      )}
    />
  );
};

export default MarkdownLearnArticle;
