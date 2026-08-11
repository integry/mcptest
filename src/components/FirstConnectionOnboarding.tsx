import React from 'react';

interface FirstConnectionOnboardingProps {
  onConnectFirstServer: () => void;
}

export const FirstConnectionOnboarding: React.FC<FirstConnectionOnboardingProps> = ({
  onConnectFirstServer,
}) => (
  <section className="first-connection-hero" aria-labelledby="first-connection-title">
    <div className="first-connection-hero-copy">
      <span className="first-connection-eyebrow">MCP Inspector</span>
      <h1 id="first-connection-title">Welcome to mcptest.io</h1>
      <p>
        The easiest way to inspect, debug, and negotiate with remote MCP servers.
        Connect an endpoint to explore its tools, resources, prompts, and live responses.
      </p>
      <button
        type="button"
        className="btn btn-primary btn-lg first-connection-cta"
        onClick={onConnectFirstServer}
      >
        <i className="bi bi-plug me-2" aria-hidden="true"></i>
        Connect your first server
      </button>
    </div>
    <div className="first-connection-preview" aria-hidden="true">
      <div className="first-connection-preview-bar">
        <span></span><span></span><span></span>
      </div>
      <div className="first-connection-preview-body">
        <div className="preview-capability-list">
          <span></span><span></span><span></span>
        </div>
        <div className="preview-response-block">
          <span></span><span></span><span></span><span></span>
        </div>
      </div>
    </div>
  </section>
);

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
