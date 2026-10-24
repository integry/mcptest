import React, { useId, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useCatalog } from '../hooks/useCatalog';
import { trackEvent } from '../utils/analytics';
import {
  CATALOG_CATEGORY_ALL,
  type CatalogServer,
  type CatalogSortOrder,
  type OAuthFilter,
} from '../types/catalog';
import {
  CATALOG_PATH,
  getCatalogCategoryIntro,
  getCatalogCategoryPath,
  getCatalogCategorySlugFromPath,
  summarizeCatalogCategory,
} from '../utils/catalogCategories';
import CatalogServerCard from './CatalogServerCard';
import { CatalogCategoryFooter, CatalogCategorySummaryList } from './CatalogCategoryDetails';
import './CatalogCategory.css';

interface CatalogViewProps {
  onTestServer: (server: CatalogServer) => void;
}

const OAUTH_FILTER_OPTIONS: Array<{ value: OAuthFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'no-auth', label: 'No auth' },
  { value: 'oauth', label: 'OAuth' },
  { value: 'bearer-token', label: 'Bearer' },
  { value: 'api-token', label: 'API token' },
  { value: 'api-key', label: 'API key' },
];

const SORT_OPTIONS: Array<{ value: CatalogSortOrder; label: string }> = [
  { value: 'catalog-order', label: 'Catalog order' },
  { value: 'name', label: 'Name' },
  { value: 'recently-tested', label: 'Recently tested' },
  { value: 'browser-ready', label: 'Browser ready' },
];

