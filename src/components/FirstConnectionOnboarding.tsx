import React from 'react';

export const AwaitingConnectionPanel: React.FC = () => (
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
      </div>
    </div>
  </section>
);
