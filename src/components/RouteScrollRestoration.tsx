import { Component, type RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { prerenderedScrollPositions, readRouteScroll } from '../staticPage/deferredMount';

type ScrollPosition = ReturnType<typeof readRouteScroll>;

interface Props {
  panel: RefObject<HTMLDivElement | null>;
  location: ReturnType<typeof useLocation>;
  navigationType: ReturnType<typeof useNavigationType>;
}

type Entry = Pick<Props['location'], 'key' | 'pathname' | 'search' | 'hash'>;

const entryChanged = (previous: Entry, next: Entry) =>
  previous.key !== next.key || previous.pathname !== next.pathname ||
  previous.search !== next.search || previous.hash !== next.hash;

const browserEntry = (): Entry => {
  const { pathname, search, hash } = window.location;
  return { pathname, search, hash, key: history.state?.key ?? 'default' };
};

/** BrowserRouter has no scroll restoration API, and the fixed shell scrolls
 * its main panel independently of the window. Save both before React changes
 * the outgoing layout, which can clamp either offset. */
class RouteScroll extends Component<Props> {
  private positions = new Map<string, ScrollPosition>();
  private observer?: MutationObserver;
  private browserRestoration = history.scrollRestoration;
  private beforePop?: { location: Props['location']; position: ScrollPosition };
  private locationIsCurrent = false;

  private savedPosition(key: string) {
    return this.positions.get(key) ?? prerenderedScrollPositions.get(key);
  }

  private handlePop = () => {
    const { location, panel } = this.props;
    const entry = browserEntry();
    if (!entryChanged(location, entry)) return;
    // An entry created on the static page may still use native restoration.
    // Capture the outgoing layout before the browser applies that scroll.
    if (this.locationIsCurrent && this.beforePop?.location !== location) {
      this.beforePop = { location, position: readRouteScroll(panel.current) };
    }
    if (entry.key !== 'default' && this.savedPosition(entry.key)) history.scrollRestoration = 'manual';
  };

  render() {
    return null;
  }

  componentDidMount() {
    window.addEventListener('popstate', this.handlePop, { capture: true });
    this.locationIsCurrent = !entryChanged(this.props.location, browserEntry());
    if (!this.locationIsCurrent) return;
    history.scrollRestoration = 'manual';
    const { key, hash } = this.props.location;
    const saved = this.savedPosition(key);
    if (saved || hash) this.restore(saved, false);
  }

  componentWillUnmount() {
    window.removeEventListener('popstate', this.handlePop, { capture: true });
    this.observer?.disconnect();
    history.scrollRestoration = this.browserRestoration;
  }

  getSnapshotBeforeUpdate(previous: Props) {
    if (this.locationIsCurrent && entryChanged(previous.location, this.props.location)) {
      const position = this.props.navigationType === 'POP' && this.beforePop?.location === previous.location
        ? this.beforePop.position : readRouteScroll(previous.panel.current);
      this.positions.set(previous.location.key, position);
      this.beforePop = undefined;
    }
    return null;
  }

  componentDidUpdate(previous: Props) {
    const { location, navigationType } = this.props;
    if (!entryChanged(previous.location, location)) return;
    this.observer?.disconnect();
    this.locationIsCurrent = !entryChanged(location, browserEntry());
    if (!this.locationIsCurrent) return;

    const pageChanged = previous.location.pathname !== location.pathname;
    const saved = navigationType === 'POP' && previous.location.key !== location.key
      ? this.savedPosition(location.key) : undefined;
    // Leave native entries that predate the handoff to the browser.
    if (navigationType === 'POP' && location.key === 'default' && history.state?.idx == null) return;
    history.scrollRestoration = 'manual';
    if (saved || pageChanged || location.hash || previous.location.hash) {
      this.restore(saved, pageChanged);
    }
  }

  private restore(saved: ScrollPosition | undefined, focusPage: boolean) {
    const panel = this.props.panel.current;
    if (!panel) return;

    const { hash } = this.props.location;
    let id = hash.slice(1);
    try { id = decodeURIComponent(id); } catch { /* Use the literal fragment. */ }

    const setPosition = (position?: ScrollPosition) => {
      panel.scrollTop = position?.panelY ?? 0;
      panel.scrollLeft = position?.panelX ?? 0;
      const x = position?.windowX ?? 0;
      const y = position?.windowY ?? 0;
      if (window.scrollX !== x || window.scrollY !== y) {
        window.scrollTo({ left: x, top: y, behavior: 'instant' });
      }
    };
    if (focusPage || (!saved && !id)) setPosition();

    const visible = (element: HTMLElement) => element.getClientRects().length > 0;
    const finish = () => {
      if (Array.from(panel.querySelectorAll<HTMLElement>('.view-loading')).some(visible)) return false;

      const bodyLoading = panel.querySelector('.reading-body-status[role="status"]');
      if (bodyLoading && (saved || id)) return false;

      if (focusPage) {
        const heading = Array.from(panel.querySelectorAll<HTMLElement>('h1')).find(visible);
        const target = heading ?? panel.closest('main') ?? panel;
        if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
      if (saved) setPosition(saved);
      else if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'start', behavior: 'instant' });
      return true;
    };
    if (finish()) return;

    const href = window.location.href;
    const key = history.state?.key;
    const observer = new MutationObserver(() => {
      if (window.location.href !== href || history.state?.key !== key || finish()) {
        observer.disconnect();
      }
    });
    observer.observe(panel, { childList: true, subtree: true });
    this.observer = observer;
  }
}

export default function RouteScrollRestoration({ panel }: Pick<Props, 'panel'>) {
  const location = useLocation();
  const navigationType = useNavigationType();
  return <RouteScroll panel={panel} location={location} navigationType={navigationType} />;
}
