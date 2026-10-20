import React, { useId, useState } from 'react';
import { useCatalog } from '../hooks/useCatalog';
import {
  CATALOG_CATEGORY_ALL,
  type CatalogServer,
  type CatalogSortOrder,
  type OAuthFilter,
} from '../types/catalog';
import CatalogServerCard from './CatalogServerCard';

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
    sortOrder,
    setSortOrder,
  } = useCatalog();
  const idPrefix = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterFieldsId = `${idPrefix}-catalog-filter-fields`;
  // Search is always visible, so it does not count; the three selects do.
  const activeFilterCount = [
    oauthFilter !== 'all',
    category !== CATALOG_CATEGORY_ALL,
    sortOrder !== 'catalog-order',
  ].filter(Boolean).length;

  const handleResetFilters = () => {
    setSearchQuery('');
    setOauthFilter('all');
    setCategory(CATALOG_CATEGORY_ALL);
    setSortOrder('catalog-order');
  };

  return (
    <div className="catalog-view">
      <div className="catalog-command-bar">
        <div className="catalog-command-copy">
          <h2 className="mb-1">Remote MCP server catalog</h2>
          <p className="text-muted mb-0">
            Inspect transport, protocol era, and authentication before you connect.
          </p>
          <div className="catalog-results-bar" aria-live="polite">
            <p className="catalog-results-count">
              Showing <strong>{filteredServers.length}</strong> of {allServers.length}{' '}
              {allServers.length === 1 ? 'server' : 'servers'}
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
          <button
            type="button"
            className="catalog-category-option"
            aria-pressed={category === CATALOG_CATEGORY_ALL}
            disabled={categoryCounts.all === 0}
            onClick={() => setCategory(CATALOG_CATEGORY_ALL)}
          >
            <span>All</span>
            <span aria-label={`${categoryCounts.all} servers`}>{categoryCounts.all}</span>
          </button>
          {categoryCounts.categories.map(({ category: catalogCategory, count }) => (
            <button
              key={catalogCategory}
              type="button"
              className="catalog-category-option"
              aria-pressed={category === catalogCategory}
              disabled={count === 0}
              onClick={() => setCategory(catalogCategory)}
            >
              <span>{catalogCategory}</span>
              <span aria-label={`${count} servers`}>{count}</span>
            </button>
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
                    onTest={onTestServer}
                    onCategorySelect={setCategory}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default CatalogView;
