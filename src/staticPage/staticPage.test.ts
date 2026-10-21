import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/analytics', () => ({
  logPageView: vi.fn(),
  trackEvent: vi.fn(),
  trackGuideLinkClick: vi.fn(() => vi.fn()),
  recordStaticPageEvent: vi.fn(),
}));

import { logPageView, recordStaticPageEvent, trackEvent } from '../utils/analytics';
import { enhanceStaticPage, getDeferredStaticPage, isHandledByStaticPage, snapshotStaticPageState } from './staticPage';

const SHELL = `
  <div class="app-shell seo-shell-fallback" data-deferred-mount data-page-view-title="Learn: Guide" data-guide-slug="guide" data-guide-track="use">
    <header class="app-header">
      <button type="button" class="mobile-menu-toggle" aria-label="Toggle navigation menu"></button>
      <button type="button" class="btn app-theme-toggle" aria-label="Toggle color theme"></button>
    </header>
    <div class="desktop-sidebar">
      <nav id="app-sidenav-desktop" class="app-sidenav">
        <div class="guide-search guide-search--sidebar"><input type="search" class="guide-search-input" aria-keyshortcuts="/"></div>
        <button type="button" class="sidenav-group-toggle" aria-expanded="false" aria-controls="track-use">Use</button>
        <ul id="track-use" hidden><li><a href="/learn/guide">Guide</a></li></ul>
        <button type="button" class="sidenav-collapse-toggle" aria-expanded="true" aria-label="Collapse sidebar" title="Collapse sidebar"><i class="bi bi-chevron-double-left"></i></button>
      </nav>
    </div>
    <article class="reading-article">
      <div class="reading-code"><button type="button" class="reading-code-copy" aria-label="Copy code" title="Copy code"><i class="bi bi-copy"></i><span>Copy</span></button><pre><code>npx mcp
</code></pre></div>
    </article>
  </div>`;

const mountShell = () => {
  document.body.innerHTML = `<div id="root">${SHELL}</div>`;
  const shell = getDeferredStaticPage(document.getElementById('root'))!;
  enhanceStaticPage(shell);
  return shell;
};

describe('static page handlers', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.setAttribute('data-theme', 'light');
    document.body.className = '';
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('recognises only pages the generator marked for a deferred mount', () => {
    document.body.innerHTML = '<div id="root"><div class="app-shell"></div></div>';
    expect(getDeferredStaticPage(document.getElementById('root'))).toBeNull();
    expect(getDeferredStaticPage(null)).toBeNull();
    expect(mountShell()).toBeInstanceOf(HTMLElement);
  });

  it('reports the page view and guide view once, for the app to skip', () => {
    mountShell();
    expect(logPageView).toHaveBeenCalledWith('/', 'Learn: Guide');
    expect(trackEvent).toHaveBeenCalledWith('guide_view', { slug: 'guide', track: 'use' });
    expect(recordStaticPageEvent).toHaveBeenCalledWith('page_view:/');
    expect(recordStaticPageEvent).toHaveBeenCalledWith('guide_view:guide');
  });

  it('toggles and stores the theme', () => {
    const shell = mountShell();
    const toggle = shell.querySelector<HTMLButtonElement>('.app-theme-toggle')!;
    toggle.click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(isHandledByStaticPage(toggle)).toBe(true);
  });

  it('opens and closes sidebar groups', () => {
    const shell = mountShell();
    const toggle = shell.querySelector<HTMLButtonElement>('.sidenav-group-toggle')!;
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(shell.querySelector('#track-use')!.hasAttribute('hidden')).toBe(false);
    toggle.click();
    expect(shell.querySelector('#track-use')!.hasAttribute('hidden')).toBe(true);
  });

  it('collapses the sidebar as the app does and remembers it', () => {
    const shell = mountShell();
    shell.querySelector<HTMLButtonElement>('.sidenav-group-toggle')!.click();
    shell.querySelector<HTMLButtonElement>('.sidenav-collapse-toggle')!.click();

    expect(localStorage.getItem('mcpSidebarCollapsed')).toBe('true');
    expect(document.body.classList.contains('sidenav-collapsed')).toBe(true);
    expect(shell.querySelector('.app-sidenav')!.classList.contains('app-sidenav--collapsed')).toBe(true);
    expect(shell.querySelector('.sidenav-collapse-toggle')!.getAttribute('aria-label')).toBe('Expand sidebar');
    expect(shell.querySelector<HTMLElement>('.guide-search--sidebar')!.hidden).toBe(true);
    expect(shell.querySelector('#track-use')!.hasAttribute('hidden')).toBe(true);

    // Expanding restores the group that was open.
    shell.querySelector<HTMLButtonElement>('.sidenav-collapse-toggle')!.click();
    expect(shell.querySelector('#track-use')!.hasAttribute('hidden')).toBe(false);
  });

  it('carries no group state into a collapsed app sidebar, whose toggles would expand it', () => {
    const shell = mountShell();
    shell.querySelector<HTMLButtonElement>('.sidenav-group-toggle')!.click();
    shell.querySelector<HTMLButtonElement>('.sidenav-collapse-toggle')!.click();
    const root = document.getElementById('root')!;
    const restore = snapshotStaticPageState(root);

    root.innerHTML = '<button type="button" class="sidenav-group-toggle" aria-expanded="false" aria-controls="track-use"></button>';
    const appToggle = vi.fn();
    root.querySelector('button')!.addEventListener('click', appToggle);
    restore();
    expect(appToggle).not.toHaveBeenCalled();
  });

  it('starts collapsed when the visitor collapsed the sidebar before', () => {
    localStorage.setItem('mcpSidebarCollapsed', 'true');
    const shell = mountShell();
    expect(document.body.classList.contains('sidenav-collapsed')).toBe(true);
    expect(shell.querySelector('.sidenav-collapse-toggle')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('leaves the mobile menu to the app, which the same tap mounts', () => {
    const shell = mountShell();
    const toggle = shell.querySelector<HTMLButtonElement>('.mobile-menu-toggle')!;
    toggle.click();
    expect(document.body.classList.contains('menu-open')).toBe(false);
    expect(isHandledByStaticPage(toggle)).toBe(false);
  });

  it('copies code like the app’s code blocks', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const shell = mountShell();
    const button = shell.querySelector<HTMLButtonElement>('.reading-code-copy')!;
    button.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('npx mcp');
    expect(button.getAttribute('aria-label')).toBe('Code copied');
    expect(button.textContent).toBe('Copied');
    expect(isHandledByStaticPage(button)).toBe(true);
  });
});
