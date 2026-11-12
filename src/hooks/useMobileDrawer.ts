import { useEffect, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';

import { MENU_OPEN_CLASS } from '../utils/layoutState';

export { MENU_OPEN_CLASS };

export const closeMobileDrawer = () => document.body.classList.remove(MENU_OPEN_CLASS);

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusableWithin = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(element => !element.closest('[hidden]') && element.getAttribute('aria-hidden') !== 'true');

/**
 * Behaviour for the mobile navigation drawer, which App opens by toggling a
 * class on <body>: close on route change, trap Tab inside the drawer, close on
 * Escape and return focus to the control that opened it.
 */
export const useMobileDrawer = (enabled: boolean, navRef: RefObject<HTMLElement | null>) => {
  const { pathname } = useLocation();

  useEffect(() => {
    if (enabled) closeMobileDrawer();
  }, [enabled, pathname]);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined' || !navRef.current) return;
    const drawer = navRef.current.closest<HTMLElement>('.mobile-sidebar') ?? navRef.current;
    const body = document.body;
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    if (!drawer.hasAttribute('aria-label')) drawer.setAttribute('aria-label', 'Navigation');

    let wasOpen = body.classList.contains(MENU_OPEN_CLASS);
    let opener: HTMLElement | null = null;

    const onOpenChange = () => {
      const open = body.classList.contains(MENU_OPEN_CLASS);
      if (open === wasOpen) return;
      wasOpen = open;
      if (open) {
        opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        focusableWithin(drawer)[0]?.focus();
      } else if (opener && document.contains(opener)) {
        opener.focus();
        opener = null;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!body.classList.contains(MENU_OPEN_CLASS)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMobileDrawer();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableWithin(drawer);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !drawer.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const observer = new MutationObserver(onOpenChange);
    observer.observe(body, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('keydown', onKeyDown);
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled, navRef]);
};
