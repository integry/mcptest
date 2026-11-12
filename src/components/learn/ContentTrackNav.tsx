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
  /** Rendered at the top of the group, above the guide hub link. */
  search?: React.ReactNode;
  /**
   * Whether the group's body (search, hub and tracks) is shown. With
   * `onToggleOpen` the heading becomes a toggle; the links stay in the DOM
   * (hidden) either way. Without it the group is always open.
   */
  open?: boolean;
  onToggleOpen?: () => void;
}

/** Icon of the Learn group toggle, also shown on the icon rail. */
export const LEARN_GROUP_ICON = 'bi-mortarboard';

/**
 * The sidebar's Learn group: the guide search, the guide hub and the four
 * tracks, under a heading that can fold the whole group. The track that
 * owns the current page is expanded to its articles; the others stay
 * collapsed until toggled. Track toggles reset on navigation.
 */
const ContentTrackNav: React.FC<ContentTrackNavProps> = ({
  onNavigate,
  collapsed = false,
  onExpandSidebar,
  idPrefix = 'sidenav',
  search,
  open,
  onToggleOpen,
}) => {
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

  const collapsible = Boolean(onToggleOpen);
  const bodyId = `${idPrefix}-learn-body`;
  const bodyOpen = collapsible ? Boolean(open) : true;

  const tracks = (
    <>
      {search}
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
    </>
  );

  return (
    <section className="sidenav-group content-track-nav" aria-labelledby={`${idPrefix}-learn-heading`}>
      {collapsible ? (
        <>
          <h2 className="sidenav-section-heading">
            <button
              type="button"
              id={`${idPrefix}-learn-heading`}
              className="nav-link sidenav-link sidenav-group-toggle sidenav-section-toggle"
              aria-expanded={bodyOpen}
              aria-controls={bodyId}
              onClick={onToggleOpen}
              title={collapsed ? 'Learn' : undefined}
            >
              <i className={`bi ${LEARN_GROUP_ICON} sidenav-icon`} aria-hidden="true"></i>
              <span className="sidenav-label">Learn</span>
              <i className="bi bi-chevron-right sidenav-chevron" aria-hidden="true"></i>
            </button>
          </h2>
          <div id={bodyId} className="sidenav-learn-body" hidden={!bodyOpen}>
            {tracks}
          </div>
        </>
      ) : (
        <>
          <h2 id={`${idPrefix}-learn-heading`} className="sidenav-section-label">Learn</h2>
          {tracks}
        </>
      )}
    </section>
  );
};

export default ContentTrackNav;
