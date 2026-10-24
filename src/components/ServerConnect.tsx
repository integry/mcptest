import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CatalogServer } from '../types/catalog';
import { trackEvent } from '../utils/analytics';
import { formatCatalogTransport } from '../utils/catalogSeo';
import {
  SERVER_CONNECT_TITLE_ID,
  createServerConnectModel,
  splitInlineCode,
  type ServerConnectClient,
} from '../utils/serverConnect';
import { CLIENT_COMPATIBILITY_DATA_URL } from '../content/compatMatrix';

interface ServerConnectProps {
  server: CatalogServer;
}

const AGENT_PROMPT_ID = 'server-connect-agent-prompt';

const InlineCode: React.FC<{ text: string }> = ({ text }) => (
  <>{splitInlineCode(text).map((part, index) => (part.code ? <code key={index}>{part.text}</code> : part.text))}</>
);

/** A client's guide on mcptest stays in the app; vendor documentation is an ordinary link. */
const ClientLink: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  href.startsWith('/') ? <Link to={href}>{children}</Link> : <a href={href}>{children}</a>
);

const Notes: React.FC<{ notes: string[] }> = ({ notes }) => (
  notes.length ? (
    <ul className="client-setup-notes">
      {notes.map((note, index) => <li key={index}>{note}</li>)}
    </ul>
  ) : null
);

interface CopyButtonProps {
  sourceId: string;
  label: string;
  ariaLabel: string;
  className: string;
  copied: boolean;
  onCopy: () => void;
}

/** Same element the prerendered page has, so a click before the mount and after it look alike. */
const CopyButton: React.FC<CopyButtonProps> = ({ sourceId, label, ariaLabel, className, copied, onCopy }) => (
  <button
    type="button"
    className={`btn btn-sm ${className}`}
    data-copy-from={sourceId}
    data-copy-label={label}
    aria-label={ariaLabel}
    onClick={onCopy}
  >
    <i className={`bi ${copied ? 'bi-check-lg' : 'bi-copy'}`} aria-hidden="true"></i>
    <span>{copied ? 'Copied' : label}</span>
  </button>
);

/**
 * "Connect it" on a server page (issue #444): the agent prompt, per-client
 * setup behind a radio switcher that also works in the prerendered page with
 * CSS alone, and a compatibility row per client. scripts/content/catalogPages.js
 * renders the same markup from the same model.
 */
