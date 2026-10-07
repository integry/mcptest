import React from 'react';
import { Link } from 'react-router-dom';
import {
  LEARN_ARTICLES,
  LEARN_INDEX_METADATA,
  getRelatedLearnArticles,
} from '../../content/learnRegistry';
import { formatReviewedDate } from './articleFormatting';

const LearnIndex: React.FC = () => (
  <div className="learn-page learn-index">
    <header className="learn-hero">
      <p className="learn-kicker">Guides</p>
      <h1>{LEARN_INDEX_METADATA.title}</h1>
      <p>{LEARN_INDEX_METADATA.summary}</p>
    </header>

    <div className="learn-grid" role="list">
      {LEARN_ARTICLES.map(article => {
        const related = getRelatedLearnArticles(article);
        return (
          <article className="learn-card" key={article.slug} role="listitem">
            <div className="learn-card-meta">
              <span>{article.category}</span>
              <span>{article.readingTimeMinutes} min read</span>
            </div>
            <h2>
              <Link to={`/learn/${article.slug}`}>{article.title}</Link>
            </h2>
            <p>{article.summary}</p>
            <p className="learn-reviewed">
              Reviewed <time dateTime={article.lastReviewed}>{formatReviewedDate(article.lastReviewed)}</time>
            </p>
            {related.length > 0 && (
              <div className="learn-card-related" aria-label={`Related to ${article.title}`}>
                <span>Related:</span>{' '}
                {related.map((item, index) => (
                  <React.Fragment key={item.slug}>
                    {index > 0 && <span aria-hidden="true"> · </span>}
                    <Link to={`/learn/${item.slug}`}>{item.title}</Link>
                  </React.Fragment>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  </div>
);

export default LearnIndex;
