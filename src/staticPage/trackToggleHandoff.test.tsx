import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/analytics', () => ({
  logPageView: vi.fn(),
  trackEvent: vi.fn(),
  trackGuideLinkClick: vi.fn(() => vi.fn()),
  recordStaticPageEvent: vi.fn(),
}));

import ContentTrackNav from '../components/learn/ContentTrackNav';
import { LEARN_TRACKS } from '../content/navigation';
import { deferMountUntilInput } from './deferredMount';
import { enhanceStaticPage, getDeferredStaticPage, isHandledByStaticPage, snapshotStaticPageState } from './staticPage';

/**
 * The sidebar tracks the visitor opens or closes on a prerendered guide must
 * stay that way when React replaces the page: ContentTrackNav starts from the
 * route's defaults (only the owning track open).
 */
const [owning, other, third] = LEARN_TRACKS;
const pathname = owning.items[0].path;

const sidebar = () => (
  <MemoryRouter initialEntries={[pathname]}>
    <div className="desktop-sidebar">
      <nav id="app-sidenav-desktop" className="app-sidenav">
        <ContentTrackNav />
      </nav>
    </div>
  </MemoryRouter>
);

const toggle = (root: HTMLElement, trackId: string) => root.querySelector<HTMLButtonElement>(`[aria-controls="sidenav-track-${trackId}"]`)!;
const expanded = (root: HTMLElement) => Object.fromEntries(
  LEARN_TRACKS.map(track => [track.id, toggle(root, track.id).getAttribute('aria-expanded') === 'true'])
);

/** A tap: the press starts the download; the click reaches the static handler. */
const tap = (button: HTMLButtonElement) => {
  button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  button.dispatchEvent(new Event('pointerup', { bubbles: true }));
  button.click();
};

// Match bootstrapApp's completion signal: restoration runs after the first
// commit and effects, rather than after an arbitrary number of timer ticks.
const OnCommit = ({ done }: { done: () => void }) => {
  useEffect(done, [done]);
  return null;
};

let reactRoot: Root | null = null;

const setup = ({ commitGate = Promise.resolve() }: { commitGate?: Promise<void> } = {}) => {
  document.body.innerHTML = `<div id="root"><div class="app-shell" data-deferred-mount>${renderToStaticMarkup(sidebar())}</div></div>`;
  const root = document.getElementById('root')!;
  enhanceStaticPage(getDeferredStaticPage(root)!);
  let resolvePrepare: (render: () => Promise<void>) => void = () => {};
  const prepare = () => new Promise<() => Promise<void>>((resolve) => {
    resolvePrepare = resolve;
  });
  deferMountUntilInput({
    root,
    prepare,
    isHandled: isHandledByStaticPage,
    snapshotState: snapshotStaticPageState,
  });
  const ready = () => {
    resolvePrepare(() => new Promise<void>((resolve) => {
      root.innerHTML = '';
      reactRoot = createRoot(root);
      reactRoot.render(
        <React.StrictMode>
          <div className="app-shell">{sidebar()}</div>
          <OnCommit done={() => { void commitGate.then(resolve); }} />
        </React.StrictMode>
      );
    }));
  };
  const runMountTimer = async () => {
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
  };
  const mount = async () => {
    ready();
    await Promise.resolve();
    await runMountTimer();
  };
  return { root, ready, runMountTimer, mount };

};

describe('track toggles across the deferred mount', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => reactRoot?.unmount());
    reactRoot = null;
    document.body.innerHTML = '';
    document.body.className = '';
    localStorage.clear();
    vi.useRealTimers();
  });

  it('keeps the final state of every track toggled before the app loaded', async () => {
    expect(LEARN_TRACKS.length).toBeGreaterThanOrEqual(3);
    const page = setup();
    expect(expanded(page.root)).toMatchObject({ [owning.id]: true, [other.id]: false, [third.id]: false });

    tap(toggle(page.root, other.id));
    tap(toggle(page.root, owning.id));
    // Opened and closed again: ends as the route left it.
    tap(toggle(page.root, third.id));
    tap(toggle(page.root, third.id));
    const chosen = { ...expanded(page.root) };
    expect(chosen).toMatchObject({ [owning.id]: false, [other.id]: true, [third.id]: false });

    await page.mount();
    expect(page.root.querySelector('[data-deferred-mount]')).toBeNull();
    expect(expanded(page.root)).toEqual(chosen);
    expect(document.getElementById(`sidenav-track-${other.id}`)!.hidden).toBe(false);
    expect(document.getElementById(`sidenav-track-${owning.id}`)!.hidden).toBe(true);

    // The app's own toggles keep working from there.
    act(() => toggle(page.root, other.id).click());
    expect(expanded(page.root)[other.id]).toBe(false);
  });

  it('waits if a new press starts after the chunk resolves but before the mount timer runs', async () => {
    const page = setup();
    tap(toggle(page.root, other.id));
    page.ready();
    // The chunk is ready and the idle mount is queued, but has not run yet.
    await Promise.resolve();
    const button = toggle(page.root, owning.id);
    button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await page.runMountTimer();
    expect(page.root.querySelector('[data-deferred-mount]')).not.toBeNull();
    expect(toggle(page.root, owning.id)).toBe(button);

    button.dispatchEvent(new Event('pointerup', { bubbles: true }));
    button.click();
    const chosen = expanded(page.root);
    await page.runMountTimer();
    expect(page.root.querySelector('[data-deferred-mount]')).toBeNull();
    expect(expanded(page.root)).toEqual(chosen);
  });

  it('restores only after the render completion promise resolves', async () => {
    let finishCommit!: () => void;
    const commitGate = new Promise<void>(resolve => { finishCommit = resolve; });
    const page = setup({ commitGate });
    tap(toggle(page.root, other.id));
    tap(toggle(page.root, owning.id));
    const chosen = expanded(page.root);

    await page.mount();
    // DOM replacement alone does not mean the handoff has finished. The old
    // two-timer helper could return at this point and assert route defaults.
    expect(page.root.querySelector('[data-deferred-mount]')).toBeNull();
    expect(expanded(page.root)).toMatchObject({ [owning.id]: true, [other.id]: false });
    await act(async () => { finishCommit(); });
    expect(expanded(page.root)).toEqual(chosen);
  });

});
