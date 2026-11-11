import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ConnectorDirectoryPreflight from './ConnectorDirectoryPreflight';
import { evaluateConnectorDirectoryPreflight } from '../utils/connectorDirectoryPreflight';
import { analyzeToolSurface } from '../utils/toolSurfaceAnalysis';

const preflight = () => {
  const analysis = analyzeToolSurface({
    tools: [{
      name: 'manage_tickets',
      description: 'Manage Acme tickets.',
      inputSchema: { type: 'object', properties: { action: { enum: ['list', 'create', 'delete'] } } },
    }],
    resources: [],
    prompts: [],
  });
  return evaluateConnectorDirectoryPreflight({
    endpointUrl: 'https://mcp.acme-tools.dev/mcp',
    reachable: true,
    authorization: {
      requirement: 'none',
      schemes: [],
      protectedResourceMetadata: 'unknown',
      authorizationServerMetadata: 'unknown',
      pkceS256: 'unknown',
    },
    tools: { annotations: analysis.toolAnnotations, definitions: analysis.toolDefinitions },
  });
};

describe('ConnectorDirectoryPreflight', () => {
  it('renders both directory checklists with source links, manual items, and the advisory', () => {
    const html = renderToStaticMarkup(<ConnectorDirectoryPreflight preflight={preflight()} />);

    expect(html).toContain('Connector directory preflight');
    expect(html).toContain('Claude Connectors Directory');
    expect(html).toContain('ChatGPT Directory');
    expect(html).toContain('href="/learn/mcp-connector-directory-requirements"');
    expect(html).toContain('href="https://claude.com/docs/connectors/building/review-criteria#provide-tool-annotations"');
    expect(html).toContain('href="https://developers.openai.com/plugins/plugin-guidelines#correct-annotation"');
    expect(html).toContain('directory-preflight__item--fail');
    expect(html).toContain('<code>manage_tickets</code>');
    expect(html).toMatch(/Manual checklist \(\d+\)/);
    expect(html).toContain('Published privacy policy');
    expect(html).toContain('Tool may multiplex several operations behind one argument');
    expect(html).toContain('Advisory');
  });
});