const ServerConnect: React.FC<ServerConnectProps> = ({ server }) => {
  const model = useMemo(() => createServerConnectModel(server), [server]);
  const [selectedId, setSelectedId] = useState(model.clients[0]?.id);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const { endpoint } = model;

  const copy = async (sourceId: string, text: string, label: string, target: string) => {
    if (!navigator.clipboard?.writeText) {
      setCopyStatus(`Clipboard access is unavailable. Select the ${label} text and copy it manually.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      trackEvent('server_setup_copied', { server_id: server.id, target });
      setCopiedId(sourceId);
      setCopyStatus(`${label} copied.`);
      window.setTimeout(() => setCopiedId((current) => (current === sourceId ? null : current)), 2000);
    } catch {
      setCopyStatus(`Could not copy the ${label}. Select the text and copy it manually.`);
    }
  };

  const renderSetup = (client: ServerConnectClient) => {
    const { setup } = client;
    if (setup.kind === 'snippet') {
      const sourceId = `server-connect-setup-${client.id}`;
      return (
        <>
          <p className="server-connect-location">{setup.location}</p>
          <div className="client-setup-code-wrap">
            <pre id={sourceId} tabIndex={0} aria-label={`${client.label} configuration`}><code>{setup.copyText}</code></pre>
            <CopyButton
              sourceId={sourceId}
              label="Copy"
              ariaLabel={`Copy ${client.label} setup`}
              className="btn-ghost client-setup-copy"
              copied={copiedId === sourceId}
              onCopy={() => copy(sourceId, setup.copyText, `${client.label} setup`, client.id)}
            />
          </div>
          <Notes notes={setup.notes} />
        </>
      );
    }
    if (setup.kind === 'unavailable') {
      return (
        <>
          <p className="server-connect-location">{setup.location}</p>
          <div className="alert alert-warning client-setup-unsupported" role="note">
            <strong>Setup unavailable</strong>
            <p className="mb-0">{setup.text}</p>
          </div>
          <Notes notes={setup.notes} />
        </>
      );
    }
    return (
      <>
        <p className="server-connect-location">Add the endpoint above in {client.label}:</p>
        <ul className="client-setup-notes">
          {setup.surfaces.map((text, index) => <li key={index}><InlineCode text={text} /></li>)}
        </ul>
      </>
    );
  };

  return (
    <section className="card server-profile-section server-connect" aria-labelledby={SERVER_CONNECT_TITLE_ID}>
      <div className="card-body">
        <div className="server-section-heading">
          <span className="server-section-icon"><i className="bi bi-plug" aria-hidden="true"></i></span>
          <div><h2 id={SERVER_CONNECT_TITLE_ID}>Connect it</h2></div>
        </div>
        <p className="server-connect-lede">
          {endpoint.provenanceLabel}: <code className="technical-string technical-string-url technical-string-inline">{endpoint.url}</code>
          {' · '}{formatCatalogTransport(endpoint.transport)}. {model.authSummary}
        </p>

        <div className="server-connect-agent">
          <CopyButton
            sourceId={AGENT_PROMPT_ID}
            label="Copy as agent prompt"
            ariaLabel="Copy as agent prompt"
            className="btn-ghost server-connect-agent-copy"
            copied={copiedId === AGENT_PROMPT_ID}
            onCopy={() => copy(AGENT_PROMPT_ID, model.agentPrompt, 'agent prompt', 'agent_prompt')}
          />
          <details className="server-connect-agent-details">
            <summary>Agent prompt for Claude Code or Codex</summary>
            <pre id={AGENT_PROMPT_ID} tabIndex={0}>{model.agentPrompt}</pre>
          </details>
        </div>

        <fieldset className="server-connect-switch" data-carry-choice="">
          <legend className="visually-hidden">MCP client</legend>
          {model.clients.map((client) => (
            <React.Fragment key={client.id}>
              <input
                type="radio"
                name="server-connect-client"
                id={`connect-${client.id}`}
                checked={client.id === selectedId}
                onChange={() => setSelectedId(client.id)}
              />
              <label htmlFor={`connect-${client.id}`}>{client.label}</label>
            </React.Fragment>
          ))}
        </fieldset>
        {model.clients.map((client) => (
          <section key={client.id} className="server-connect-panel" data-client={client.id}>
            <h3>{client.heading}</h3>
            {renderSetup(client)}
          </section>
        ))}

        {model.sharedNotes.length > 0 && (
          <>
            <h3 className="server-connect-subheading">Notes for every client</h3>
            <Notes notes={model.sharedNotes} />
          </>
        )}

        <h3 className="server-connect-subheading">Client compatibility</h3>
        <table className="server-connect-compat">
          <thead><tr><th scope="col">Client</th><th scope="col">Status</th><th scope="col">Why</th></tr></thead>
          <tbody>
            {model.clients.map((client) => (
              <tr key={client.id}>
                <th scope="row"><ClientLink href={client.href}>{client.label}</ClientLink></th>
                <td data-level={client.compatibility.level}>{client.compatibility.label}</td>
                <td>{client.compatibility.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="server-connect-footnote">
          Computed from this server&apos;s validated transport, protocol and authentication against{' '}
          <a href={CLIENT_COMPATIBILITY_DATA_URL}>documented client support</a>. Checks the catalog has not observed are not counted.
        </p>

        <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
          {copyStatus}
        </div>
      </div>
    </section>
  );
};

export default ServerConnect;
