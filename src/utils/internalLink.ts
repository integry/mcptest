import { APP_ROUTE_OPTIONS } from '../servicePage/buildFlag';
import { canonicalAliasPath, isKnownAppPath } from './appRoutes';

/** Finds a router destination for a plain click on an anchor. */
export const internalLinkPath = (event: Pick<MouseEvent, 'target' | 'button' | 'defaultPrevented' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): string | null => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
  if (!anchor || (anchor.target && anchor.target.toLowerCase() !== '_self') || anchor.hasAttribute('download')) return null;
  const href = anchor.getAttribute('href');
  if (!href || href === '#') return null;
  const { origin, protocol, pathname, search, hash } = anchor;
  if (origin !== window.location.origin || !/^https?:$/.test(protocol)) return null;
  if (/\.(?:md|json|xml)$/.test(pathname)) return null;
  const path = canonicalAliasPath(pathname, APP_ROUTE_OPTIONS) ?? pathname;
  return isKnownAppPath(path, APP_ROUTE_OPTIONS) ? `${path}${search}${hash}` : null;
};
