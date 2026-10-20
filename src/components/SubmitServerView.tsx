import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  CATALOG_SUBMISSION_API_PATH,
  CATALOG_SUBMISSION_CATEGORIES,
  CATALOG_SUBMISSION_DOCS_URL,
  CATALOG_SUBMISSION_LIMITS,
  CATALOG_SUBMISSION_LOGO_LICENSES,
  buildCatalogSubmission,
  findCatalogDuplicate,
  getSubmissionEndpointError,
  isSubmittableEvidence,
  validateCatalogSubmissionDraft,
  type CatalogSubmissionDraft,
  type CatalogSubmissionEvidence,
  type CatalogSubmissionFieldErrors,
  type CatalogSubmissionResponse,
} from '../utils/catalogSubmission';
import { probeSubmissionEndpoint } from '../utils/submissionProbe';
import { useTurnstile } from '../hooks/useTurnstile';
import './SubmitServerView.css';

export interface SubmitServerViewProps {
  /** Endpoint of the current playground connection, used to prefill the form. */
  initialUrl?: string;
  /** Replaceable for tests. */
  probe?: typeof probeSubmissionEndpoint;
  submitUrl?: string;
  turnstileSiteKey?: string;
}

const emptyDraft = (url = ''): CatalogSubmissionDraft => ({
  url,
  name: '',
  description: '',
  category: '',
  homepageUrl: '',
  logoUrl: '',
  logoLicense: '',
  contactEmail: '',
  authorized: false,
});

type SubmitError = { message: string; details?: string[]; catalogId?: string };

const AUTH_LABELS: Record<CatalogSubmissionEvidence['authChallenge'], string> = {
  none: 'None. Connected without credentials',
  oauth: 'OAuth (protected resource metadata)',
  bearer: 'Bearer token',
  unspecified: 'Authentication required (scheme not advertised)',
};

const CORS_LABELS: Record<CatalogSubmissionEvidence['browserAccess'], string> = {
  direct: 'Readable directly from the browser',
  'proxy-required': 'Blocked by CORS; reachable through the mcptest proxy',
  unknown: 'Not determined',
};

const describeEvidence = (evidence: CatalogSubmissionEvidence): Array<[string, string]> => [
  ['Reachable', evidence.outcome === 'mcp'
    ? 'Yes, MCP handshake completed'
    : evidence.outcome === 'auth-challenge'
      ? `Yes, authentication challenge${evidence.authStatus ? ` (HTTP ${evidence.authStatus})` : ''}`
      : 'No'],
  ['Transport', evidence.transport === 'streamable-http'
    ? 'Streamable HTTP'
    : evidence.transport === 'legacy-sse' ? 'Legacy SSE' : 'Not negotiated'],
  ['Protocol version', evidence.protocolVersion
    ? `${evidence.protocolVersion}${evidence.protocolEra ? ` (${evidence.protocolEra})` : ''}`
    : 'Not negotiated'],
  ['Auth challenge', evidence.outcome === 'unreachable' ? 'Not observed' : AUTH_LABELS[evidence.authChallenge]],
  ['Browser CORS', CORS_LABELS[evidence.browserAccess]],
  ['Tools without credentials', evidence.toolCount !== undefined
    ? String(evidence.toolCount)
    : evidence.outcome === 'auth-challenge' ? 'Listed after authorization' : 'Not available'],
];

