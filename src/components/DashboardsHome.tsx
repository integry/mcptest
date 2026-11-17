import React, { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Space } from '../types';
import { FIRST_DASHBOARD_NAME } from '../utils/defaultWorkspace';
import { getSpaceUrl } from '../utils/urlUtils';

interface DashboardsHomeProps {
  spaces: Space[];
  onCreate: (name: string) => void;
}

const cardCount = (count: number) => `${count} ${count === 1 ? 'card' : 'cards'}`;

/**
 * The dashboards page (/space): what a dashboard is, the create action, and
 * the visitor's dashboards when there are any. A visitor who has never
 * created one reaches it from the single "Dashboards" sidebar entry.
 */
const DashboardsHome: React.FC<DashboardsHomeProps> = ({ spaces, onCreate }) => {
  const [name, setName] = useState(spaces.length === 0 ? FIRST_DASHBOARD_NAME : '');
  const inputId = useId();
  const helpId = `${inputId}-help`;
  const trimmed = name.trim();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmed) return;
    onCreate(trimmed);
    setName('');
  };

  return (
    <section className="dashboards-home" aria-labelledby="dashboards-home-title">
      <h1 id="dashboards-home-title" className="dashboards-home-title">Dashboards</h1>
      <p className="dashboards-home-lede">
        A dashboard keeps tool calls and resource reads you want to repeat. Each card re-runs its
        call against the server and shows whether it still works, so you can check several
        servers at a glance.
      </p>
      <p className="dashboards-home-lede">
        Add a card from the Playground with <strong>Add to dashboard</strong> on a tool or resource result, or
        create an empty dashboard here. Dashboards are saved in this browser.
      </p>

      <form className="dashboards-home-create" onSubmit={handleSubmit}>
        <label htmlFor={inputId} className="form-label">Dashboard name</label>
        <div className="input-group">
          <input
            id={inputId}
            type="text"
            className="form-control"
            value={name}
            onChange={event => setName(event.target.value)}
            aria-describedby={helpId}
            placeholder="New dashboard name..."
          />
          <button type="submit" className="btn btn-primary" disabled={!trimmed}>
            <i className="bi bi-plus-lg me-1" aria-hidden="true"></i>Create dashboard
          </button>
        </div>
        <small id={helpId} className="text-muted d-block mt-1">
          You can rename it, reorder cards and change its columns later.
        </small>
      </form>

      {spaces.length > 0 ? (
        <section className="dashboards-home-list" aria-labelledby="dashboards-home-list-title">
          <h2 id="dashboards-home-list-title" className="dashboards-home-subtitle">Your dashboards</h2>
          <ul className="list-group">
            {spaces.map(space => (
              <li key={space.id} className="list-group-item d-flex align-items-center justify-content-between">
                <Link to={getSpaceUrl(space.name)}>{space.name}</Link>
                <span className="text-muted small">{cardCount(space.cards.length)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="dashboards-home-note">
          <Link to="/">Open the Playground</Link> to connect a server and save your first result.
        </p>
      )}
    </section>
  );
};

export default DashboardsHome;
