import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { getCatalogServers } from '../utils/catalogUtils';
import { CatalogServerCard } from './CatalogServerCard';
import ServerProfileView from './ServerProfileView';
import { SuggestedServersPanel } from './SuggestedServersPanel';

const render = (node: React.ReactNode) => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
  return container;
};

describe('shared catalog server logo consumers', () => {
  const server = getCatalogServers()[0];

  it.each([
    ['CatalogServerCard', () => render(<CatalogServerCard server={server} onTest={vi.fn()} />)],
    ['SuggestedServersPanel', () => render(
      <SuggestedServersPanel
        setServerUrl={vi.fn()}
        handleConnect={vi.fn()}
        isConnected={false}
        isConnecting={false}
      />
    )],
    ['ServerProfileView', () => render(<ServerProfileView server={server} onTestServer={vi.fn()} />)],
  ])('%s renders CatalogServerLogo', (_name, renderConsumer) => {
    const container = renderConsumer();
    const sharedLogo = container.querySelector('[data-catalog-server-logo]');

    expect(sharedLogo).not.toBeNull();
    expect(sharedLogo?.querySelector('img')?.getAttribute('src')).toMatch(/^\/server-logos\//);
  });
});
