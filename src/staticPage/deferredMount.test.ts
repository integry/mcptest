import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferMountUntilInput, locateElement, resolveElement } from './deferredMount';

const STATIC_HTML = `
  <div class="app-shell" data-deferred-mount>
    <nav id="app-sidenav-desktop">
      <input type="search" class="guide-search-input" aria-label="Search guides">
      <button type="button" class="sidenav-action" aria-label="Create new dashboard">+</button>
    </nav>
    <div class="main-content" style="height: 100px; overflow: auto"><div style="height: 1000px"></div></div>
  </div>`;

/** The app's markup: the same controls, in other elements, with the drawer in front. */
const APP_HTML = `
  <div class="app-shell">
    <div class="mobile-sidebar"><input type="search" class="guide-search-input" aria-label="Search guides"></div>
    <nav id="app-sidenav-desktop">
      <input type="search" class="guide-search-input" aria-label="Search guides">
      <button type="button" class="sidenav-action" aria-label="Create new dashboard">+</button>
    </nav>
    <div class="main-content" style="height: 100px; overflow: auto"><div style="height: 1000px"></div></div>
  </div>`;

const setup = ({ isHandled }: { isHandled?: (element: Element) => boolean } = {}) => {
  document.body.innerHTML = `<div id="root">${STATIC_HTML}</div>`;
  const root = document.getElementById('root')!;
  const rendered = vi.fn();
  const appInput = vi.fn();
  const appClick = vi.fn();
  const render = vi.fn(async () => {
    root.innerHTML = APP_HTML;
    const input = root.querySelector<HTMLInputElement>('#app-sidenav-desktop .guide-search-input')!;
    input.addEventListener('input', () => appInput(input.value));
    root.querySelector('#app-sidenav-desktop .sidenav-action')!.addEventListener('click', appClick);
    rendered();
  });
  let resolvePrepare: (value: () => Promise<void>) => void = () => {};
  const prepare = vi.fn(() => new Promise<() => Promise<void>>((resolve) => {
    resolvePrepare = resolve;
  }));
  deferMountUntilInput({ root, prepare, isHandled });
  return { root, prepare, render, rendered, appInput, appClick, ready: () => resolvePrepare(render) };
};

const flush = async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
};

describe('deferMountUntilInput', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does nothing until the first input, then loads once', async () => {
    const page = setup();
    await flush();
    expect(page.prepare).not.toHaveBeenCalled();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(page.prepare).toHaveBeenCalledTimes(1);
    page.ready();
    await flush();
    expect(page.rendered).toHaveBeenCalledTimes(1);
  });

  it('waits for the press to end before replacing the page', async () => {
    const page = setup();
    const target = page.root.querySelector('.main-content')!;
    target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    page.ready();
    await flush();
    expect(page.rendered).not.toHaveBeenCalled();

    target.dispatchEvent(new Event('pointerup', { bubbles: true }));
    await flush();
    expect(page.rendered).toHaveBeenCalledTimes(1);
  });

  it('keeps the focused field, its text and caret', async () => {
    const page = setup();
    const input = page.root.querySelector<HTMLInputElement>('.guide-search-input')!;
    input.focus();
    input.value = 'oauth';
    input.setSelectionRange(2, 2);
    page.ready();
    await flush();

    expect(page.rendered).toHaveBeenCalled();
    const appInput = page.root.querySelector<HTMLInputElement>('#app-sidenav-desktop .guide-search-input')!;
    expect(document.activeElement).toBe(appInput);
    expect(appInput.value).toBe('oauth');
    expect(appInput.selectionStart).toBe(2);
    // As typed: the app's own input handler saw the text.
    expect(page.appInput).toHaveBeenCalledWith('oauth');
  });

  it('replays a click no static handler served on the matching app button', async () => {
    const page = setup();
    const button = page.root.querySelector('.sidenav-action')!;
    button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    button.dispatchEvent(new Event('pointerup', { bubbles: true }));
    (button as HTMLButtonElement).click();
    page.ready();
    await flush();

    expect(page.appClick).toHaveBeenCalledTimes(1);
  });

  it('does not replay a click a static handler served', async () => {
    const page = setup({ isHandled: element => element.classList.contains('sidenav-action') });
    const button = page.root.querySelector<HTMLButtonElement>('.sidenav-action')!;
    button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    button.dispatchEvent(new Event('pointerup', { bubbles: true }));
    button.click();
    page.ready();
    await flush();

    expect(page.rendered).toHaveBeenCalled();
    expect(page.appClick).not.toHaveBeenCalled();
  });

  it('keeps the scroll position of the replaced panel', async () => {
    // jsdom has no layout, so give elements a scroll offset to read back.
    const offsets = new WeakMap<Element, number>();
    const scrollTop = vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(function (this: Element) {
      return offsets.get(this) ?? 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(function (this: Element, value: number) {
      offsets.set(this, value);
    });
    const page = setup();
    const panel = page.root.querySelector<HTMLElement>('.main-content')!;
    panel.scrollTop = 240;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    page.ready();
    await flush();

    const appPanel = page.root.querySelector<HTMLElement>('.main-content')!;
    expect(appPanel).not.toBe(panel);
    expect(appPanel.scrollTop).toBe(240);
    scrollTop.mockRestore();
    vi.restoreAllMocks();
  });

  it('tries again on the next input when loading the app fails', async () => {
    document.body.innerHTML = `<div id="root">${STATIC_HTML}</div>`;
    const root = document.getElementById('root')!;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prepare = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(async () => {});
    deferMountUntilInput({ root, prepare });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    await flush();
    expect(prepare).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('element locators', () => {
  it('finds an element again by id, or by label or class under the nearest id', () => {
    document.body.innerHTML = `<div id="root">${STATIC_HTML}</div>`;
    const root = document.getElementById('root')!;
    const button = root.querySelector('.sidenav-action')!;
    const locator = locateElement(root, button)!;
    expect(locator).toEqual({ scopeId: 'app-sidenav-desktop', selector: 'button[aria-label="Create new dashboard"]', index: 0 });

    root.innerHTML = APP_HTML;
    expect(resolveElement(root, locator)).toBe(root.querySelector('#app-sidenav-desktop .sidenav-action'));
    expect(locateElement(root, document.body)).toBeNull();
  });
});
