import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ToolListConsistencyV1 } from '../types/toolListConsistency';
import { toolListConsistencyFromSections } from '../utils/toolListConsistencyReport';
import ToolListConsistencyPanel from './ToolListConsistencyPanel';

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

const render = (result: ToolListConsistencyV1 | undefined): HTMLElement => {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<ToolListConsistencyPanel result={result} />));
  return container;
};

const base: ToolListConsistencyV1 = {
  version: 1,
  status: 'consistent',
  authentication: 'unauthenticated',
  route: 'direct',
  transportType: 'streamable-http',
  requestedSamples: 3,
  distinctHashes: 1,
  differences: [],
  samples: [1, 2, 3].map((index) => ({
    index, connection: index === 1 ? 'evaluation' : 'fresh', status: 'complete', hash: `sha256:${'a'.repeat(64)}`, toolCount: 2,
  })),
};

describe('ToolListConsistencyPanel', () => {
  it('shows a consistent list as a passed check', () => {
    const container = render(base);
    expect(container.querySelector('[data-status="consistent"]')).not.toBeNull();
    expect(container.textContent).toContain('Passed');
    expect(container.textContent).toContain('tools/list returned identical definitions on 3 of 3 requests (unauthenticated)');
  });

  it('lists differing tools, instance headers and the CORS note for a finding', () => {
    const container = render({
      ...base,
      status: 'inconsistent',
      distinctHashes: 2,
      headerNote: 'CORS hides response headers the server does not list in Access-Control-Expose-Headers.',
      samples: [
        { ...base.samples[0], instanceHeaders: { 'cf-ray': 'abc-AMS' } },
        { ...base.samples[1], hash: `sha256:${'b'.repeat(64)}`, toolCount: 1 },
      ],
      differences: [{ tool: 'fetch', kind: 'presence', presentIn: [1], absentIn: [2], changedFields: [] }],
    });
    expect(container.textContent).toContain('Tool list is not deterministic (likely mixed deploy or stale replica)');
    expect(container.textContent).toContain('fetch: listed by request 1, missing from request 2');
    expect(container.textContent).toContain('cf-ray: abc-AMS');
    expect(container.textContent).toContain('CORS hides response headers');
  });

  it('explains a check that was not performed and renders nothing without a result', () => {
    expect(render({ ...base, status: 'not-checked', samples: [], notCheckedReason: 'The first tools/list did not complete.' }).textContent)
      .toContain('The first tools/list did not complete.');
    act(() => root?.unmount());
    root = undefined;
    expect(render(undefined).textContent).toBe('');
  });

  it('renders nothing for report evidence with null samples instead of throwing', () => {
    const sections = [{ evidence: [{ metadata: { toolListConsistency: {
      version: 1, status: 'consistent', samples: [null], differences: [],
    } } }] }];
    let container: HTMLElement | undefined;
    expect(() => { container = render(toolListConsistencyFromSections(sections)); }).not.toThrow();
    expect(container?.textContent).toBe('');
  });
});