const SubmitServerView: React.FC<SubmitServerViewProps> = ({
  initialUrl = '',
  probe = probeSubmissionEndpoint,
  submitUrl = import.meta.env.VITE_CATALOG_SUBMISSION_URL || CATALOG_SUBMISSION_API_PATH,
  turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY,
}) => {
  const formId = useId();
  const fieldId = (name: string) => `${formId}-${name}`;
  const [draft, setDraft] = useState<CatalogSubmissionDraft>(() => emptyDraft(initialUrl));
  const [evidence, setEvidence] = useState<CatalogSubmissionEvidence>();
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string>();
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError>();
  const [result, setResult] = useState<CatalogSubmissionResponse>();
  const probeController = useRef<AbortController | undefined>(undefined);
  const turnstile = useTurnstile(turnstileSiteKey);

  // Prefill once a playground connection appears, but never overwrite typing.
  useEffect(() => {
    if (initialUrl) setDraft((current) => (current.url ? current : { ...current, url: initialUrl }));
  }, [initialUrl]);

  useEffect(() => () => probeController.current?.abort(), []);

  const fieldErrors: CatalogSubmissionFieldErrors = useMemo(() => validateCatalogSubmissionDraft(draft), [draft]);
  const visibleErrors = showErrors ? fieldErrors : {};
  const evidenceIsCurrent = Boolean(evidence && evidence.endpointUrl === draft.url.trim());
  const canSubmit = isSubmittableEvidence(evidence, draft.url) && !submitting;
  const duplicate = useMemo(() => (getSubmissionEndpointError(draft.url) ? undefined : findCatalogDuplicate(draft.url)), [draft.url]);

  const update = <K extends keyof CatalogSubmissionDraft>(key: K, value: CatalogSubmissionDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSubmitError(undefined);
  };

  const runCheck = async () => {
    const url = draft.url.trim();
    const urlError = getSubmissionEndpointError(url);
    if (urlError) {
      setCheckError(urlError);
      return;
    }
    probeController.current?.abort();
    const controller = new AbortController();
    probeController.current = controller;
    setCheckError(undefined);
    setChecking(true);
    setEvidence(undefined);
    try {
      const observed = await probe(url, { signal: controller.signal });
      if (!controller.signal.aborted) setEvidence(observed);
    } finally {
      if (probeController.current === controller) setChecking(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (!evidence || !canSubmit || Object.keys(fieldErrors).length > 0) return;
    if (turnstileSiteKey && !turnstile.token) {
      setSubmitError({ message: 'Complete the human check before submitting.' });
      return;
    }
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      const response = await fetch(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildCatalogSubmission(draft, evidence, turnstile.token)),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setResult(body as CatalogSubmissionResponse);
        return;
      }
      setSubmitError({
        message: typeof body?.message === 'string' ? body.message : `The submission failed with HTTP ${response.status}.`,
        details: Array.isArray(body?.errors) ? body.errors : undefined,
        catalogId: typeof body?.catalogId === 'string' ? body.catalogId : undefined,
      });
      turnstile.reset();
    } catch {
      setSubmitError({ message: 'The submission could not be sent. Check your connection and try again.' });
      turnstile.reset();
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="submit-server">
        <section className="submit-server-done" aria-live="polite">
          <h1>Submission received</h1>
          <p>
            Thanks. Your listing is queued as submission <code>{result.submissionId}</code>,
            with the proposed catalog id <code>{result.proposedCatalogId}</code>.
          </p>
          <p>{result.nextStep}</p>
          <p className="mb-0">
            <a href={result.docsUrl || CATALOG_SUBMISSION_DOCS_URL} target="_blank" rel="noopener noreferrer">
              What happens next <i className="bi bi-arrow-up-right" aria-hidden="true" />
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          </p>
        </section>
      </div>
    );
  }

  const fieldClass = (name: keyof CatalogSubmissionFieldErrors, base = 'form-control') => (
    `${base}${visibleErrors[name] ? ' is-invalid' : ''}`
  );
  const errorFor = (name: keyof CatalogSubmissionFieldErrors) => visibleErrors[name] && (
    <div id={fieldId(`${name}-error`)} className="invalid-feedback d-block">{visibleErrors[name]}</div>
  );
  const describedBy = (name: keyof CatalogSubmissionFieldErrors, hint?: string) => (
    [hint ? fieldId(`${name}-hint`) : '', visibleErrors[name] ? fieldId(`${name}-error`) : ''].filter(Boolean).join(' ') || undefined
  );

  const gateMessage = checking
    ? 'Checking the endpoint…'
    : !evidence
      ? 'Run the endpoint check before submitting.'
      : !evidenceIsCurrent
        ? 'The endpoint URL changed after the check. Check it again.'
        : !isSubmittableEvidence(evidence)
          ? 'The endpoint must answer as an MCP server or with an authentication challenge.'
          : undefined;

  return (
    <div className="submit-server">
      <header className="submit-server-header">
        <h1>Submit a server</h1>
        <p>
          Check your remote MCP endpoint from this browser, describe it, and send it. A workflow repeats the
          check, writes the catalog entry and opens a pull request for a maintainer to review. No account is needed.
        </p>
      </header>

      <form className="submit-server-form" onSubmit={submit} noValidate aria-describedby={fieldId('gate')}>
        <section className="submit-server-section" aria-labelledby={fieldId('step-check')}>
          <h2 id={fieldId('step-check')}>1. Check the endpoint</h2>
          <label htmlFor={fieldId('url')} className="form-label">Endpoint URL</label>
          <div className="submit-server-check-row">
            <input
              id={fieldId('url')}
              type="url"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              className={fieldClass('url')}
              placeholder="https://mcp.example.com/mcp"
              value={draft.url}
              maxLength={CATALOG_SUBMISSION_LIMITS.url}
              onChange={(event) => { update('url', event.target.value); setCheckError(undefined); }}
              aria-invalid={Boolean(visibleErrors.url || checkError)}
              aria-describedby={[fieldId('url-hint'), visibleErrors.url ? fieldId('url-error') : '', checkError ? fieldId('check-error') : ''].filter(Boolean).join(' ')}
            />
            <button type="button" className="btn btn-outline-primary" onClick={runCheck} disabled={checking || !draft.url.trim()}>
              {checking ? 'Checking…' : 'Check endpoint'}
            </button>
          </div>
          <p id={fieldId('url-hint')} className="submit-server-hint">
            The public HTTPS endpoint, without credentials or query parameters. The check runs from your browser.
          </p>
          {errorFor('url')}
          {checkError && <div id={fieldId('check-error')} className="invalid-feedback d-block">{checkError}</div>}
          {duplicate && (
            <p className="submit-server-note" role="status">
              This endpoint is already listed as <a href={`/servers/${encodeURIComponent(duplicate.id)}`}>{duplicate.name}</a>.
            </p>
          )}

          {evidence && (
            <div
              className={`submit-server-evidence${isSubmittableEvidence(evidence) ? ' is-ready' : ' is-blocked'}`}
              aria-live="polite"
              data-testid="submission-evidence"
            >
              <p className="submit-server-evidence-summary">
                <i
                  className={`bi ${isSubmittableEvidence(evidence) ? 'bi-check-circle' : 'bi-x-circle'}`}
                  aria-hidden="true"
                />
                {isSubmittableEvidence(evidence) ? 'Ready to submit' : 'Not submittable yet'}
              </p>
              <dl>
                {describeEvidence(evidence).map(([term, value]) => (
                  <div key={term}>
                    <dt>{term}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="submit-server-hint mb-0">{evidence.detail}</p>
            </div>
          )}
        </section>

        <section className="submit-server-section" aria-labelledby={fieldId('step-details')}>
          <h2 id={fieldId('step-details')}>2. Describe the listing</h2>
          <div className="submit-server-grid">
            <div>
              <label htmlFor={fieldId('name')} className="form-label">Display name</label>
              <input
                id={fieldId('name')}
                type="text"
                className={fieldClass('name')}
                value={draft.name}
                maxLength={CATALOG_SUBMISSION_LIMITS.name}
                onChange={(event) => update('name', event.target.value)}
                aria-invalid={Boolean(visibleErrors.name)}
                aria-describedby={describedBy('name')}
              />
              {errorFor('name')}
            </div>
            <div>
              <label htmlFor={fieldId('category')} className="form-label">Category</label>
              <select
                id={fieldId('category')}
                className={fieldClass('category', 'form-select')}
                value={draft.category}
                onChange={(event) => update('category', event.target.value)}
                aria-invalid={Boolean(visibleErrors.category)}
                aria-describedby={describedBy('category')}
              >
                <option value="">Choose a category</option>
                {CATALOG_SUBMISSION_CATEGORIES.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
              {errorFor('category')}
            </div>
          </div>

          <label htmlFor={fieldId('description')} className="form-label">Description</label>
          <textarea
            id={fieldId('description')}
            className={fieldClass('description')}
            rows={3}
            value={draft.description}
            maxLength={CATALOG_SUBMISSION_LIMITS.description}
            onChange={(event) => update('description', event.target.value)}
            aria-invalid={Boolean(visibleErrors.description)}
            aria-describedby={describedBy('description', 'hint')}
          />
          <p id={fieldId('description-hint')} className="submit-server-hint">
            One or two factual sentences: what data or actions the server exposes and how it authenticates.
            {' '}{draft.description.length}/{CATALOG_SUBMISSION_LIMITS.description}
          </p>
          {errorFor('description')}

          <label htmlFor={fieldId('homepageUrl')} className="form-label">Homepage URL</label>
          <input
            id={fieldId('homepageUrl')}
            type="url"
            inputMode="url"
            spellCheck={false}
            className={fieldClass('homepageUrl')}
            placeholder="https://example.com/docs/mcp"
            value={draft.homepageUrl}
            onChange={(event) => update('homepageUrl', event.target.value)}
            aria-invalid={Boolean(visibleErrors.homepageUrl)}
            aria-describedby={describedBy('homepageUrl', 'hint')}
          />
          <p id={fieldId('homepageUrl-hint')} className="submit-server-hint">
            Ideally the publisher page that documents this endpoint.
          </p>
          {errorFor('homepageUrl')}

          <fieldset className="submit-server-fieldset" aria-describedby={describedBy('logoLicense')}>
            <legend className="form-label">Logo</legend>
            {CATALOG_SUBMISSION_LOGO_LICENSES.map((option) => (
              <div className="form-check submit-server-choice" key={option.value}>
                <input
                  id={fieldId(`logo-${option.value}`)}
                  className="form-check-input"
                  type="radio"
                  name={fieldId('logoLicense')}
                  value={option.value}
                  checked={draft.logoLicense === option.value}
                  onChange={() => setDraft((current) => ({
                    ...current,
                    logoLicense: option.value,
                    logoUrl: option.value === 'none' ? '' : current.logoUrl,
                  }))}
                />
                <label className="form-check-label" htmlFor={fieldId(`logo-${option.value}`)}>{option.label}</label>
              </div>
            ))}
            {errorFor('logoLicense')}
          </fieldset>
          {draft.logoLicense && draft.logoLicense !== 'none' && (
            <>
              <label htmlFor={fieldId('logoUrl')} className="form-label">Logo URL</label>
              <input
                id={fieldId('logoUrl')}
                type="url"
                inputMode="url"
                spellCheck={false}
                className={fieldClass('logoUrl')}
                placeholder={draft.logoLicense === 'simple-icons'
                  ? 'https://github.com/simple-icons/simple-icons/blob/16.35.0/icons/example.svg'
                  : 'https://example.com/brand/logo.svg'}
                value={draft.logoUrl}
                onChange={(event) => update('logoUrl', event.target.value)}
                aria-invalid={Boolean(visibleErrors.logoUrl)}
                aria-describedby={describedBy('logoUrl', 'hint')}
              />
              <p id={fieldId('logoUrl-hint')} className="submit-server-hint">
                A square SVG or a transparent 128–512 px PNG under 256 KB. If it fails the asset checks, a generated monogram is used instead.
              </p>
            </>
          )}
          {errorFor('logoUrl')}

          <label htmlFor={fieldId('contactEmail')} className="form-label">Contact email (optional)</label>
          <input
            id={fieldId('contactEmail')}
            type="email"
            autoComplete="email"
            className={fieldClass('contactEmail')}
            value={draft.contactEmail}
            maxLength={CATALOG_SUBMISSION_LIMITS.email}
            onChange={(event) => update('contactEmail', event.target.value)}
            aria-invalid={Boolean(visibleErrors.contactEmail)}
            aria-describedby={describedBy('contactEmail', 'hint')}
          />
          <p id={fieldId('contactEmail-hint')} className="submit-server-hint">
            Lets a maintainer reach you about this listing. It is never added to the catalog or shown on mcptest.io,
            but it appears in the pull request description, which is public on GitHub.
          </p>
          {errorFor('contactEmail')}

          <div className="form-check submit-server-choice submit-server-confirm">
            <input
              id={fieldId('authorized')}
              className={fieldClass('authorized', 'form-check-input')}
              type="checkbox"
              checked={draft.authorized}
              onChange={(event) => update('authorized', event.target.checked)}
              aria-invalid={Boolean(visibleErrors.authorized)}
              aria-describedby={describedBy('authorized')}
            />
            <label className="form-check-label" htmlFor={fieldId('authorized')}>
              I am authorized to list this server, and the endpoint is meant to be used by the public.
            </label>
          </div>
          {errorFor('authorized')}
        </section>

        {turnstileSiteKey && <div className="submit-server-turnstile" ref={turnstile.containerRef} />}

        {submitError && (
          <div className="alert alert-danger" role="alert">
            <p className="mb-0">{submitError.message}</p>
            {submitError.catalogId && (
              <p className="mb-0 mt-1"><a href={`/servers/${encodeURIComponent(submitError.catalogId)}`}>Open the existing listing</a></p>
            )}
            {submitError.details && (
              <ul className="mb-0 mt-1">
                {submitError.details.map((detail) => <li key={detail}>{detail}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="submit-server-actions">
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {submitting ? 'Submitting…' : 'Submit for review'}
          </button>
          <p id={fieldId('gate')} className="submit-server-hint mb-0">
            {gateMessage || 'The check result is attached to the submission as evidence.'}
          </p>
        </div>
        <p className="submit-server-hint">
          Prefer a pull request? The <a href={CATALOG_SUBMISSION_DOCS_URL} target="_blank" rel="noopener noreferrer">submission guide<span className="visually-hidden"> (opens in a new tab)</span></a> also
          describes the manual path.
        </p>
      </form>
    </div>
  );
};

export default SubmitServerView;
