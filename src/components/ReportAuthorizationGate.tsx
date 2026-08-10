import React from 'react';

interface ReportAuthorizationGateProps {
  serverUrl: string;
  error?: string | null;
  isAuthorizing?: boolean;
  isPreparingClient?: boolean;
  onAuthorize: () => void;
  onConfigureClient: () => void;
}

const displayHost = (value: string): string => {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
};

const ReportAuthorizationGate: React.FC<ReportAuthorizationGateProps> = ({
  serverUrl,
  error,
  isAuthorizing = false,
  isPreparingClient = false,
  onAuthorize,
  onConfigureClient,
}) => (
  <section className="report-auth-gate" aria-labelledby="report-auth-title">
    <div className="report-auth-heading">
      <div className="report-auth-icon" aria-hidden="true">
        <i className="bi bi-shield-lock-fill"></i>
      </div>
      <div>
        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
          <h3 id="report-auth-title" className="mb-0">Authorization required</h3>
          <span className="badge text-bg-warning">Not scored</span>
        </div>
        <p className="mb-0">
          <strong>{displayHost(serverUrl)}</strong> is a protected MCP server. Its protocol,
          capabilities, transport, and performance cannot be evaluated until you authorize
          mcptest.io to access it.
        </p>
      </div>
    </div>

    <div className="report-auth-note">
      This is an authorization gate, not a failed report. No grade or zero score has been assigned.
    </div>

    {error && <div className="alert alert-danger mb-0" role="alert">{error}</div>}

    <div className="report-auth-options" aria-label="OAuth authorization options">
      <div className="report-auth-option">
        <div>
          <h4>Continue with OAuth</h4>
          <p>
            Use server discovery and PKCE. You will be redirected to the provider's authorization
            page to approve access, then the report will run again automatically.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onAuthorize}
          disabled={isAuthorizing || isPreparingClient}
        >
          {isAuthorizing ? (
            <><span className="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Preparing OAuth...</>
          ) : (
            <><i className="bi bi-box-arrow-up-right me-2" aria-hidden="true"></i>Authorize and run report</>
          )}
        </button>
      </div>

      <div className="report-auth-option">
        <div>
          <h4>Use a registered OAuth client</h4>
          <p>
            Choose this when the provider gave you a client ID, or when it does not allow
            automatic client registration. Client credentials stay in this browser tab.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={onConfigureClient}
          disabled={isAuthorizing || isPreparingClient}
        >
          {isPreparingClient ? (
            <><span className="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Discovering provider...</>
          ) : (
            <><i className="bi bi-key me-2" aria-hidden="true"></i>Enter client credentials</>
          )}
        </button>
      </div>
    </div>
  </section>
);

export default ReportAuthorizationGate;
