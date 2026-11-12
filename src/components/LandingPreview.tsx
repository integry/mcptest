import React from 'react';

import { LANDING_PREVIEW_SAMPLE as SAMPLE } from '../content/landingFirstRun';

/**
 * A static example of what a connection shows: the server summary with its
 * protocol, auth and CORS pills, a few tools and one JSON-RPC exchange. It is
 * plain markup from sample data (no screenshot, no measured layout), so the
 * prerendered copy in scripts/generate-seo-pages.js paints it identically.
 */
export const LandingPreview: React.FC<{ idPrefix?: string }> = ({ idPrefix = 'landing' }) => (
  <figure className="landing-preview" aria-labelledby={`${idPrefix}-preview-caption`}>
    <figcaption id={`${idPrefix}-preview-caption`} className="landing-preview-caption">
      <span className="landing-preview-tag">{SAMPLE.caption}</span>
      <span className="landing-preview-title">{SAMPLE.title}</span>
    </figcaption>
    <div className="landing-preview-server">
      <p className="landing-preview-endpoint">{SAMPLE.endpoint}</p>
      <p className="landing-preview-name">
        {SAMPLE.serverName} <span className="landing-preview-version">v{SAMPLE.serverVersion}</span>
      </p>
      <ul className="landing-preview-checks" aria-label="Checks">
        {SAMPLE.checks.map((check) => (
          <li key={check.label}>
            <span className={`badge bg-${check.status}`}>{check.label}</span>
          </li>
        ))}
      </ul>
    </div>
    <div className="landing-preview-section">
      <p className="landing-preview-heading">{SAMPLE.counts}</p>
      <ul className="landing-preview-tools">
        {SAMPLE.tools.map((tool) => (
          <li key={tool.name}>
            <span className="landing-preview-tool">{tool.name}</span>
            <span className="landing-preview-tool-description">{tool.description}</span>
          </li>
        ))}
      </ul>
    </div>
    <div className="landing-preview-section">
      <p className="landing-preview-heading">{SAMPLE.exchangeTitle}</p>
      <ol className="landing-preview-wire">
        {SAMPLE.exchange.map((message) => (
          <li key={message.direction} className={`landing-preview-message landing-preview-message--${message.direction}`}>
            <span className="landing-preview-direction">
              <span aria-hidden="true">{message.direction === 'request' ? '→' : '←'}</span> {message.label}
            </span>
            <code className="landing-preview-json">{message.body}</code>
          </li>
        ))}
      </ol>
    </div>
  </figure>
);

export default LandingPreview;
