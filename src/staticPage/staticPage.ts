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
import { handleCodeCopyClick } from '../utils/codeCopy';

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

const toggleGroup = (button: Element): void => {
  const body = document.getElementById(button.getAttribute('aria-controls') || '');
  if (!body) return;
  const expanded = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(expanded));
  body.hidden = !expanded;
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

  const guideSlug = shell.dataset.guideSlug;
  const trackGuideLinks = guideSlug ? trackGuideLinkClick(guideSlug) : undefined;

  shell.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (!target?.closest) return;
    if (handleCodeCopyClick(event)) {
      handledClicks.add(target.closest('.reading-code-copy')!);
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
