import React from 'react';
import { Link } from 'react-router-dom';
import {
  CONTENT_LEVEL_LABELS,
  LEARN_INDEX_METADATA,
  TRACK_NAVIGATION,
} from '../../content/learnRegistry';
import GuideSearch from './GuideSearch';
import './ReadingLayout.css';

const LearnIndex: React.FC = () => (
  <div className="reading-shell reading-shell-index">
    <div className="reading-article learn-index" aria-labelledby="learn-index-title">
      <header className="reading-header">
        <h1 id="learn-index-title">{LEARN_INDEX_METADATA.title}</h1>
        <p className="reading-summary">{LEARN_INDEX_METADATA.summary}</p>
      </header>

      {/* Takes `/` ahead of the sidebar field while the index is open. */}
      <GuideSearch idPrefix="learn-index" variant="page" shortcutEnabled shortcutPriority={1} />

      {TRACK_NAVIGATION.map(track => (
        <section
          className="learn-track"
          id={`track-${track.id}`}
          key={track.id}
          aria-labelledby={`track-${track.id}-title`}
        >
          <h2 id={`track-${track.id}-title`}>{track.label}</h2>
          <p className="learn-track-description">{track.description}</p>
          <ol className="learn-track-list">
            {track.items.map(item => (
              <li className="learn-track-item" key={item.slug}>
                <Link className="learn-track-item-title" to={item.path}>{item.title}</Link>
                <p className="learn-track-item-summary">{item.summary}</p>
                <p className="learn-track-item-meta">
                  <span>{item.readingTimeMinutes} min read</span>
                  <span aria-hidden="true">·</span>
                  <span>{CONTENT_LEVEL_LABELS[item.level]}</span>
                </p>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  </div>
);

export default LearnIndex;
