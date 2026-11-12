import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardsHome from './DashboardsHome';
import { FIRST_DASHBOARD_NAME } from '../utils/defaultWorkspace';

describe('DashboardsHome', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  let root: Root | undefined;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    host.remove();
  });

  const mount = (props: React.ComponentProps<typeof DashboardsHome>) => {
    root = createRoot(host);
    act(() => root!.render(<MemoryRouter initialEntries={['/space']}><DashboardsHome {...props} /></MemoryRouter>));
  };

  it('explains dashboards to a visitor with none and creates the first one', () => {
    const onCreate = vi.fn();
    mount({ spaces: [], onCreate });

    expect(host.querySelector('h1')?.textContent).toBe('Dashboards');
    expect(host.textContent).toContain('Add to dashboard');
    expect(host.querySelector('.list-group')).toBeNull();
    expect(host.querySelector('a[href="/"]')?.textContent).toBe('Open the Playground');

    const input = host.querySelector<HTMLInputElement>('input')!;
    expect(host.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('Dashboard name');
    expect(input.value).toBe(FIRST_DASHBOARD_NAME);
    act(() => host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    expect(onCreate).toHaveBeenCalledWith(FIRST_DASHBOARD_NAME);
  });

  it('lists existing dashboards and needs a name to create another', () => {
    const onCreate = vi.fn();
    mount({ spaces: [{ id: '1', name: 'Production', cards: [] }], onCreate });

    expect(Array.from(host.querySelectorAll('.list-group a'), link => [link.textContent, link.getAttribute('href')]))
      .toEqual([['Production', '/space/production']]);
    expect(host.querySelector('.list-group')?.textContent).toContain('0 cards');
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(onCreate).not.toHaveBeenCalled();
  });
});
