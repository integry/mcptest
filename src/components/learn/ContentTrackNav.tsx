import React from 'react';
import { NavLink } from 'react-router-dom';
import { TRACK_NAVIGATION } from '../../content/learnRegistry';
import './ContentTrackNav.css';

interface ContentTrackNavProps {
  onNavigate?: () => void;
}

/** Sidebar navigation for content pages: every track with its articles in order. */
const ContentTrackNav: React.FC<ContentTrackNavProps> = ({ onNavigate }) => (
  <section className="sidenav-content-section content-track-nav mt-3" aria-labelledby="learn-nav-heading">
    <h2 id="learn-nav-heading" className="sidenav-section-label mb-1">Learn</h2>
    <ul className="nav flex-column sidenav-content-list">
      <li className="nav-item">
        <NavLink to="/learn" end className="nav-link docs-nav-link py-1" onClick={onNavigate}>
          <i className="bi bi-journals me-2" aria-hidden="true"></i> All guides
        </NavLink>
      </li>
    </ul>
    {TRACK_NAVIGATION.map(track => (
      <div className="content-track" key={track.id}>
        <h3 className="content-track-label" id={`sidenav-track-${track.id}`}>{track.label}</h3>
        <ul className="nav flex-column sidenav-content-list" aria-labelledby={`sidenav-track-${track.id}`}>
          {track.items.map(item => (
            <li className="nav-item" key={item.slug}>
              <NavLink to={item.path} end className="nav-link docs-nav-link py-1" onClick={onNavigate}>
                {item.navTitle}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    ))}
  </section>
);

export default ContentTrackNav;
