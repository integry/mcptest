import React from 'react';
import './ToolSchemaDetails.css';

interface ToolSchemaDetailsProps {
  tool: { inputSchema?: unknown; outputSchema?: unknown } | null | undefined;
}

const SchemaBlock: React.FC<{ title: string; schema: unknown; hint?: string }> = ({ title, schema, hint }) => (
  <details className="tool-schema-details">
    <summary>{title}</summary>
    {hint && <p className="tool-schema-hint">{hint}</p>}
    <div className="event-data">
      <pre><code className="language-json">{JSON.stringify(schema, null, 2)}</code></pre>
    </div>
  </details>
);

/** Input and output contracts for the selected tool, collapsed by default. */
const ToolSchemaDetails: React.FC<ToolSchemaDetailsProps> = ({ tool }) => {
  if (!tool) return null;
  const hasInputSchema = tool.inputSchema !== undefined && tool.inputSchema !== null;
  const hasOutputSchema = tool.outputSchema !== undefined && tool.outputSchema !== null;
  if (!hasInputSchema && !hasOutputSchema) return null;

  return (
    <div className="tool-schemas">
      {hasInputSchema && <SchemaBlock title="Input schema" schema={tool.inputSchema} />}
      {hasOutputSchema && (
        <SchemaBlock
          title="Output schema"
          schema={tool.outputSchema}
          hint="Results are checked against this schema after each run."
        />
      )}
    </div>
  );
};

export default ToolSchemaDetails;
