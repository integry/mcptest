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
          <span className="interface-eyebrow">Live endpoint index</span>
          <h2 className="mb-1">Remote MCP server catalog</h2>
          <p className="text-muted mb-0">
            Inspect transport, protocol era, and authentication before you connect.
          </p>
          <div className="catalog-counts" aria-live="polite">
            <span><strong>{allServers.length}</strong> endpoints indexed</span>
            <span><strong>{filteredServers.length}</strong> in current view</span>
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
            <label className="form-label d-block" htmlFor={`${idPrefix}-oauth-all`}>
              Authentication
            </label>
            <div className="btn-group flex-wrap" role="group" aria-label="Authentication filter">
              {OAUTH_FILTER_OPTIONS.map((option) => {
                const optionId = `${idPrefix}-oauth-${option.value}`;

                return (
                  <React.Fragment key={option.value}>
                    <input
                      type="radio"
                      className="btn-check"
                      name={`${idPrefix}-oauth-filter`}
                      id={optionId}
                      checked={oauthFilter === option.value}
                      onChange={() => setOauthFilter(option.value)}
                    />
                    <label className="btn btn-outline-primary" htmlFor={optionId}>
                      {option.label}
                    </label>
                  </React.Fragment>
                );
              })}
            </div>
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
