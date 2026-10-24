import React from 'react';
import { Link } from 'react-router-dom';
import GuideSearch from './learn/GuideSearch';
import './learn/ReadingLayout.css';
import { NOT_FOUND_LINKS, NOT_FOUND_SUMMARY, NOT_FOUND_TITLE } from '../utils/appRoutes';

/**
 * The view for any path the app has no route for (see utils/appRoutes). The
 * prerendered dist/404.html carries the same content for the origin's 404s.
 */
const NotFound: React.FC = () => (
  <div className="reading-shell reading-shell-single not-found-page">
    <section className="reading-article" aria-labelledby="not-found-title">
      <header className="reading-header">
        <h1 id="not-found-title">{NOT_FOUND_TITLE}</h1>
        <p className="reading-summary">{NOT_FOUND_SUMMARY}</p>
      </header>
      <GuideSearch idPrefix="not-found" variant="page" shortcutEnabled shortcutPriority={1} />
      <div className="reading-prose">
        <ul className="not-found-links">
          {NOT_FOUND_LINKS.map(link => (
            <li key={link.path}>
              <Link to={link.path}>{link.label}</Link> — {link.description}
            </li>
          ))}
        </ul>
      </div>
    </section>
  </div>
);

export default NotFound;
