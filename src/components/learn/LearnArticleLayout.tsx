import React, { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { LearnArticleSummary } from '../../content/learnRegistry';
import {
  CONTENT_LEVEL_LABELS,
  getLearnArticleNeighbors,
  getRelatedLearnArticles,
  getTrack,
} from '../../content/learnRegistry';
import type { OutlineHeading } from '../../content/outline';
import { consumeStaticPageEvent, trackEvent, trackGuideLinkClick } from '../../utils/analytics';
import { formatReviewedDate } from './articleFormatting';
import './ReadingLayout.css';

interface LearnArticleLayoutProps {
  article: LearnArticleSummary;
  /** The h2 and h3 entries of the "On this page" outline. */
  outline: readonly OutlineHeading[];
  /** The `.reading-prose` element holding the article body. */
  prose: React.ReactNode;
  /** False while the body is still loading; a `#section` scrolls once it is in place. */
  bodyReady?: boolean;
}

/**
 * A guide page around its body: breadcrumb, header, outline, pager, related
 * guides and sources. LearnArticlePage supplies the body, either the
 * prerendered HTML or ArticleMarkdown (MarkdownLearnArticle).
 */
const LearnArticleLayout: React.FC<LearnArticleLayoutProps> = ({ article, outline, prose, bodyReady = true }) => {
  const related = getRelatedLearnArticles(article);
  const { previous, next } = getLearnArticleNeighbors(article);
  const track = getTrack(article.track);
  const articleRef = useRef<HTMLElement>(null);
  const location = useLocation();

  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hash) return;
    const scroller = articleRef.current?.closest<HTMLElement>('.main-content');
    if (scroller) scroller.scrollTop = 0;
  }, [article.slug]);

  // Client-side navigation to `#section` (guide search results) does not
  // scroll by itself; every navigation has a new key, so repeats scroll too.
  // A body that arrives after navigation scrolls to its section once rendered.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (!id) return;
    let target: HTMLElement | null = null;
    try {
      target = document.getElementById(decodeURIComponent(id));
    } catch {
      return;
    }
    target?.scrollIntoView?.({ block: 'start' });
  }, [article.slug, location.hash, location.key, bodyReady]);

  useEffect(() => {
    // The static page already reported the view it was loaded with.
    if (consumeStaticPageEvent(`guide_view:${article.slug}`)) return;
    trackEvent('guide_view', { slug: article.slug, track: article.track });
  }, [article.slug, article.track]);

  return (
    <div className="reading-shell">
      <article
        className="reading-article"
        aria-labelledby="reading-title"
        data-article-slug={article.slug}
        ref={articleRef}
        onClick={trackGuideLinkClick(article.slug)}
      >
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

        {prose}

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

export default LearnArticleLayout;
