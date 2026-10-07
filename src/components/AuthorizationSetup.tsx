import React, { useState } from 'react';
import type { AuthorizationGuidanceViewModel } from '../utils/authorizationGuidance';

interface AuthorizationSetupProps {
  guidance: AuthorizationGuidanceViewModel;
  /** Reports use current catalog guidance, not evidence observed by the run. */
  currentCatalogContext?: boolean;
  compact?: boolean;
}

const AuthorizationSetup: React.FC<AuthorizationSetupProps> = ({
  guidance,
  currentCatalogContext = false,
  compact = false,
}) => {
  const [copyStatus, setCopyStatus] = useState('');
  const copyCallback = async (callback: string) => {
    if (!navigator.clipboard?.writeText) {
      setCopyStatus('Clipboard access is unavailable; select and copy the callback URI manually.');
      return;
    }
    try {
      await navigator.clipboard.writeText(callback);
      setCopyStatus('Callback URI copied.');
    } catch {
      setCopyStatus('Clipboard access is unavailable; select and copy the callback URI manually.');
    }
  };

  return (
    <section
      className={`authorization-setup authorization-setup--${guidance.status}${compact ? ' authorization-setup--compact' : ''}`}
      aria-labelledby={`authorization-setup-${guidance.catalogId || 'target'}-title`}
    >
      <div className="authorization-setup-heading">
        <div>
          <p className="authorization-setup-kicker">Authorization setup</p>
          <h3 id={`authorization-setup-${guidance.catalogId || 'target'}-title`}>
            {guidance.statusLabel}
          </h3>
        </div>
        {guidance.reviewedAt && (
          <span className="authorization-setup-reviewed">
            Reviewed <time dateTime={guidance.reviewedAt}>{guidance.reviewedAt}</time>
          </span>
        )}
      </div>

      <p>{guidance.summary}</p>

      {currentCatalogContext && guidance.trustedCatalogMatch && (
        <p className="authorization-setup-freshness" role="note">
          This is current catalog guidance reviewed on {guidance.reviewedAt || 'an unrecorded date'};
          it was not evidence observed during this report run and may postdate a saved report.
        </p>
      )}

      {(guidance.clientIdRequired || guidance.clientSecretRequired) && (
        <dl className="authorization-setup-requirements">
          <div><dt>Client ID</dt><dd>{guidance.clientIdRequired ? 'Required' : 'Not required'}</dd></div>
          <div><dt>Client secret</dt><dd>{guidance.clientSecretRequired ? 'Required — keep server-side or in the client secret store' : 'Not required'}</dd></div>
          <div><dt>Browser/public client</dt><dd>{guidance.browserPublicClientSupported === true ? 'Supported' : guidance.browserPublicClientSupported === false ? 'Not supported' : 'Not verified'}</dd></div>
        </dl>
      )}

      {guidance.settings.length > 0 && (
        <div className="authorization-setup-settings">
          <h4>Required non-secret settings</h4>
          <dl>
            {guidance.settings.map(({ label, value, required }) => (
              <div key={`${label}-${value}`}>
                <dt>{label}</dt><dd>{value}{required ? ' (required)' : ' (optional)'}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {guidance.callbacks.length > 0 && (
        <div className="authorization-setup-callbacks">
          <h4>Callback URI{guidance.callbacks.length > 1 ? 's' : ''}</h4>
          {guidance.callbacks.map((callback) => (
            <div className="authorization-callback" key={callback}>
              <code>{callback}</code>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => void copyCallback(callback)}
                aria-label={`Copy callback URI ${callback}`}
              >
                <i className="bi bi-copy" aria-hidden="true"></i> Copy
              </button>
            </div>
          ))}
        </div>
      )}

      {guidance.steps.length > 0 && (
        <div className="authorization-setup-steps">
          <h4>Provider setup steps</h4>
          <ol>{guidance.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol>
        </div>
      )}

      {guidance.alternativeHeaderTemplate && (
        <p className="authorization-setup-template">
          <strong>Safe header template:</strong> <code>{guidance.alternativeHeaderTemplate}</code>.
          Replace only the named placeholder in protected client configuration; never put the credential in a URL or catalog data.
        </p>
      )}

      <div className="authorization-setup-links">
        {guidance.registrationUrl && (
          <a href={guidance.registrationUrl} target="_blank" rel="noopener noreferrer">
            {guidance.status === 'provider-approval-required' ? 'Open provider application or waitlist' : 'Open provider setup'}
            {' '}<i className="bi bi-box-arrow-up-right" aria-hidden="true"></i>
          </a>
        )}
        {guidance.documentationUrl && (
          <a href={guidance.documentationUrl} target="_blank" rel="noopener noreferrer">
            Publisher documentation <i className="bi bi-box-arrow-up-right" aria-hidden="true"></i>
          </a>
        )}
        {guidance.catalogId && currentCatalogContext && (
          <a href={`/servers/${encodeURIComponent(guidance.catalogId)}`}>
            View report-card setup explanation
          </a>
        )}
      </div>
      <span className="visually-hidden" role="status" aria-live="polite">{copyStatus}</span>
    </section>
  );
};

export default AuthorizationSetup;
