/**
 * Lazy Firebase access. The SDK lives in `src/firebaseRuntime.ts`, which is
 * only loaded (one dynamic import, one chunk) when something needs it:
 *
 * - `AuthProvider`, when the browser remembers a signed-in session (the
 *   session hint below) or the user clicks sign-in;
 * - analytics, once the page is idle, when a measurement id is configured;
 * - any code that needs the signed-in user's token (dashboards, the proxy).
 *
 * Content pages visited by signed-out readers never download Firebase.
 */
import type { FirebaseRuntime } from './firebaseRuntime';
import { isFirebaseAnalyticsConfigured, isFirebaseAuthEnabled } from './firebaseConfig';
import { isAnalyticsAllowed } from './utils/privacySignals';

export type { FirebaseRuntime } from './firebaseRuntime';
export { hasFirebaseConfig, isFirebaseAnalyticsConfigured, isFirebaseAuthEnabled } from './firebaseConfig';

/**
 * Set while a user is signed in, cleared when Firebase reports sign-out, so a
 * returning user's session is restored on the first render without making
 * every anonymous visitor download the SDK first.
 */
export const AUTH_SESSION_HINT_KEY = 'mcptest.authSession';

export const hasAuthSessionHint = (): boolean => {
  try {
    return localStorage.getItem(AUTH_SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
};

export const setAuthSessionHint = (signedIn: boolean): void => {
  try {
    if (signedIn) localStorage.setItem(AUTH_SESSION_HINT_KEY, '1');
    else localStorage.removeItem(AUTH_SESSION_HINT_KEY);
  } catch {
    // Storage may be unavailable; the next load falls back to the lazy path.
  }
};

let loaded: FirebaseRuntime | null = null;
let pending: Promise<FirebaseRuntime> | null = null;
let scheduled = false;
const loadListeners = new Set<(runtime: FirebaseRuntime) => void>();

/** Loads and initializes the SDK once; later calls share the same promise. */
export const loadFirebase = (): Promise<FirebaseRuntime> => {
  if (!pending) {
    pending = import('./firebaseRuntime')
      .then(module => {
        loaded = module.initializeFirebaseRuntime();
        loadListeners.forEach(listener => listener(loaded!));
        loadListeners.clear();
        return loaded;
      })
      .catch(error => {
        pending = null;
        throw error;
      });
  }
  return pending;
};

/** The initialized runtime, or null until `loadFirebase` has resolved. */
export const getLoadedFirebase = (): FirebaseRuntime | null => loaded;

/** True while a load is scheduled or in flight and has not resolved yet. */
export const isFirebaseLoading = (): boolean => loaded === null && (pending !== null || scheduled);

/** Runs `listener` when the runtime becomes available; immediately when it already is. */
export const onFirebaseLoaded = (listener: (runtime: FirebaseRuntime) => void): (() => void) => {
  if (loaded) {
    listener(loaded);
    return () => {};
  }
  loadListeners.add(listener);
  return () => {
    loadListeners.delete(listener);
  };
};

/** Whether this page should restore a signed-in session on its first render. */
export const shouldRestoreAuthSession = (): boolean => isFirebaseAuthEnabled() && hasAuthSessionHint();

const IDLE_FALLBACK_MS = 2000;

/**
 * Loads analytics after the page has settled: on window load, then when the
 * main thread is idle. Events fired earlier are queued by `utils/analytics`.
 */
export const scheduleAnalyticsLoad = (): boolean => {
  if (typeof window === 'undefined' || !isFirebaseAnalyticsConfigured() || !isAnalyticsAllowed()) return false;
  scheduled = true;
  const load = () => {
    loadFirebase().catch(() => {
      scheduled = false;
    });
  };
  const whenIdle = () => {
    const idle = (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number })
      .requestIdleCallback;
    if (typeof idle === 'function') idle.call(window, load, { timeout: IDLE_FALLBACK_MS });
    else window.setTimeout(load, IDLE_FALLBACK_MS);
  };
  if (document.readyState === 'complete') whenIdle();
  else window.addEventListener('load', whenIdle, { once: true });
  return true;
};

/** Test-only: forget the loaded runtime so a mocked import can be observed again. */
export const resetFirebaseForTests = (): void => {
  loaded = null;
  pending = null;
  scheduled = false;
  loadListeners.clear();
};
