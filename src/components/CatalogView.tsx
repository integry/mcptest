import React, { useId } from 'react';
import { useCatalog } from '../hooks/useCatalog';
import {
  CATALOG_CATEGORY_ALL,
  type CatalogServer,
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
  { value: 'api-key', label: 'API key' },
];

const CatalogView: React.FC<CatalogViewProps> = ({ onTestServer }) => {
  const {
    allServers,
    filteredServers,
    categories,
    searchQuery,
    setSearchQuery,
    oauthFilter,
    setOauthFilter,
    category,
    setCategory,
  } = useCatalog();
  const idPrefix = useId();

  const handleResetFilters = () => {
    setSearchQuery('');
    setOauthFilter('all');
    setCategory(CATALOG_CATEGORY_ALL);
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
              <option value={CATALOG_CATEGORY_ALL}>Category: All</option>
              {categories.map((catalogCategory) => (
                <option key={catalogCategory} value={catalogCategory}>
                  Category: {catalogCategory}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

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
          <button type="button" className="btn btn-outline-primary" onClick={handleResetFilters}>
            Clear all filters
          </button>
        </section>
      ) : (
        <div className="row g-3">
          {filteredServers.map((server) => (
            <div key={server.id} className="col-12 col-md-6 col-xl-4">
              <CatalogServerCard server={server} onTest={onTestServer} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CatalogView;
