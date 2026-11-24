import { trackEvent } from '../utils/analytics';
import { matchesCatalogSearch } from '../utils/catalogSearchText';
import { STATIC_SEARCH_EDITED_ATTRIBUTE, syncCatalogRows, type PrerenderedCatalog } from './prerenderedCatalog';

export const enhanceCatalogSearch = (
  shell: HTMLElement,
  search: HTMLInputElement,
  catalog: PrerenderedCatalog,
  onHandled: (element: Element) => void
): void => {
  const count = shell.querySelector('.catalog-results-count strong')!;
  const empty = shell.querySelector<HTMLElement>('.catalog-empty-state')!;
  const rows = Array.from(catalog.rows.values(), row => ({
    row,
    text: row.dataset.catalogSearch ?? '',
    category: row.querySelector<HTMLAnchorElement>('.catalog-metadata-badge--category')!.pathname,
  }));
  const rail = Array.from(shell.querySelectorAll<HTMLAnchorElement>('.catalog-category-rail a'), link => ({
    link,
    path: link.pathname,
    count: link.querySelector('[aria-label]')!,
  }));
  let resultsTimer: number | undefined;
  let syncTimer: number | undefined;
  let lastQuery = new URLSearchParams(window.location.search).get('q')?.trim() ?? '';
  const queryString = (query: string) => query ? `?${new URLSearchParams({ q: query })}` : '';
  const updateResults = () => {
    resultsTimer = undefined;
    if (!shell.isConnected) return;
    const query = search.value.trim();
    const normalized = query.toLowerCase();
    const params = queryString(query);
    const matches = rows.filter(({ text }) => matchesCatalogSearch(text, normalized));
    const categories = new Map<string, number>();
    for (const { category } of matches) {
      categories.set(category, (categories.get(category) ?? 0) + 1);
    }
    syncCatalogRows(catalog.list, matches.map(({ row }) => row));
    for (const item of rail) {
      const total = item.path === '/catalog' ? matches.length : categories.get(item.path) ?? 0;
      item.count.textContent = String(total);
      item.count.setAttribute('aria-label', `${total} servers`);
      if (total || item.link.hasAttribute('aria-current')) {
        item.link.setAttribute('href', `${item.path}${params}`);
        item.link.removeAttribute('aria-disabled');
      } else {
        item.link.removeAttribute('href');
        item.link.setAttribute('aria-disabled', 'true');
      }
    }
    count.textContent = String(matches.length);
    catalog.list.hidden = matches.length === 0;
    empty.hidden = matches.length > 0;
  };
  const scheduleResults = () => {
    // The browser places the caret and scrolls the input into view during
    // editing. Change the list in the next task, after the input event has
    // finished, without waiting for a frame to be scheduled.
    if (resultsTimer === undefined) resultsTimer = window.setTimeout(updateResults, 0);
  };
  const searchChanged = () => {
    search.setAttribute(STATIC_SEARCH_EDITED_ATTRIBUTE, '');
    scheduleResults();
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      if (!shell.isConnected) return;
      const query = search.value.trim();
      const url = new URL(window.location.href);
      if (query) url.searchParams.set('q', query);
      else url.searchParams.delete('q');
      if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url);
      if (query && lastQuery !== query) trackEvent('catalog_search', { query_length: query.length });
      lastQuery = query;
    }, 300);
  };
  search.addEventListener('input', searchChanged);
  // Keep the query on native badge navigation without rewriting hundreds
  // of anchor URLs during typing. The browser still owns each click.
  const updateBadgeDestination = (event: Event) => {
    const badge = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('.catalog-metadata-badge--category');
    if (badge) badge.search = queryString(search.value.trim());
  };
  for (const type of ['pointerdown', 'click', 'contextmenu']) {
    shell.addEventListener(type, updateBadgeDestination);
  }
  const clear = empty.querySelector('[data-static-catalog-clear]');
  clear?.addEventListener('click', () => {
    onHandled(clear);
    search.value = '';
    search.focus();
    searchChanged();
  });

  // The shared entry remembers any typing that arrived before this module.
  if (search.hasAttribute(STATIC_SEARCH_EDITED_ATTRIBUTE)) {
    searchChanged();
  } else if (lastQuery) {
    search.value = lastQuery;
    scheduleResults();
  }
  const restoreSearch = () => {
    if (!shell.isConnected) {
      window.removeEventListener('popstate', restoreSearch);
      return;
    }
    window.clearTimeout(syncTimer);
    const query = new URLSearchParams(window.location.search).get('q')?.trim() ?? '';
    lastQuery = query;
    if (query === search.value) return;
    search.value = query;
    search.removeAttribute(STATIC_SEARCH_EDITED_ATTRIBUTE);
    scheduleResults();
  };
  window.addEventListener('popstate', restoreSearch);
};
