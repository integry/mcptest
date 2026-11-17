import React from 'react';
import './ConnectedGuide.css';

/**
 * The idle workspace. First-time visitors also see the order of operations;
 * anyone who has connected before or called a tool already knows it.
 */
export const AwaitingConnectionPanel: React.FC<{ showSteps?: boolean }> = ({ showSteps = false }) => (
  <section className="awaiting-connection-panel" aria-labelledby="awaiting-connection-title">
    <div className="awaiting-connection-tabs" aria-hidden="true">
      <span>Server capabilities</span>
      <span>Inspector</span>
      <span>Connection logs</span>
    </div>
    <div className="awaiting-connection-empty">
      <span className="awaiting-connection-icon" aria-hidden="true">
        <i className="bi bi-terminal"></i>
      </span>
      <div>
        <h2 id="awaiting-connection-title">Awaiting connection</h2>
        <p>Connect a server and its capabilities, requests, and output will appear here.</p>
        {showSteps && <ol className="awaiting-connection-steps" aria-label="What happens next">
          <li><strong>Connect.</strong> Each stage shows as it happens: reach the endpoint, negotiate the protocol, sign in if asked, list capabilities.</li>
          <li><strong>Call a tool.</strong> Pick one, fill in the generated form and read the result next to its raw JSON-RPC.</li>
          <li><strong>Share a report.</strong> Protocol, auth and CORS checks behind one link, with credentials redacted.</li>
        </ol>}
      </div>
    </div>
  </section>
);
