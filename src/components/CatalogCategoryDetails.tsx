import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getCategoryGuideSlugs } from '../content/categoryGuides';
import { getLearnArticle, type LearnArticle } from '../content/learnRegistry';
import { getCatalogServers } from '../utils/catalogUtils';
import {
  CATALOG_PATH,
  getCatalogCategoryNames,
  getCatalogCategoryNeighbors,
  getCatalogCategoryPath,
  type CatalogCategorySummary,
} from '../utils/catalogCategories';

interface CategoryDetailsProps {
  summary: CatalogCategorySummary;
}

const countList = (items: CatalogCategorySummary['auth'] | CatalogCategorySummary['transport']) =>
  items.map(({ value, label, count }) => (
    <span key={value} className="catalog-category-count">
      {label} <strong>{count}</strong>
    </span>
  ));

/** Authentication, transport, browser and inventory counts for the category's servers. */
export const CatalogCategorySummaryList: React.FC<CategoryDetailsProps> = ({ summary }) => (
  <dl className="catalog-category-summary" aria-label={`${summary.category} server summary`}>
    <div>
      <dt>Authentication</dt>
      <dd>{countList(summary.auth)}</dd>
    </div>
    <div>
      <dt>Transport</dt>
      <dd>{countList(summary.transport)}</dd>
    </div>
    <div>
      <dt>Browser ready</dt>
      <dd><strong>{summary.browserReady}</strong> of {summary.count}</dd>
    </div>
    <div>
      <dt>Tool inventories</dt>
      <dd>
        <strong>{summary.inventories}</strong> of {summary.count}
        {summary.inventories > 0 ? ` · ${summary.toolCount} tools observed` : ''}
      </dd>
    </div>
  </dl>
);

/** Recommended guides and the neighboring categories, below the server rows. */
export const CatalogCategoryFooter: React.FC<CategoryDetailsProps> = ({ summary }) => {
  const guides = getCategoryGuideSlugs(summary.category)
    .map(getLearnArticle)
    .filter((article): article is LearnArticle => Boolean(article));
  const categories = useMemo(() => getCatalogCategoryNames(getCatalogServers()), []);
  const { previous, next } = getCatalogCategoryNeighbors(categories, summary.category);
  const headingId = `catalog-category-guides-${summary.slug}`;

  return (
    <div className="catalog-category-footer">
      {guides.length > 0 && (
        <section className="catalog-category-guides" aria-labelledby={headingId}>
          <h2 id={headingId}>Guides for {summary.category} servers</h2>
          <ul>
            {guides.map((article) => (
              <li key={article.slug}>
                <Link to={article.path}>{article.title}</Link>
                <p>{article.summary}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <nav className="catalog-category-neighbors" aria-label="Neighboring categories">
        {previous && (
          <Link to={getCatalogCategoryPath(previous)} rel="prev">
            <i className="bi bi-arrow-left" aria-hidden="true" /> {previous}
          </Link>
        )}
        <Link to={CATALOG_PATH}>All categories</Link>
        {next && (
          <Link to={getCatalogCategoryPath(next)} rel="next">
            {next} <i className="bi bi-arrow-right" aria-hidden="true" />
          </Link>
        )}
      </nav>
    </div>
  );
};
