/**
 * The `/` shortcut for the guide search. The playground owns `/` for its
 * capability search, so the guide search only registers while a content page
 * (`/learn*` or `/docs/*`) is the active view. When several guide search fields
 * are mounted (the sidebar and the /learn index), the highest-priority one that
 * can actually take focus wins.
 */
import { MENU_OPEN_CLASS } from '../../hooks/useMobileDrawer';

export const GUIDE_SEARCH_SHORTCUT_VIEWS: readonly string[] = ['learn', 'docs'];

export const isGuideSearchShortcutView = (activeView: string) => GUIDE_SEARCH_SHORTCUT_VIEWS.includes(activeView);

export interface GuideSearchShortcutTarget {
  priority: number;
  /** Focuses the field and reports whether it took focus (a hidden field cannot). */
  focus: () => boolean;
}

const targets = new Set<GuideSearchShortcutTarget>();

export const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
};

const handleShortcut = (event: KeyboardEvent) => {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
  if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return;
  // An open dialog or drawer owns the keyboard, as for the playground shortcut.
  if (document.body.classList.contains(MENU_OPEN_CLASS)) return;
  if (document.querySelector('[role="dialog"][aria-modal="true"]:not(.mobile-sidebar)')) return;
  const ordered = [...targets].sort((left, right) => right.priority - left.priority);
  if (ordered.some(target => target.focus())) event.preventDefault();
};

/** Registers a shortcut target; returns the cleanup. */
export const registerGuideSearchShortcut = (target: GuideSearchShortcutTarget) => {
  if (targets.size === 0) document.addEventListener('keydown', handleShortcut);
  targets.add(target);
  return () => {
    targets.delete(target);
    if (targets.size === 0) document.removeEventListener('keydown', handleShortcut);
  };
};
