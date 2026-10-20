import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LEARN_HUB_NAVIGATION,
  LEARN_TRACKS,
  getLearnTrackForPath,
} from '../../content/navigation';
import './ContentTrackNav.css';

interface ContentTrackNavProps {
  onNavigate?: () => void;
  /** Icon-only sidebar: labels are hidden and opening a track expands the sidebar first. */
  collapsed?: boolean;
  onExpandSidebar?: () => void;
  /** Keeps element ids unique when the desktop sidebar and the mobile drawer both render. */
  idPrefix?: string;
}

/**
 * The sidebar's Learn group: the guide hub plus the four tracks, always
 * visible. The track that owns the current page is expanded to its articles;
 * the others stay collapsed until toggled. Toggles reset on navigation.
 */
const ContentTrackNav: React.FC<ContentTrackNavProps> = ({ onNavigate, collapsed = false, onExpandSidebar, idPrefix = 'sidenav' }) => {
  const { pathname } = useLocation();
  const activeTrackId = getLearnTrackForPath(pathname)?.id;
  const [overrides, setOverrides] = useState<Partial<Record<string, boolean>>>({});

  useEffect(() => {
    setOverrides({});
  }, [pathname]);

  const isExpanded = (trackId: string) => !collapsed && (overrides[trackId] ?? trackId === activeTrackId);

  const toggleTrack = (trackId: string) => {
    if (collapsed) {
      onExpandSidebar?.();
      // Open only the chosen track, even if another one owns the current page.
      setOverrides(activeTrackId ? { [activeTrackId]: false, [trackId]: true } : { [trackId]: true });
      return;
    }
    setOverrides(current => ({ ...current, [trackId]: !isExpanded(trackId) }));
  };

  return (
    <section className="sidenav-group content-track-nav" aria-labelledby={`${idPrefix}-learn-heading`}>
      <h2 id={`${idPrefix}-learn-heading`} className="sidenav-section-label">Learn</h2>
      <ul className="sidenav-list">
        <li className="nav-item">
          <NavLink
            to={LEARN_HUB_NAVIGATION.path}
            end
            className="nav-link sidenav-link"
            onClick={onNavigate}
            title={collapsed ? LEARN_HUB_NAVIGATION.label : undefined}
          >
            <i className={`bi ${LEARN_HUB_NAVIGATION.icon} sidenav-icon`} aria-hidden="true"></i>
            <span className="sidenav-label">{LEARN_HUB_NAVIGATION.label}</span>
          </NavLink>
        </li>
        {LEARN_TRACKS.map(track => {
          const expanded = isExpanded(track.id);
          const listId = `${idPrefix}-track-${track.id}`;
          return (
            <li className="nav-item content-track" key={track.id} data-track={track.id}>
              <button
                type="button"
                className={`nav-link sidenav-link sidenav-group-toggle content-track-label${track.id === activeTrackId ? ' is-current' : ''}`}
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => toggleTrack(track.id)}
                title={collapsed ? track.label : undefined}
              >
                <i className={`bi ${track.icon} sidenav-icon`} aria-hidden="true"></i>
                <span className="sidenav-label">{track.label}</span>
                <i className="bi bi-chevron-right sidenav-chevron" aria-hidden="true"></i>
              </button>
              <ul
                id={listId}
                className="sidenav-list sidenav-sublist"
                aria-label={`${track.label} guides`}
                hidden={!expanded}
              >
                {track.items.map(item => (
                  <li className="nav-item" key={item.slug}>
                    <NavLink to={item.path} end className="nav-link sidenav-link sidenav-sublink" onClick={onNavigate}>
                      {item.navTitle}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default ContentTrackNav;
