import {
  isSiteAssistantPath,
  resolveSiteAssistantConfig,
  SITE_ASSISTANT_META_NAME,
  type SiteAssistantConfig,
} from './config.mts';

/*
 * The entry's half of the site assistant: a few hundred bytes that read the
 * build's config meta tag and, only when it is there, wait for the page to
 * finish loading and go idle before importing the launcher chunk
 * (./launcher.ts). Nothing is requested from solv.chat until the visitor
 * presses the launcher, or, in a tab where they already opened the
 * assistant, once the launcher is up (so the conversation carries across pages).
 */

export interface SiteAssistantLauncher {
  setActive(active: boolean): void;
}

export type LoadLauncher = (config: SiteAssistantConfig) => Promise<SiteAssistantLauncher>;

interface SiteAssistantState {
  config: SiteAssistantConfig;
  pathname: string;
  /** The page has loaded and gone idle. */
  ready: boolean;
  loadLauncher: LoadLauncher;
  launcher: Promise<SiteAssistantLauncher | null> | null;
}

let state: SiteAssistantState | null = null;

/** The config written into index.html by the build, or null when the assistant is off. */
export const readSiteAssistantConfig = (doc: Document = document): SiteAssistantConfig | null => {
  const meta = doc.querySelector<HTMLMetaElement>(`meta[name="${SITE_ASSISTANT_META_NAME}"]`);
  if (!meta) return null;
  return resolveSiteAssistantConfig(meta.dataset.endpoint, meta.dataset.assistant);
};

/** Resolves after the load event and the next idle period (or a timeout when the page never idles). */
export const whenLoadedAndIdle = (win: Window = window): Promise<void> => new Promise(resolve => {
  const idle = () => {
    if (typeof win.requestIdleCallback === 'function') win.requestIdleCallback(() => resolve(), { timeout: 4000 });
    else win.setTimeout(resolve, 1500);
  };
  if (win.document.readyState === 'complete') idle();
  else win.addEventListener('load', idle, { once: true });
});

const importLauncher: LoadLauncher = config => import('./launcher').then(module => module.mountSiteAssistantLauncher(config));

/** Shows or hides the launcher for the current path; the chunk is imported the first time it may show. */
const apply = (current: SiteAssistantState): void => {
  if (!current.ready) return;
  const active = isSiteAssistantPath(current.pathname);
  if (!current.launcher) {
    // Excluded pages never fetch the launcher chunk.
    if (!active) return;
    current.launcher = current.loadLauncher(current.config).catch(error => {
      console.warn('[Site assistant] The launcher could not load.', error);
      return null;
    });
  }
  void current.launcher.then(launcher => {
    if (state === current) launcher?.setActive(isSiteAssistantPath(current.pathname));
  });
};

/**
 * Starts the assistant for this page. Returns false, and does nothing at all,
 * when the build has no assistant configured.
 */
export const startSiteAssistant = (options: {
  doc?: Document;
  win?: Window;
  ready?: Promise<void>;
  loadLauncher?: LoadLauncher;
} = {}): boolean => {
  const doc = options.doc ?? document;
  const win = options.win ?? window;
  if (state) return true;
  const config = readSiteAssistantConfig(doc);
  if (!config) return false;
  const current: SiteAssistantState = {
    config,
    pathname: win.location.pathname,
    ready: false,
    loadLauncher: options.loadLauncher ?? importLauncher,
    launcher: null,
  };
  state = current;
  void (options.ready ?? whenLoadedAndIdle(win)).then(() => {
    current.ready = true;
    if (state === current) apply(current);
  });
  return true;
};

/** Called on every client-side navigation: hides the launcher and widget on excluded pages. */
export const syncSiteAssistantRoute = (pathname: string): void => {
  if (!state) return;
  state.pathname = pathname;
  apply(state);
};

/** Test hook: forget the started assistant. */
export const resetSiteAssistantForTests = (): void => {
  state = null;
};
