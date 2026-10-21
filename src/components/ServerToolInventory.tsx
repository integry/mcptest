import React from 'react';
import type {
  CapabilityInventoryArgumentV1,
  CapabilityInventorySectionV1,
  CapabilityInventoryV1,
} from '../types/capabilityInventory';
import type { CatalogServer } from '../types/catalog';
import {
  formatArgumentSignature,
  formatInputSummary,
  formatOutputSchemaPresence,
  formatSnapshotDate,
  getMissingInventoryNotice,
} from '../utils/toolInventory';
import './ServerToolInventory.css';

interface ServerToolInventoryProps {
  server: CatalogServer;
}

const sectionNote = <T,>(section: CapabilityInventorySectionV1<T>): string | undefined => {
  if (section.status === 'partial' && !section.paginationComplete) {
    return `Partial listing: ${section.retainedCount} of ${section.observedCount} shown; more may exist.`;
  }
  if (section.omittedCount > 0) {
    return `${section.retainedCount} of ${section.observedCount} shown; ${section.omittedCount} omitted to keep the page bounded.`;
  }
  if (section.status === 'partial') return 'Some details were sanitized for public display.';
  return undefined;
};

const ParameterList: React.FC<{ parameters: CapabilityInventoryArgumentV1[] }> = ({ parameters }) => (
  <ul className="server-tool-parameters">
    {parameters.map((parameter) => (
      <li key={parameter.name}>
        <code>{formatArgumentSignature(parameter)}</code>
        <span>{parameter.required ? 'required' : 'optional'}</span>
        {parameter.description && <p>{parameter.description}</p>}
      </li>
    ))}
  </ul>
);

const InputSchema: React.FC<{ parameters?: CapabilityInventoryArgumentV1[]; label: string }> = ({
  parameters,
  label,
}) => (parameters?.length ? (
  <details className="server-tool-schema">
    <summary>
      <span className="server-tool-schema-label">{label}</span>{' '}
      <code>{formatInputSummary(parameters)}</code>
    </summary>
    <ParameterList parameters={parameters} />
  </details>
) : (
  <p className="server-tool-schema server-tool-schema--empty">
    <span className="server-tool-schema-label">{label}</span> No parameters
  </p>
));

const SectionHeading: React.FC<{ id: string; label: string; section: CapabilityInventorySectionV1<unknown> }> = ({
  id,
  label,
  section,
}) => {
  const note = sectionNote(section);
  return (
    <>
      <h3 id={id} className="server-tool-inventory-heading">
        {label} <span className="server-tool-inventory-count">{section.observedCount}</span>
      </h3>
      {note && <p className="server-tool-inventory-note">{note}</p>}
    </>
  );
};

const InventoryBody: React.FC<{ inventory: CapabilityInventoryV1; serverName: string }> = ({
  inventory,
  serverName,
}) => {
  const resources = [...inventory.resources.items, ...inventory.resourceTemplates.items];
  const resourceSection = {
    ...inventory.resources,
    observedCount: inventory.resources.observedCount + inventory.resourceTemplates.observedCount,
    retainedCount: resources.length,
    omittedCount: inventory.resources.omittedCount + inventory.resourceTemplates.omittedCount,
  };
  return (
    <>
      <p className="server-tool-inventory-provenance">
        What the catalog validator observed on{' '}
        <time dateTime={inventory.observedAt}>{formatSnapshotDate(inventory.observedAt)}</time>
        {' '}at <code className="technical-string technical-string-url technical-string-inline">{inventory.provenance.testedEndpoint}</code>
        {inventory.authentication === 'authenticated' ? ' with credentials' : ' without credentials'}.
        {' '}The live server may have changed since; connect in the Playground for the current list.
      </p>

      <section aria-labelledby="server-tool-inventory-tools">
        <SectionHeading id="server-tool-inventory-tools" label={`Tools provided by ${serverName}`} section={inventory.tools} />
        {inventory.tools.items.length > 0 ? (
          <ul className="server-tool-list">
            {inventory.tools.items.map((tool) => (
              <li key={tool.name} className="server-tool-row">
                <div className="server-tool-title">
                  <code className="server-tool-name">{tool.name}</code>
                  <span className={`server-tool-output${tool.outputSchema ? ' server-tool-output--declared' : ''}`}>
                    {formatOutputSchemaPresence(tool)}
                  </span>
                </div>
                {tool.description && <p className="server-tool-description">{tool.description}</p>}
                <InputSchema parameters={tool.input} label="Input" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="server-tool-inventory-empty">
            {inventory.tools.status === 'unsupported' ? 'This server does not offer tools.' : 'No tools were listed.'}
          </p>
        )}
      </section>

      {resources.length > 0 && (
        <section aria-labelledby="server-tool-inventory-resources">
          <SectionHeading id="server-tool-inventory-resources" label="Resources" section={resourceSection} />
          <ul className="server-tool-list">
            {resources.map((resource, index) => (
              <li key={`${resource.name}-${index}`} className="server-tool-row">
                <div className="server-tool-title">
                  <code className="server-tool-name">{resource.name}</code>
                  {resource.mimeType && <span className="server-tool-output">{resource.mimeType}</span>}
                </div>
                {(resource.title || resource.description) && (
                  <p className="server-tool-description">
                    {[resource.title, resource.description].filter(Boolean).join(' — ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {inventory.prompts.items.length > 0 && (
        <section aria-labelledby="server-tool-inventory-prompts">
          <SectionHeading id="server-tool-inventory-prompts" label="Prompts" section={inventory.prompts} />
          <ul className="server-tool-list">
            {inventory.prompts.items.map((prompt) => (
              <li key={prompt.name} className="server-tool-row">
                <div className="server-tool-title">
                  <code className="server-tool-name">{prompt.name}</code>
                </div>
                {prompt.description && <p className="server-tool-description">{prompt.description}</p>}
                <InputSchema parameters={prompt.arguments} label="Arguments" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
};

/**
 * The server's tools, resources and prompts as the catalog validator last
 * observed them, or why there is no inventory to show.
 */
const ServerToolInventory: React.FC<ServerToolInventoryProps> = ({ server }) => {
  const inventory = server.capabilityInventory;
  const missing = inventory ? undefined : getMissingInventoryNotice(server);
  return (
    <section className="card server-profile-section server-tool-inventory" aria-labelledby="server-tool-inventory-title">
      <div className="card-body">
        <div className="server-section-heading">
          <span className="server-section-icon"><i className="bi bi-tools" aria-hidden="true"></i></span>
          <div>
            <h2 id="server-tool-inventory-title">Tool inventory</h2>
          </div>
        </div>
        {inventory ? (
          <InventoryBody inventory={inventory} serverName={server.name} />
        ) : (
          <div className="server-tool-inventory-missing" role="note">
            <strong>{missing?.title}</strong>
            <p>{missing?.detail}</p>
          </div>
        )}
      </div>
    </section>
  );
};

export default ServerToolInventory;
