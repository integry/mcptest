import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { CatalogServerLogo } from './CatalogServerLogo';

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const renderLogo = (props: React.ComponentProps<typeof CatalogServerLogo>) => {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<CatalogServerLogo {...props} />));
  return { container, root };
};

describe('CatalogServerLogo', () => {
  it('renders a valid local image as decorative beside the product name', () => {
    const { container, root } = renderLogo({
      name: 'Context7',
      logoUrl: '/server-logos/context7.svg',
    });

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/server-logos/context7.svg');
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(container.querySelector('[data-catalog-server-logo]')?.getAttribute('aria-hidden')).toBe('true');
    act(() => root.unmount());
  });

  it('renders deterministic accessible initials when the URL is missing', () => {
    const { container, root } = renderLogo({
      name: 'Example Product',
      decorative: false,
    });

    const fallback = container.querySelector('[data-catalog-server-logo]');
    expect(fallback?.getAttribute('role')).toBe('img');
    expect(fallback?.getAttribute('aria-label')).toBe('Example Product logo');
    expect(container.querySelector('.catalog-server-logo-initials')?.textContent).toBe('EP');
    act(() => root.unmount());
  });

  it('replaces an image with the same fallback after an image error', () => {
    const { container, root } = renderLogo({
      name: 'Broken Image',
      logoUrl: '/server-logos/broken.svg',
    });

    act(() => container.querySelector('img')?.dispatchEvent(new Event('error')));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.catalog-server-logo-initials')?.textContent).toBe('BI');
    act(() => root.unmount());
  });
});
