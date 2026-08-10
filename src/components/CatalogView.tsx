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
            <label className="form-label" htmlFor={`${idPrefix}-catalog-search`}>
              Search servers
            </label>
            <input
              id={`${idPrefix}-catalog-search`}
              type="search"
              className="form-control"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by name, URL, tag, or description"
            />
          </div>

          <div className="catalog-auth-field">
            <label className="form-label" htmlFor={`${idPrefix}-catalog-auth`}>
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
                    {option.label}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="catalog-category-field">
            <label className="form-label" htmlFor={`${idPrefix}-catalog-category`}>
              Category
            </label>
            <select
              id={`${idPrefix}-catalog-category`}
              className="form-select"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value={CATALOG_CATEGORY_ALL}>All categories</option>
              {categories.map((catalogCategory) => (
                <option key={catalogCategory} value={catalogCategory}>
                  {catalogCategory}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {filteredServers.length === 0 ? (
        <div className="alert alert-info d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
          <div>
            <h3 className="h5 mb-1">No catalog servers match these filters.</h3>
            <p className="mb-0">
              Clear the search, authentication, and category filters to show the full catalog.
            </p>
          </div>
          <button type="button" className="btn btn-outline-primary" onClick={handleResetFilters}>
            Reset filters
          </button>
        </div>
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
