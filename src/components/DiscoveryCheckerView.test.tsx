import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import DiscoveryCheckerView from './DiscoveryCheckerView';
import { DISCOVERY_COPY } from '../content/discoveryCopy';
import type { DiscoveryFetch, DiscoveryResponse } from '../utils/mcpDiscovery';
import { SERVER_CARD_SCHEMA_URL } from '../utils/serverCardValidation';

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

const CARD = {
  $schema: SERVER_CARD_SCHEMA_URL,
  name: 'com.example/weather',
  version: '1.0.0',
  description: 'Weather forecasts.',
  remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }],
};

const fixtureFetch = (documents: Record<string, unknown>): DiscoveryFetch => vi.fn(async (url: string): Promise<DiscoveryResponse> => (
  url in documents
    ? { url, status: 200, contentType: 'application/json', body: JSON.stringify(documents[url]), route: 'direct' }
    : { url, status: 404, contentType: 'text/plain', body: 'Not found', route: 'direct' }
));

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
};

const render = (fetchDocument: DiscoveryFetch, initialEntry = '/tools/discovery') => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/tools/discovery" element={<DiscoveryCheckerView fetchDocument={fetchDocument} catalog={[]} proxyUrl="https://proxy.test" />} />
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    );
  });
  return container;
};

const settle = async () => {
  for (let index = 0; index < 20; index += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
};

const type = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('DiscoveryCheckerView', () => {
  it('checks the domain in the URL and links each endpoint to the inspector', async () => {
    const fetchDocument = fixtureFetch({ 'https://example.com/.well-known/mcp/server-card.json': CARD });
    const container = render(fetchDocument, '/tools/discovery?domain=example.com');
    await settle();

    expect(container.querySelector('h2')?.textContent).toBe('1 MCP endpoint on example.com');
    const inspector = [...container.querySelectorAll('a')].find(link => link.textContent?.includes('Test in inspector'));
    expect(inspector?.getAttribute('href')).toBe('/server/https://example.com/mcp/mcp');

    const row = container.querySelector('[data-testid="discovery-row-well-known-server-card"]')!;
    expect(row.getAttribute('data-status')).toBe('found');
    expect(row.querySelector('.discovery-status')?.textContent).toBe('Found');
    expect(row.querySelector('.discovery-row-url code')?.textContent).toBe('https://example.com/.well-known/mcp/server-card.json');
    expect(container.querySelector('[data-testid="discovery-row-ai-catalog"]')?.getAttribute('data-status')).toBe('not-found');
    expect(container.querySelector('.discovery-fix')).toBeNull();
  });

  it('puts a submitted domain in the URL and shows fix guidance when no card is found', async () => {
    const fetchDocument = fixtureFetch({});
    const container = render(fetchDocument);
    const input = container.querySelector('input')!;
    type(input, 'https://Example.org/some/path');
    act(() => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/tools/discovery?domain=example.org');
    expect(input.value).toBe('example.org');
    const fix = container.querySelector('.discovery-fix')!;
    expect(fix.querySelector('h2')?.textContent).toBe('Publish a Server Card for example.org');
    expect(fix.textContent).toContain('https://example.org/mcp/server-card');
    expect(fix.textContent).toContain('Content-Type: application/mcp-server-card+json');
    expect(JSON.parse(fix.querySelector('pre')!.textContent!)).toMatchObject({ $schema: SERVER_CARD_SCHEMA_URL, name: 'org.example/mcp' });
  });

  it('explains an invalid domain without checking anything', () => {
    const fetchDocument = fixtureFetch({});
    const container = render(fetchDocument);
    type(container.querySelector('input')!, 'intranet');
    act(() => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('.invalid-feedback')?.textContent).toBe('intranet is not a public domain name.');
    expect(fetchDocument).not.toHaveBeenCalled();
  });

  it('renders the first screen the prerendered shell mirrors', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/tools/discovery']}>
        <DiscoveryCheckerView fetchDocument={fixtureFetch({})} catalog={[]} proxyUrl="https://proxy.test" />
      </MemoryRouter>
    );
    for (const text of [DISCOVERY_COPY.heading, DISCOVERY_COPY.inputLabel, DISCOVERY_COPY.submit, DISCOVERY_COPY.guideLink]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain(DISCOVERY_COPY.noProxyHint.trim());
  });
});
