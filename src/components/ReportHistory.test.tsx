import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EvaluationReport } from '../utils/evaluation';
import { createReportSnapshot } from '../utils/reportHistory';
import { analyzeToolSurface } from '../utils/toolSurfaceAnalysis';
import ReportHistory from './ReportHistory';

const report = (transport: 'streamable-http' | 'legacy-sse'): EvaluationReport => ({
  serverUrl: 'https://history-ui.example/mcp',
  outcome: 'scored',
  finalScore: transport === 'streamable-http' ? 55 : 46,
  toolSurfaceAnalysis: analyzeToolSurface([{
    name: 'search', description: 'Search records.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  }]),
  sections: {
    protocol: {
      name: 'Protocol', description: 'Protocol', score: 15, maxScore: 15,
      details: [{ text: 'Negotiated', metadata: {
        protocolEra: 'modern', protocolVersion: '2026-07-28',
        endpoint: 'https://history-ui.example/mcp', route: 'direct',
      } }],
    },
    capabilities: {
      name: 'Capabilities', description: 'Capabilities', score: 10, maxScore: 10,
      details: [{ text: 'Tools', metadata: { method: 'tools/list', itemCount: 1 } }],
    },
    transport: {
      name: 'Transport', description: 'Transport',
      score: transport === 'streamable-http' ? 15 : 6, maxScore: 15,
      details: [{ text: 'Connected', metadata: { transportType: transport } }],
    },
    performance: {
      name: 'Performance', description: 'Performance', score: 15, maxScore: 15,
      details: [{ text: 'Fast', metadata: { durationMs: 200 } }],
    },
  },
});

describe('ReportHistory', () => {
  it('renders a readable prioritized diff with export and isolated delete controls', () => {
    const older = createReportSnapshot(
      report('streamable-http'), undefined, '2026-08-11T20:00:00.000Z'
    );
    const newer = createReportSnapshot(
      report('legacy-sse'), undefined, '2026-08-11T20:01:00.000Z'
    );
    const markup = renderToStaticMarkup(
      <ReportHistory
        endpoint="https://history-ui.example/mcp"
        snapshots={[newer, older]}
        onDeleteSnapshot={() => undefined}
        onDeleteAll={() => undefined}
        onExportAll={() => undefined}
      />
    );
    const container = document.createElement('div');
    container.innerHTML = markup;

    expect(container.textContent).toContain('Report history');
    expect(container.textContent).toContain('Transport changed');
    expect(container.textContent).toContain('Breaking · transport');
    expect(container.textContent).toContain('Evaluation score changed');
    expect(container.textContent).toContain('Export history');
    expect(container.textContent).toContain('Delete all history');
    expect(container.textContent).toContain('Delete snapshot');
    expect(container.textContent?.indexOf('Transport changed')).toBeLessThan(
      container.textContent?.indexOf('Evaluation score changed') || 0
    );
  });

  it('renders global controls without an endpoint-specific timeline', () => {
    const snapshot = createReportSnapshot(
      report('streamable-http'), undefined, '2026-08-11T20:00:00.000Z'
    );
    const markup = renderToStaticMarkup(
      <ReportHistory
        snapshots={[snapshot]}
        onDeleteSnapshot={() => undefined}
        onDeleteAll={() => undefined}
        onExportAll={() => undefined}
      />
    );
    const container = document.createElement('div');
    container.innerHTML = markup;

    expect(container.textContent).toContain('Report history');
    expect(container.textContent).toContain('Export history');
    expect(container.textContent).toContain('Delete all history');
    expect(container.textContent).not.toContain('Delete snapshot');
  });
});