const CatalogView: React.FC<CatalogViewProps> = ({ onTestServer }) => {
  const {
    allServers,
    filteredServers,
    categoryCounts,
    searchQuery,
    setSearchQuery,
    oauthFilter,
    setOauthFilter,
    category,
    setCategory,
    categoryNotFound,
    filterSearch = '',
    sortOrder,
    setSortOrder,
  } = useCatalog();
  const location = useLocation();
  const idPrefix = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterFieldsId = `${idPrefix}-catalog-filter-fields`;
  // On /catalog/<slug> the category is the page itself, not a filter.
  const onCategoryPage = getCatalogCategorySlugFromPath(location.pathname) !== null;
  const categorySummary = useMemo(
    () => (onCategoryPage && category !== CATALOG_CATEGORY_ALL
      ? summarizeCatalogCategory(allServers, category)
      : undefined),
    [allServers, category, onCategoryPage]
  );
  // Search is always visible, so it does not count; the three selects do.
  const activeFilterCount = [
    oauthFilter !== 'all',
    category !== CATALOG_CATEGORY_ALL && !onCategoryPage,
    sortOrder !== 'catalog-order',
  ].filter(Boolean).length;

  const handleResetFilters = () => {
    setSearchQuery('');
    setOauthFilter('all');
    if (!onCategoryPage) setCategory(CATALOG_CATEGORY_ALL);
    setSortOrder('catalog-order');
  };

  if (categoryNotFound) {
    return (
      <div className="catalog-view">
        <section className="catalog-empty-state" aria-labelledby={`${idPrefix}-catalog-missing-title`}>
          <h1 id={`${idPrefix}-catalog-missing-title`} className="h3">Catalog category not found</h1>
          <p>This category does not exist, or its servers have moved to another category.</p>
          <Link className="btn btn-outline-primary" to={CATALOG_PATH}>Browse every category</Link>
        </section>
      </div>
    );
  }

  const totalInScope = categorySummary?.count ?? allServers.length;

  return (
    <div className="catalog-view">
      <div className="catalog-command-bar">
        <div className="catalog-command-copy">
          {categorySummary ? (
            <>
              <nav aria-label="Breadcrumb" className="catalog-category-breadcrumb">
                <Link to={{ pathname: CATALOG_PATH, search: filterSearch }}>Server Catalog</Link>
                <span aria-hidden="true">/</span>
                <span aria-current="page">{categorySummary.category}</span>
              </nav>
              <h1 className="mb-1">{categorySummary.category} MCP servers</h1>
              <p className="catalog-category-intro">
                {getCatalogCategoryIntro(categorySummary).join(' ')}
              </p>
              <CatalogCategorySummaryList summary={categorySummary} />
            </>
          ) : (
            <>
              <h2 className="mb-1">Remote MCP server catalog</h2>
              <p className="text-muted mb-0">
                Inspect transport, protocol era, and authentication before you connect.
              </p>
            </>
          )}
          <div className="catalog-results-bar" aria-live="polite">
            <p className="catalog-results-count">
              Showing <strong>{filteredServers.length}</strong> of {totalInScope}{' '}
              {categorySummary ? `${categorySummary.category} ` : ''}
              {totalInScope === 1 ? 'server' : 'servers'}
            </p>
          </div>
        </div>

        <div className="catalog-filters">
          <div className="catalog-search-field">
            <i className="bi bi-search catalog-search-icon" aria-hidden="true" />
            <input
              id={`${idPrefix}-catalog-search`}
              type="search"
              className="form-control"
              aria-label="Search servers"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by name, URL, tag, or description"
            />
          </div>

          <button
            type="button"
            className="catalog-filters-toggle"
            aria-expanded={filtersOpen}
            aria-controls={filterFieldsId}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <i className="bi bi-sliders" aria-hidden="true" />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="catalog-filters-count" aria-label={`${activeFilterCount} active`}>
                {activeFilterCount}
              </span>
            )}
            <i className="bi bi-chevron-down catalog-filters-chevron" aria-hidden="true" />
          </button>

          <div
            id={filterFieldsId}
            className={`catalog-filter-fields${filtersOpen ? ' is-open' : ''}`}
            data-active-filters={activeFilterCount}
          >
          <div className="catalog-auth-field">
            <label className="visually-hidden" htmlFor={`${idPrefix}-catalog-auth`}>
              Authentication
            </label>
            <select
              id={`${idPrefix}-catalog-auth`}
              className="form-select"
              value={oauthFilter}
              onChange={(event) => setOauthFilter(event.target.value as OAuthFilter)}
            >
              {OAUTH_FILTER_OPTIONS.map((option) => {
                return (
                  <option key={option.value} value={option.value}>
                    Authentication: {option.label}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="catalog-sort-field">
            <label className="visually-hidden" htmlFor={`${idPrefix}-catalog-sort`}>
              Sort
            </label>
            <select
              id={`${idPrefix}-catalog-sort`}
              className="form-select"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as CatalogSortOrder)}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  Sort: {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="catalog-category-field">
            <label className="visually-hidden" htmlFor={`${idPrefix}-catalog-category`}>
              Category
            </label>
            <select
              id={`${idPrefix}-catalog-category`}
              className="form-select"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value={CATALOG_CATEGORY_ALL} disabled={categoryCounts.all === 0}>
                Category: All ({categoryCounts.all})
              </option>
              {categoryCounts.categories.map(({ category: catalogCategory, count }) => (
                <option key={catalogCategory} value={catalogCategory} disabled={count === 0}>
                  Category: {catalogCategory} ({count})
                </option>
              ))}
            </select>
          </div>
          </div>
        </div>
      </div>

      <div className="catalog-content-layout">
        <nav className="catalog-category-rail" aria-label="Catalog categories">
          <p className="catalog-category-heading">Categories</p>
          <CategoryRailLink
            label="All"
            count={categoryCounts.all}
            to={{ pathname: CATALOG_PATH, search: filterSearch }}
            current={category === CATALOG_CATEGORY_ALL}
            onSelect={() => setCategory(CATALOG_CATEGORY_ALL)}
          />
          {categoryCounts.categories.map(({ category: catalogCategory, count }) => (
            <CategoryRailLink
              key={catalogCategory}
              label={catalogCategory}
              count={count}
              to={{ pathname: getCatalogCategoryPath(catalogCategory), search: filterSearch }}
              current={category === catalogCategory}
              onSelect={() => setCategory(catalogCategory)}
            />
          ))}
        </nav>

        <div className="catalog-results-region">
          {filteredServers.length === 0 ? (
            <section
              className="catalog-empty-state"
              aria-labelledby={`${idPrefix}-catalog-empty-title`}
            >
              <div className="catalog-empty-state-icon" aria-hidden="true">
                <i className="bi bi-search" />
              </div>
              <h3 id={`${idPrefix}-catalog-empty-title`}>
                No servers found matching your criteria
              </h3>
              <p>
                Try adjusting your search or filters, or clear them to browse the full catalog.
              </p>
              <button
                type="button"
                className="btn btn-outline-primary"
                onClick={handleResetFilters}
              >
                Clear all filters
              </button>
            </section>
          ) : (
            <ul className="catalog-server-list" aria-label="Catalog servers">
              {filteredServers.map((server) => (
                <li key={server.id} className="catalog-server-list-item">
                  <CatalogServerCard
                    server={server}
                    onTest={(selected) => {
                      trackEvent('catalog_open_server', { server_id: selected.id, surface: 'list' });
                      onTestServer(selected);
                    }}
                    categorySearch={filterSearch}
                  />
                </li>
              ))}
            </ul>
          )}
          {categorySummary && <CatalogCategoryFooter summary={categorySummary} />}
        </div>
      </div>
    </div>
  );
};

interface CategoryRailLinkProps {
  label: string;
  count: number;
  to: { pathname: string; search: string };
  current: boolean;
  onSelect: () => void;
}

/** A category in the rail is a link to its page; a category the search empties is inert. */
const CategoryRailLink: React.FC<CategoryRailLinkProps> = ({ label, count, to, current, onSelect }) => {
  const content = (
    <>
      <span>{label}</span>
      <span aria-label={`${count} servers`}>{count}</span>
    </>
  );
  if (count === 0 && !current) {
    return <span className="catalog-category-option" aria-disabled="true">{content}</span>;
  }
  return (
    <Link
      className="catalog-category-option"
      to={to}
      aria-current={current ? 'page' : undefined}
      onClick={(event) => {
        // setCategory navigates and records the filter analytics event.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        onSelect();
      }}
    >
      {content}
    </Link>
  );
};

export default CatalogView;
