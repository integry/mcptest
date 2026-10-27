import { afterEach, expect, it, vi } from 'vitest';
import { enhanceEngagement, submitInlineTest } from './pageEngagement';
import { trackEvent } from './analytics';
vi.mock('./analytics', () => ({ trackEvent: vi.fn() }));
afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });
it('reports static anchor actions once and shows an accessible invalid URL error', () => {
  document.body.innerHTML = '<article class="server-profile"><a href="/" data-server-action="test_live">Test</a><form data-inline-test><input name="endpoint" value="javascript:alert(1)"><p data-inline-error hidden>Invalid URL</p></form></article>';
  const article = document.querySelector('article')!;
  const cleanup = enhanceEngagement(article, true);
  article.querySelector('a')!.addEventListener('click', e => e.preventDefault());
  article.querySelector('a')!.click();
  expect(trackEvent).toHaveBeenCalledWith('server_page_action', { action: 'test_live' });
  expect(submitInlineTest(article.querySelector('form')!)).toBe(false);
  expect(article.querySelector('input')!.getAttribute('aria-invalid')).toBe('true');
  expect(article.querySelector<HTMLElement>('[data-inline-error]')!.hidden).toBe(false);
  expect(trackEvent).toHaveBeenCalledWith('guide_inline_test', { outcome: 'invalid' });
  cleanup();
});
it('counts depth once across the static-to-React handoff and resets on the next page view', () => {
  let callback: IntersectionObserverCallback;
  vi.stubGlobal('IntersectionObserver', class { constructor(cb: IntersectionObserverCallback) { callback = cb; } observe() {} disconnect() {} });
  document.body.innerHTML = '<article class="reading-article"></article>';
  const article = document.querySelector('article')!;
  const send = () => callback([{ isIntersecting: true, target: article.querySelector('[data-depth="50"]') } as IntersectionObserverEntry], {} as IntersectionObserver);
  const cleanup = enhanceEngagement(article, true);
  send(); send(); cleanup();
  const cleanupApp = enhanceEngagement(article);
  send(); cleanupApp();
  expect(vi.mocked(trackEvent).mock.calls.filter(([name]) => name === 'scroll_depth')).toHaveLength(1);
  const cleanupNext = enhanceEngagement(article); send(); cleanupNext();
  expect(vi.mocked(trackEvent).mock.calls.filter(([name]) => name === 'scroll_depth')).toHaveLength(2);
});

it.each([
  ['article root', '<article></article>', 'article'],
  ['reading article inside a container', '<main><article class="reading-article"></article></main>', 'main'],
  ['server profile inside a container', '<main><article class="server-profile"></article></main>', 'main'],
])('observes and cleans up reading depth for an %s', (_label, markup, selector) => {
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class { observe = observe; disconnect = disconnect; });
  document.body.innerHTML = markup;
  const root = document.querySelector<HTMLElement>(selector)!;
  const article = document.querySelector('article')!;

  const cleanup = enhanceEngagement(root);
  expect([...article.querySelectorAll<HTMLElement>('[data-depth]')].map(el => el.dataset.depth)).toEqual(['25', '50', '75', '100']);
  expect(observe).toHaveBeenCalledTimes(4);
  cleanup();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(article.querySelector('[data-depth]')).toBeNull();
});

it('allows a container without an article', () => {
  const observe = vi.fn();
  vi.stubGlobal('IntersectionObserver', class { observe = observe; disconnect() {} });
  document.body.innerHTML = '<main></main>';
  const root = document.querySelector('main')!;
  const cleanup = enhanceEngagement(root);
  expect(observe).not.toHaveBeenCalled();
  expect(root.querySelector('[data-depth]')).toBeNull();
  cleanup();
});
