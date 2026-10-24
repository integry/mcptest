/**
 * Prerendered content pages (guides, docs articles, the Learn index, server
 * profiles) are complete in their static HTML: the generator renders the app
 * shell around the page body. React does not mount over them at load
 * (issue #405); src/main.tsx defers the mount until the first input. Until
 * then these vanilla handlers make the static controls work: the theme
 * toggle, the sidebar collapse and group toggles, code copy buttons, the `/`
 * search shortcut, guide link analytics and the page view. Other buttons (the
 * mobile menu, whose drawer only exists in the app) are replayed on the app
 * once the input that started the mount has mounted it (deferredMount.ts).
 *
 * Handlers are attached to the static shell element, which the React mount
 * removes, so they never run alongside the app's own.
 */
import {
  MENU_OPEN_CLASS,
  SIDEBAR_COLLAPSED_CLASS,
  SIDEBAR_COLLAPSED_KEY,
  readStoredSidebarCollapsed,
} from '../utils/layoutState';
import { logPageView, recordStaticPageEvent, trackEvent, trackGuideLinkClick } from '../utils/analytics';
import { handleCodeCopyClick, handleCopyFromClick } from '../utils/codeCopy';
import { setFieldValue } from './deferredMount';

/** Set by scripts/generate-seo-pages.js on the shell of pages that mount on first input. */
export const DEFERRED_MOUNT_ATTRIBUTE = 'data-deferred-mount';

/** The static shell of a page whose React mount is deferred, or null. */
export const getDeferredStaticPage = (root: HTMLElement | null): HTMLElement | null => {
  const shell = root?.firstElementChild;
  return shell instanceof HTMLElement && shell.hasAttribute(DEFERRED_MOUNT_ATTRIBUTE) ? shell : null;
};

/** Elements whose click a static handler has fully served; the deferred mount does not replay them. */
const handledClicks = new WeakSet<Element>();
export const isHandledByStaticPage = (element: Element): boolean => handledClicks.has(element);

const toggleTheme = (): void => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('theme', next);
  } catch {
    // The toggle still applies for this page view.
  }
  trackEvent('theme_changed', { theme_name: next });
};

/** Mirrors useSidebarCollapsed and SideNav's collapsed rendering on the static sidebar. */
const applySidebarCollapsed = (shell: HTMLElement, collapsed: boolean): void => {
  document.body.classList.toggle(SIDEBAR_COLLAPSED_CLASS, collapsed);
  const nav = shell.querySelector('.desktop-sidebar .app-sidenav');
  nav?.classList.toggle('app-sidenav--collapsed', collapsed);
  const toggle = nav?.querySelector('.sidenav-collapse-toggle');
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    toggle.setAttribute('title', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    const icon = toggle.querySelector('i');
    if (icon) icon.className = `bi ${collapsed ? 'bi-chevron-double-right' : 'bi-chevron-double-left'}`;
  }
  // The collapsed rail swaps the search field for a button that comes with the app.
  const search = nav?.querySelector<HTMLElement>('.guide-search--sidebar');
  if (search) search.hidden = collapsed;
  // A collapsed sidebar shows no group bodies.
  nav?.querySelectorAll<HTMLElement>('.sidenav-group-toggle[aria-controls]').forEach(button => {
    const body = document.getElementById(button.getAttribute('aria-controls') || '');
    if (!body) return;
    if (collapsed) {
      button.dataset.expandedBeforeCollapse = button.getAttribute('aria-expanded') || 'false';
      body.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    } else if (button.dataset.expandedBeforeCollapse) {
      const expanded = button.dataset.expandedBeforeCollapse === 'true';
      body.hidden = !expanded;
      button.setAttribute('aria-expanded', String(expanded));
      delete button.dataset.expandedBeforeCollapse;
    }
  });
};

/** Marks a sidebar group the visitor opened or closed on the static page. */
const TOGGLED_GROUP_ATTRIBUTE = 'data-static-toggled';
const SEARCH_EDITED_ATTRIBUTE = 'data-static-search-edited';

const toggleGroup = (button: Element): void => {
  const body = document.getElementById(button.getAttribute('aria-controls') || '');
  if (!body) return;
  const expanded = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(expanded));
  body.hidden = !expanded;
  button.setAttribute(TOGGLED_GROUP_ATTRIBUTE, '');
};

/** Marks a radio group whose choice carries over to the app, such as the server page's client switcher. */
export const CARRIED_CHOICE_ATTRIBUTE = 'data-carry-choice';

/**
 * The static page switches these radio groups with CSS alone; the app renders
 * them from its default. A choice the visitor made here is clicked again on
 * the app's radio with the same id.
 */
const snapshotRadioChoices = (root: HTMLElement): (() => void) => {
  const chosen = Array.from(root.querySelectorAll<HTMLInputElement>(`[${CARRIED_CHOICE_ATTRIBUTE}] input[type="radio"]:checked`))
    .filter(input => input.id && !input.defaultChecked)
    .map(input => input.id);
  return () => {
    for (const id of chosen) {
      const input = document.getElementById(id);
      if (input instanceof HTMLInputElement && root.contains(input) && !input.checked) input.click();
    }
  };
};

/**
 * Called just before the deferred mount replaces the static page; returns
 * what to apply once the app has rendered. The app's sidebar groups
 * (ContentTrackNav's tracks, SideNav's dashboards) start from the route's
 * defaults, so a group the visitor toggled here would snap back: each one
 * whose final state differs is toggled again on the app's own button.
 * A collapsed sidebar shows no group bodies, and the app's toggles expand it
 * there, so nothing carries over while it is collapsed.
 */
