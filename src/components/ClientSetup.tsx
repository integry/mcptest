import React, { useId, useRef, useState } from 'react';
import type { CatalogServer } from '../types/catalog';
import { generateClientSetups, type ClientSetupId } from '../utils/clientSetup';

interface ClientSetupProps {
  server: CatalogServer;
}

const ClientSetup: React.FC<ClientSetupProps> = ({ server }) => {
  const setups = generateClientSetups(server);
  const [selectedId, setSelectedId] = useState<ClientSetupId>(setups[0].id);
  const [copyStatus, setCopyStatus] = useState('');
  const instanceId = useId().replace(/:/g, '');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectTab = (index: number) => {
    const setup = setups[index];
    if (!setup) return;
    setSelectedId(setup.id);
    setCopyStatus('');
    tabRefs.current[index]?.focus();
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % setups.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + setups.length) % setups.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = setups.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    selectTab(nextIndex);
  };

  const copySetup = async (clientId: ClientSetupId, label: string, copyText: string) => {
    if (!navigator.clipboard?.writeText) {
      setCopyStatus(`Clipboard access is unavailable. Select the ${label} setup text and copy it manually.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(copyText);
      setCopyStatus(`${label} setup copied.`);
    } catch {
      setCopyStatus(`Could not copy the ${label} setup. Select the text and copy it manually.`);
    }
    setSelectedId(clientId);
  };

  return (
    <section className="card server-profile-section client-setup" aria-labelledby={`${instanceId}-title`}>
      <div className="card-body">
        <div className="server-section-heading">
          <span className="server-section-icon"><i className="bi bi-terminal" aria-hidden="true"></i></span>
          <div>
            <h2 id={`${instanceId}-title`}>Connect this server to your client</h2>
          </div>
        </div>

        <div className="client-setup-tabs" role="tablist" aria-label="MCP client setup">
          {setups.map((setup, index) => {
            const selected = setup.id === selectedId;
            return (
              <button
                key={setup.id}
                ref={(element) => { tabRefs.current[index] = element; }}
                type="button"
                role="tab"
                id={`${instanceId}-${setup.id}-tab`}
                aria-controls={`${instanceId}-${setup.id}-panel`}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className={`client-setup-tab${selected ? ' active' : ''}`}
                onClick={() => selectTab(index)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                {setup.label}
              </button>
            );
          })}
        </div>

        {setups.map((setup) => {
          const selected = setup.id === selectedId;
          return (
            <div
              key={setup.id}
              id={`${instanceId}-${setup.id}-panel`}
              role="tabpanel"
              aria-labelledby={`${instanceId}-${setup.id}-tab`}
              hidden={!selected}
              className="client-setup-panel"
            >
              <div className="client-setup-panel-heading">
                <div>
                  <h3>{setup.heading}</h3>
                  <p>{setup.location}</p>
                </div>
              </div>

              {setup.supported ? (
                <div className="client-setup-code-wrap">
                  <pre tabIndex={0} aria-label={`${setup.label} configuration`}><code>{setup.copyText}</code></pre>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost client-setup-copy"
                    onClick={() => copySetup(setup.id, setup.label, setup.copyText)}
                    aria-label={`Copy ${setup.label} setup`}
                  >
                    <i className="bi bi-copy" aria-hidden="true"></i>
                    <span>Copy</span>
                  </button>
                </div>
              ) : (
                <div className="alert alert-warning client-setup-unsupported" role="status">
                  <strong>Setup unavailable</strong>
                  <p className="mb-0">{setup.copyText}</p>
                </div>
              )}

              <p className="client-setup-auth">{setup.authSummary}</p>
              <ul className="client-setup-notes">
                {setup.notes.map((note, index) => <li key={`${setup.id}-${index}`}>{note}</li>)}
              </ul>
              <a href={setup.documentationUrl} target="_blank" rel="noopener noreferrer">
                {setup.documentationLabel} <i className="bi bi-arrow-up-right" aria-hidden="true"></i>
              </a>
            </div>
          );
        })}

        <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
          {copyStatus}
        </div>
      </div>
    </section>
  );
};

export default ClientSetup;
