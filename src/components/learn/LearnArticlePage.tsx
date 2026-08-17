import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import type { LearnArticle } from '../../content/learnRegistry';
import { getRelatedLearnArticles } from '../../content/learnRegistry';
import { formatReviewedDate } from './articleFormatting';

interface LearnArticlePageProps {
  article: LearnArticle;
}

const LearnArticlePage: React.FC<LearnArticlePageProps> = ({ article }) => {
  const related = getRelatedLearnArticles(article);

  return (
    <article className="learn-page learn-article">
      <nav className="learn-breadcrumb" aria-label="Breadcrumb">
        <Link to="/learn">Learn</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{article.title}</span>
      </nav>

      <header className="learn-article-header">
        <p className="learn-kicker">{article.category}</p>
        <h1>{article.title}</h1>
        <p className="learn-article-summary">{article.summary}</p>
        <dl className="learn-article-meta">
          <div>
            <dt>Reading time</dt>
            <dd>{article.readingTimeMinutes} minutes</dd>
          </div>
          <div>
            <dt>Last reviewed</dt>
            <dd><time dateTime={article.lastReviewed}>{formatReviewedDate(article.lastReviewed)}</time></dd>
          </div>
        </dl>
      </header>

      <div className="learn-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          components={{
            a: ({ href = '', children, ...props }) => {
              if (href.startsWith('/')) {
                return <Link to={href}>{children}</Link>;
              }
              return (
                <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                  {children}
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              );
            },
          }}
        >
          {article.content}
        </ReactMarkdown>
      </div>

      <footer className="learn-article-footer">
        <section aria-labelledby="article-sources-heading">
          <h2 id="article-sources-heading">Sources</h2>
          <ul>
            {article.sourceLinks.map(source => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.title}
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="related-guides-heading">
          <h2 id="related-guides-heading">Related guides</h2>
          <ul>
            {related.map(item => (
              <li key={item.slug}>
                <Link to={`/learn/${item.slug}`}>{item.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      </footer>
    </article>
  );
};

export default LearnArticlePage;
