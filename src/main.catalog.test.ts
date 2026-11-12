import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ mountNow: vi.fn() }));
vi.mock('./firebase', () => ({
  shouldRestoreAuthSession: () => false,
  loadFirebase: vi.fn(),
  scheduleAnalyticsLoad: vi.fn(),
}));
vi.mock('./staticPage/deferredMount', () => ({
  deferMountUntilInput: () => mocks.mountNow,
}));
vi.mock('./staticPage/staticPage', () => ({
  getDeferredStaticPage: (root: HTMLElement) => root,
  enhanceStaticPage: vi.fn(),
  isHandledByStaticPage: vi.fn(),
  snapshotStaticPageState: vi.fn(),
}));

afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
  vi.clearAllMocks();
});

describe('catalog startup', () => {
  it.each([
    '', '?q=', '?q=%20%20', '?auth=', '?auth=all', '?category=',
    '?category=all', '?sort=', '?sort=catalog-order',
    '?q=&auth=all&category=all&sort=catalog-order', '?utm_source=example',
  ])('keeps default query %s deferred on canonical and alias paths', async (query) => {
    for (const pathname of ['/catalog', '/catalog.html', '/catalog/index.html']) {
      vi.resetModules();
      document.body.innerHTML = '<div id="root"></div>';
      window.history.replaceState(null, '', pathname + query);
      await import('./main');
      expect(mocks.mountNow).not.toHaveBeenCalled();
    }
  });

  it.each(['?q=github', '?auth=oauth', '?category=Developer%20Tools', '?sort=name', '?q=&auth=oauth']) (
    'mounts non-default query %s immediately on canonical and alias paths', async (query) => {
      for (const pathname of ['/catalog', '/catalog.html', '/catalog/index.html']) {
        vi.resetModules();
        mocks.mountNow.mockClear();
        document.body.innerHTML = '<div id="root"></div>';
        window.history.replaceState(null, '', pathname + query);
        await import('./main');
        expect(mocks.mountNow).toHaveBeenCalledOnce();
      }
    }
  );
});
