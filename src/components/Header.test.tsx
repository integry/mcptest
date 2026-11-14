import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEADER_COPY } from '../content/navigationLinks';

const auth = vi.hoisted(() => ({
  state: { currentUser: null as null | { displayName: string; photoURL: string | null }, loading: false },
  loginWithGoogle: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ ...auth.state, loginWithGoogle: auth.loginWithGoogle, logout: auth.logout }),
}));

import Header, { MOBILE_DRAWER_ID } from './Header';

describe('Header', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  let root: Root | undefined;
  let host: HTMLDivElement;

  beforeEach(() => {
    auth.state = { currentUser: null, loading: false };
    vi.stubEnv('VITE_FIREBASE_AUTH_ENABLED', 'true');
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    host.remove();
    document.body.classList.remove('menu-open');
    vi.unstubAllEnvs();
  });

  const mount = () => {
    root = createRoot(host);
    act(() => root!.render(
      <MemoryRouter>
        <Header theme="light" onToggleTheme={vi.fn()} />
      </MemoryRouter>
    ));
  };

  it('describes the product and names the theme toggle', () => {
    mount();
    expect(host.querySelector('.app-brand-subtitle')?.textContent?.trim()).toBe(HEADER_COPY.descriptor);
    const theme = host.querySelector<HTMLButtonElement>('.app-theme-toggle')!;
    expect(theme.getAttribute('aria-label')).toBe('Toggle color theme');
    expect(theme.title).toBe('Switch to dark mode');
    expect(theme.querySelector('i')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('explains that signing in is optional and what it adds', () => {
    mount();
    const button = Array.from(host.querySelectorAll('button')).find(element => element.textContent === HEADER_COPY.signIn)!;
    const hint = host.querySelector(`#${button.getAttribute('aria-describedby')}`)!;

    expect(hint.textContent).toContain(HEADER_COPY.signInDescription);
    expect(hint.querySelector('[aria-hidden="true"]')?.textContent).toBe(HEADER_COPY.signInHint);
    expect(button.title).toBe(HEADER_COPY.signInDescription);
    // Only what the code does with a signed-in user: account sync and the proxy allowance.
    expect(HEADER_COPY.signInDescription).toMatch(/^Optional\. Testing works without an account\./);
    expect(HEADER_COPY.signInDescription).toContain('dashboards and connection tabs');
    expect(HEADER_COPY.signInDescription).toContain('CORS proxy rate limit');

    act(() => button.click());
    expect(auth.loginWithGoogle).toHaveBeenCalledTimes(1);
  });

  it('drops the sign-in note once signed in', () => {
    auth.state = { currentUser: { displayName: 'Ada', photoURL: null }, loading: false };
    mount();
    expect(host.querySelector('.app-auth-hint')).toBeNull();
    expect(host.textContent).toContain('Logout');
  });

  it('reports the mobile drawer state on the hamburger', async () => {
    mount();
    const hamburger = host.querySelector<HTMLButtonElement>('.mobile-menu-toggle')!;
    expect(hamburger.getAttribute('aria-controls')).toBe(MOBILE_DRAWER_ID);
    expect(hamburger.getAttribute('aria-expanded')).toBe('false');

    await act(async () => {
      hamburger.click();
      await Promise.resolve();
    });
    expect(document.body.classList).toContain('menu-open');
    expect(hamburger.getAttribute('aria-expanded')).toBe('true');

    await act(async () => {
      document.body.classList.remove('menu-open');
      await Promise.resolve();
    });
    expect(hamburger.getAttribute('aria-expanded')).toBe('false');
  });
});
