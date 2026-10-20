import React, { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getContentComponent } from '../../content/componentRegistry';
import type { LearnArticle } from '../../content/learnRegistry';
import {
  CONTENT_LEVEL_LABELS,
  getLearnArticleNeighbors,
  getRelatedLearnArticles,
  getTrack,
} from '../../content/learnRegistry';
import { extractOutline } from '../../content/outline';
import ArticleMarkdown from './ArticleMarkdown';
import { formatReviewedDate } from './articleFormatting';
import './ReadingLayout.css';

interface LearnArticlePageProps {
  article: LearnArticle;
}

const LearnArticlePage: React.FC<LearnArticlePageProps> = ({ article }) => {
  const related = getRelatedLearnArticles(article);
  const { previous, next } = getLearnArticleNeighbors(article);
  const track = getTrack(article.track);
  const outline = useMemo(() => extractOutline(article.content), [article.content]);
  const Embedded = getContentComponent(article.component);
  const articleRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hash) return;
    const scroller = articleRef.current?.closest<HTMLElement>('.main-content');
    if (scroller) scroller.scrollTop = 0;
  }, [article.slug]);

  return (
    <div className="reading-shell">
      <article className="reading-article" aria-labelledby="reading-title" ref={articleRef}>
        <nav className="reading-breadcrumb" aria-label="Breadcrumb">
          <Link to="/learn">Learn</Link>
          <span aria-hidden="true">/</span>
          {track && (
            <>
              <Link to={`/learn#track-${track.id}`}>{track.label}</Link>
              <span aria-hidden="true">/</span>
            </>
          )}
          <span aria-current="page">{article.title}</span>
        </nav>

        <header className="reading-header">
          <h1 id="reading-title">{article.title}</h1>
          <p className="reading-summary">{article.summary}</p>
          <p className="reading-meta">
            <span>{CONTENT_LEVEL_LABELS[article.level]}</span>
            <span aria-hidden="true">·</span>
            <span>{article.readingTimeMinutes} min read</span>
            <span aria-hidden="true">·</span>
            <span>
              Last reviewed <time dateTime={article.lastReviewed}>{formatReviewedDate(article.lastReviewed)}</time>
            </span>
          </p>
        </header>

        {outline.length > 0 && (
          <details className="reading-outline-inline">
            <summary>On this page</summary>
            <nav aria-label="On this page">
              <ol>
                {outline.map(heading => (
                  <li key={heading.id} className={heading.level === 3 ? 'reading-outline-sub' : undefined}>
                    <a href={`#${heading.id}`}>{heading.text}</a>
                  </li>
                ))}
              </ol>
            </nav>
          </details>
        )}

        <div className="reading-prose">
          <ArticleMarkdown
            content={article.content}
            embedded={Embedded ? <div className="reading-embed"><Embedded /></div> : undefined}
          />
        </div>

        <footer className="reading-footer">
          {(previous || next) && (
            <nav className="reading-pager" aria-label={track ? `${track.label} track` : 'Track'}>
              {previous ? (
                <Link className="reading-pager-link reading-pager-previous" to={previous.path} rel="prev">
                  <span className="reading-pager-label">Previous</span>
                  <span className="reading-pager-title">{previous.title}</span>
                </Link>
              ) : <span />}
              {next ? (
                <Link className="reading-pager-link reading-pager-next" to={next.path} rel="next">
                  <span className="reading-pager-label">Next</span>
                  <span className="reading-pager-title">{next.title}</span>
                </Link>
              ) : <span />}
            </nav>
          )}

          {related.length > 0 && (
            <section className="reading-related" aria-labelledby="related-guides-heading">
              <h2 id="related-guides-heading">Related guides</h2>
              <ul>
                {related.map(item => (
                  <li key={item.slug}>
                    <Link to={item.path}>{item.title}</Link>
                    <span className="reading-related-summary">{item.summary}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="reading-sources" aria-labelledby="article-sources-heading">
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

          <p className="reading-reviewed">
            Last reviewed <time dateTime={article.lastReviewed}>{formatReviewedDate(article.lastReviewed)}</time>
          </p>
        </footer>
      </article>

      {outline.length > 0 && (
        <aside className="reading-outline" aria-labelledby="reading-outline-title">
          <p className="reading-outline-title" id="reading-outline-title">On this page</p>
          <nav aria-labelledby="reading-outline-title">
            <ol>
              {outline.map(heading => (
                <li key={heading.id} className={heading.level === 3 ? 'reading-outline-sub' : undefined}>
                  <a href={`#${heading.id}`}>{heading.text}</a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>
      )}
    </div>
  );
};

export default LearnArticlePage;