export const snapshotStaticPageState = (root: HTMLElement): (() => void) => {
  const restoreChoices = snapshotRadioChoices(root);
  // The editable static input buffers typing while React downloads. Keep the
  // node until the first commit so even edits after this snapshot survive,
  // including a search the visitor blurred before the swap.
  const search = root.querySelector<HTMLInputElement>('#catalog-search');
  const searchFocused = search !== null && document.activeElement === search;
  const restoreInputs = () => {
    restoreChoices();
    const appSearch = root.querySelector<HTMLInputElement>('#catalog-search');
    // An untouched fallback is empty even for a filtered URL; React's URL
    // state wins unless the visitor actually edited the static search.
    if (!search?.hasAttribute(SEARCH_EDITED_ATTRIBUTE) || !appSearch) return;
    if (appSearch.value !== search.value) setFieldValue(appSearch, search.value);
    if (searchFocused) {
      appSearch.setSelectionRange(search.selectionStart, search.selectionEnd);
    }
  };
  const isCollapsed = () => document.body.classList.contains(SIDEBAR_COLLAPSED_CLASS);
  if (isCollapsed()) return restoreInputs;
  const groups = Array.from(root.querySelectorAll(`.sidenav-group-toggle[aria-controls][${TOGGLED_GROUP_ATTRIBUTE}]`))
    .map(button => ({ controls: button.getAttribute('aria-controls')!, expanded: button.getAttribute('aria-expanded') === 'true' }));
  return () => {
    restoreInputs();
    if (isCollapsed()) return;
    for (const { controls, expanded } of groups) {
      const button = Array.from(root.querySelectorAll<HTMLElement>('.sidenav-group-toggle[aria-controls]'))
        .find(candidate => candidate.getAttribute('aria-controls') === controls);
      if (button && (button.getAttribute('aria-expanded') === 'true') !== expanded) button.click();
    }
  };
};

const isEditable = (target: EventTarget | null): boolean => (
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
);

/** The `/` shortcut of guide search (components/learn/guideSearchShortcut.ts), on content views only. */
const focusGuideSearch = (shell: HTMLElement, event: KeyboardEvent): void => {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
  if (isEditable(event.target) || isEditable(document.activeElement)) return;
  if (document.body.classList.contains(MENU_OPEN_CLASS)) return;
  const field = Array.from(shell.querySelectorAll<HTMLInputElement>('input.guide-search-input[aria-keyshortcuts="/"]'))
    .sort((left, right) => Number(right.closest('.guide-search--page') !== null) - Number(left.closest('.guide-search--page') !== null))
    .find(input => input.offsetParent !== null);
  if (!field) return;
  event.preventDefault();
  field.focus();
};

/** Sends the page view (and guide view) the app would send on its first render. */
const reportPageView = (shell: HTMLElement): void => {
  const path = window.location.pathname;
  const title = shell.dataset.pageViewTitle;
  if (title) {
    logPageView(path, title);
    recordStaticPageEvent(`page_view:${path}`);
  }
  const slug = shell.dataset.guideSlug;
  const track = shell.dataset.guideTrack;
  if (slug && track) {
    trackEvent('guide_view', { slug, track });
    recordStaticPageEvent(`guide_view:${slug}`);
  }
};

/** Wires the static page's controls. */
export const enhanceStaticPage = (shell: HTMLElement): void => {
  if (readStoredSidebarCollapsed()) applySidebarCollapsed(shell, true);

  const search = shell.querySelector<HTMLInputElement>('#catalog-search');
  search?.addEventListener('input', () => search.setAttribute(SEARCH_EDITED_ATTRIBUTE, ''));

  const guideSlug = shell.dataset.guideSlug;
  const trackGuideLinks = guideSlug ? trackGuideLinkClick(guideSlug) : undefined;

  shell.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (!target?.closest) return;
    if (handleCodeCopyClick(event)) {
      handledClicks.add(target.closest('.reading-code-copy')!);
      return;
    }
    if (handleCopyFromClick(event)) {
      handledClicks.add(target.closest('button[data-copy-from]')!);
      return;
    }
    if (trackGuideLinks && target.closest('article.reading-article')) trackGuideLinks(event);

    const button = target.closest('button');
    if (!button) return;
    if (button.matches('.app-theme-toggle')) {
      toggleTheme();
    } else if (button.matches('.sidenav-collapse-toggle')) {
      const collapsed = !document.body.classList.contains(SIDEBAR_COLLAPSED_CLASS);
      trackEvent('sidebar_collapse', { collapsed });
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
      } catch {
        // Applies for this page view only.
      }
      applySidebarCollapsed(shell, collapsed);
    } else if (button.matches('.sidenav-group-toggle[aria-controls]') && !document.body.classList.contains(SIDEBAR_COLLAPSED_CLASS)) {
      toggleGroup(button);
    } else {
      return;
    }
    handledClicks.add(button);
  });

  shell.addEventListener('keydown', event => focusGuideSearch(shell, event));
  // The shortcut also works before anything on the page has focus.
  const onDocumentKeydown = (event: KeyboardEvent) => {
    if (!shell.isConnected) {
      document.removeEventListener('keydown', onDocumentKeydown);
      return;
    }
    if (!shell.contains(event.target as Node)) focusGuideSearch(shell, event);
  };
  document.addEventListener('keydown', onDocumentKeydown);

  reportPageView(shell);
};
