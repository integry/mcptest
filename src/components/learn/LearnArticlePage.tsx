import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getContentComponent } from '../../content/componentRegistry';
import type { LearnArticle, LearnArticleEntry } from '../../content/learnRegistry';
import {
  CONTENT_LEVEL_LABELS,
  getLearnArticleNeighbors,
  getLoadedLearnArticleBody,
  getRelatedLearnArticles,
  getTrack,
  loadLearnArticleBody,
} from '../../content/learnRegistry';
import { extractOutline } from '../../content/outline';
import { trackEvent, trackGuideLinkClick } from '../../utils/analytics';
import ArticleMarkdown from './ArticleMarkdown';
import { formatReviewedDate } from './articleFormatting';
import './ReadingLayout.css';

interface LearnArticlePageProps {
  /** A registry entry, whose body is loaded on demand, or an article that carries its body. */
  article: LearnArticleEntry | LearnArticle;
}

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

const LearnArticlePage: React.FC<LearnArticlePageProps> = ({ article }) => {
  const related = getRelatedLearnArticles(article);
  const { previous, next } = getLearnArticleNeighbors(article);
  const track = getTrack(article.track);
  const { content, failed, retry } = useArticleBody(article);
  const bodyReady = content !== undefined;
  // Registry entries carry the outline precomputed from their body, so it is
  // in place while the body loads; an article with its own body derives it.
  const outline = useMemo(
    () => ('content' in article ? extractOutline(article.content) : article.outline),
    [article]
  );
  const Embedded = getContentComponent(article.component);
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

  useEffect(() => trackEvent('guide_view', { slug: article.slug, track: article.track }), [article.slug, article.track]);

  return (
    <div className="reading-shell">
      <article className="reading-article" aria-labelledby="reading-title" ref={articleRef} onClick={trackGuideLinkClick(article.slug)}>
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
