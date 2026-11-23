import { Component, type RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

type ScrollPosition = { windowX: number; windowY: number; panelX: number; panelY: number };

interface Props {
  panel: RefObject<HTMLDivElement | null>;
  location: ReturnType<typeof useLocation>;
  navigationType: ReturnType<typeof useNavigationType>;
}

/** BrowserRouter has no scroll restoration API, and the fixed shell scrolls
 * its main panel independently of the window. Save both before React changes
 * the outgoing layout, which can clamp either offset. */
class RouteScroll extends Component<Props> {
  private positions = new Map<string, ScrollPosition>();
  private observer?: MutationObserver;
  private browserRestoration = history.scrollRestoration;

  render() {
    return null;
  }

  componentDidMount() {
    history.scrollRestoration = 'manual';
    if (this.props.location.hash) this.restore(undefined, false);
  }

  componentWillUnmount() {
    this.observer?.disconnect();
    history.scrollRestoration = this.browserRestoration;
  }

  getSnapshotBeforeUpdate(previous: Props) {
    const panel = previous.panel.current;
    if (previous.location.key !== this.props.location.key) {
      this.positions.set(previous.location.key, {
        windowX: window.scrollX,
        windowY: window.scrollY,
        panelX: panel?.scrollLeft ?? 0,
        panelY: panel?.scrollTop ?? 0,
      });
    }
    return null;
  }

  componentDidUpdate(previous: Props) {
    const { location, navigationType } = this.props;
    if (previous.location.key === location.key) return;
    this.observer?.disconnect();

    const pageChanged = previous.location.pathname !== location.pathname;
    const saved = navigationType === 'POP' ? this.positions.get(location.key) : undefined;
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
      if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
    };
    if (focusPage || saved) setPosition();

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
      else if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
      return true;
    };
    if (finish()) return;

    this.observer = new MutationObserver(() => {
      if (finish()) this.observer?.disconnect();
    });
    this.observer.observe(panel, { childList: true, subtree: true });
  }
}

export default function RouteScrollRestoration({ panel }: Pick<Props, 'panel'>) {
  const location = useLocation();
  const navigationType = useNavigationType();
  return <RouteScroll panel={panel} location={location} navigationType={navigationType} />;
}
