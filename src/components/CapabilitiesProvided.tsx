import React from 'react';
import type {
  CapabilityInventoryArgumentV1,
  CapabilityInventorySectionV1,
  CapabilityInventoryV1,
} from '../types/capabilityInventory';

interface CapabilitiesProvidedProps {
  inventory: CapabilityInventoryV1;
  serverName?: string;
  titleId: string;
  titleLevel?: 2 | 3;
}

const statusMessage = <T,>(section: CapabilityInventorySectionV1<T>): string => {
  const count = `${section.retainedCount} retained of ${section.observedCount} observed`;
  const omitted = section.omittedCount > 0 ? `; ${section.omittedCount} omitted` : '';
  if (section.status === 'complete') return `Complete discovery: ${count}${omitted}.`;
  if (section.status === 'partial') return `Partial discovery: ${count}${omitted}. More capabilities may exist.`;
  if (section.status === 'unsupported') return 'This server does not support this discovery method.';
  return 'Discovery was unavailable. This does not mean the server provides no capabilities.';
};

const ArgumentList: React.FC<{ arguments: CapabilityInventoryArgumentV1[] }> = ({
  arguments: values,
}) => (
  <ul className="capability-argument-list" aria-label="Safe argument summary">
    {values.map((argument) => (
      <li key={argument.name}>
        <code>{argument.name}</code>
        {argument.type && <span> · {argument.type}</span>}
        <span> · {argument.required ? 'required' : 'optional'}</span>
        {argument.description && <p>{argument.description}</p>}
      </li>
    ))}
  </ul>
);

const CapabilitiesProvided: React.FC<CapabilitiesProvidedProps> = ({
  inventory,
  serverName,
  titleId,
  titleLevel = 3,
}) => {
  const Title = `h${titleLevel}` as 'h2' | 'h3';
  const CategoryTitle = `h${Math.min(6, titleLevel + 1)}` as 'h3' | 'h4';
  const suffix = serverName ? ` provided by ${serverName}` : '';
  const groups = [
    { key: 'tools', label: 'Tools', section: inventory.tools },
    { key: 'resources', label: 'Resources', section: inventory.resources },
    { key: 'resourceTemplates', label: 'Resource templates', section: inventory.resourceTemplates },
    { key: 'prompts', label: 'Prompts', section: inventory.prompts },
  ] as const;

  return (
    <div className="capability-inventory">
      <div className="capability-inventory-heading">
        <Title id={titleId}>Capabilities provided</Title>
        <p>
          Observed <time dateTime={inventory.observedAt}>{new Date(inventory.observedAt).toLocaleString()}</time>
          {' '}at <code>{inventory.provenance.testedEndpoint}</code> via {inventory.provenance.route};
          {' '}{inventory.authentication} discovery.
        </p>
      </div>
      <div className="capability-inventory-grid">
        {groups.map(({ key, label, section }) => (
          <section className="capability-inventory-group" key={key} aria-labelledby={`${titleId}-${key}`}>
            <CategoryTitle id={`${titleId}-${key}`}>{label}{suffix}</CategoryTitle>
            <p className={`capability-inventory-status capability-inventory-status-${section.status}`}>
              {statusMessage(section)}
            </p>
            {section.items.length > 0 && (
              <ul className="capability-inventory-list">
                {section.items.map((item) => (
                  <li key={item.name}>
                    <strong>{item.name}</strong>
                    {'title' in item && item.title && <span className="capability-inventory-title">{item.title}</span>}
                    {'mimeType' in item && item.mimeType && <span className="capability-inventory-mime">{item.mimeType}</span>}
                    {item.description && <p>{item.description}</p>}
                    {'input' in item && item.input && <ArgumentList arguments={item.input} />}
                    {'arguments' in item && item.arguments && <ArgumentList arguments={item.arguments} />}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
};

export default CapabilitiesProvided;
