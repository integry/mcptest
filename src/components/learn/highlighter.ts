/**
 * On-demand access to the article highlighter. The highlight.js chunk is only
 * fetched when a code block with a known language mounts (or, for prerendered
 * articles with code, before React mounts so the static highlighting never
 * flickers to plain text).
 */
import type { HLJSApi } from '../../content/codeHighlighting';

let instance: HLJSApi | null = null;
let pending: Promise<HLJSApi> | null = null;

/** The highlighter once loaded; null until then. */
export const getHighlighter = (): HLJSApi | null => instance;

export const loadHighlighter = (): Promise<HLJSApi> => {
  if (instance) return Promise.resolve(instance);
  pending ??= import('../../content/codeHighlighting')
    .then(module => {
      instance = module.createHighlighter();
      return instance;
    })
    .catch(error => {
      pending = null;
      throw error;
    });
  return pending;
};
