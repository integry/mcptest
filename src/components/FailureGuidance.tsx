import React from 'react';
import type { FailureGuidance } from '../utils/connectionGuidance';
import './ConnectedGuide.css';

/**
 * The plain-language part of a failure: what failed, the most likely cause
 * and what to try. Rendered before any technical evidence.
 */
const FailureGuidanceSummary: React.FC<{ guidance: FailureGuidance; titleId?: string }> = ({ guidance, titleId }) => (
  <div className="failure-guidance">
    <p id={titleId} className="failure-guidance-what">{guidance.whatFailed}</p>
    <p className="failure-guidance-cause">
      <span className="failure-guidance-label">Most likely cause:</span> {guidance.likelyCause}
    </p>
    <div className="failure-guidance-try">
      <span className="failure-guidance-label">What to try:</span>
      <ul>
        {guidance.tryThis.map((step) => <li key={step}>{step}</li>)}
      </ul>
    </div>
  </div>
);

/** The matching Learn article, offered after the technical detail. */
export const FailureLearnLink: React.FC<{ guidance: FailureGuidance }> = ({ guidance }) => (
  guidance.learn ? (
    <p className="failure-guidance-learn">
      <i className="bi bi-book" aria-hidden="true"></i>
      <a href={guidance.learn.path} target="_blank" rel="noopener">
        Learn: {guidance.learn.title}
        <span className="visually-hidden"> (opens in a new tab)</span>
      </a>
    </p>
  ) : null
);

export default FailureGuidanceSummary;
