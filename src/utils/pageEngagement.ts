import { trackEvent, type AnalyticsEventCatalog } from './analytics';
import { getServerUrl } from './urlUtils';

let handoff: { path: string; depths: Set<number> } | undefined;
export const submitInlineTest = (form: HTMLFormElement): boolean => {
  const input = form.elements.namedItem('endpoint') as HTMLInputElement;
  const error = form.querySelector<HTMLElement>('[data-inline-error]');
  let path: string;
  try {
    const url = new URL(input.value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error();
    path = getServerUrl(url.href);
  } catch {
    input.setAttribute('aria-invalid', 'true');
    if (error) error.hidden = false;
    input.focus();
    trackEvent('guide_inline_test', { outcome: 'invalid' });
    return false;
  }
  input.removeAttribute('aria-invalid');
  if (error) error.hidden = true;
  trackEvent('guide_inline_test', { outcome: 'submitted' });
  window.location.assign(path);
  return true;
};

/** Shared by static pages and React. Anchors navigate natively and are never replayed. */
export const enhanceEngagement = (root: HTMLElement, staticPage = false): (() => void) => {
  const click = (event: MouseEvent) => {
    const anchor = (event.target as Element | null)?.closest<HTMLElement>('[data-server-action]');
    if (anchor) trackEvent('server_page_action', { action: anchor.dataset.serverAction as AnalyticsEventCatalog['server_page_action']['action'] });
  };
  const submit = (event: Event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches('[data-inline-test]')) return;
    event.preventDefault();
    submitInlineTest(form);
  };
  root.addEventListener('click', click);
  root.addEventListener('submit', submit);
  // Article elements share HTMLElement's type, so matches('article') narrows
  // the false branch to never with the newer DOM type predicates.
  const article = root.localName === 'article' ? root : root.querySelector<HTMLElement>('article.reading-article, article.server-profile');
  const depths = !staticPage && handoff?.path === window.location.pathname ? handoff.depths : new Set<number>();
  if (staticPage) handoff = { path: window.location.pathname, depths };
  else handoff = undefined;
  const sentinels: HTMLElement[] = [];
  let observer: IntersectionObserver | undefined;
  let resize: ResizeObserver | undefined;
  if (article && typeof IntersectionObserver !== 'undefined') {
    article.style.position = 'relative';
    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting || !root.isConnected) return;
        const depth = Number((entry.target as HTMLElement).dataset.depth) as 25 | 50 | 75 | 100;
        if (!depths.has(depth)) {
          depths.add(depth);
          trackEvent('scroll_depth', { depth });
        }
      });
    });
    for (const depth of [25, 50, 75, 100]) {
      const sentinel = document.createElement('span');
      sentinel.dataset.depth = String(depth);
      sentinel.setAttribute('aria-hidden', 'true');
      sentinel.style.cssText = `position:absolute;top:calc(${depth}% - 1px);left:0;width:1px;height:1px;pointer-events:none`;
      article.append(sentinel);
      sentinels.push(sentinel);
      observer.observe(sentinel);
    }
  }
  return () => {
    root.removeEventListener('click', click);
    root.removeEventListener('submit', submit);
    observer?.disconnect();
    resize?.disconnect();
    sentinels.forEach(sentinel => sentinel.remove());
  };
};
