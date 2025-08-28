import { analytics } from '../firebase';
import { logEvent as firebaseLogEvent } from 'firebase/analytics';

/**
 * Sanitizes URL to remove user-specific information while preserving useful analytics data
 */
const sanitizeUrl = (url: string): string => {
  try {
    const parsedUrl = new URL(url);
    // Keep only the protocol and host, remove path and query params
    return `${parsedUrl.protocol}//${parsedUrl.host}`;
  } catch {
    // If URL parsing fails, return a generic placeholder
    return 'unknown';
  }
};

/**
 * Sanitizes page path to remove user-specific slugs
 */
const sanitizePagePath = (path: string): string => {
  // Replace space slugs with generic placeholder
  return path.replace(/\/space\/[^\/]+/, '/space/[space]');
};

/**
 * Sanitizes page title to remove user-specific dashboard names
 */
const sanitizePageTitle = (title: string): string => {
  // Replace "Dashboard: [name]" with generic "Dashboard"
  return title.replace(/^Dashboard: .+$/, 'Dashboard');
};

/**
 * Logs a custom event to Firebase Analytics.
 * @param eventName The name of the event.
 * @param eventParams Optional parameters for the event.
 */
export const logEvent = (eventName: string, eventParams?: { [key: string]: any }) => {
  if (analytics) {
    // Sanitize event parameters: Firebase requires values to be strings, numbers, or booleans.
    const sanitizedParams: { [key: string]: string | number | boolean } = {};
    if (eventParams) {
      for (const key in eventParams) {
        if (Object.prototype.hasOwnProperty.call(eventParams, key)) {
          const value = eventParams[key];
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            sanitizedParams[key] = value;
          } else if (value !== null && value !== undefined) {
            sanitizedParams[key] = String(value);
          }
        }
      }
    }
    firebaseLogEvent(analytics, eventName, sanitizedParams);
  } else {
    // Fallback for local development or if Firebase fails to initialize
    console.log(`[Analytics Disabled] Event: ${eventName}`, eventParams);
  }
};

/**
 * Logs a page_view event. This is often handled automatically by Firebase, 
 * but should be called manually for virtual page changes in a Single Page Application (SPA).
 * @param path The path of the page being viewed.
 * @param title The title of the page.
 */
export const logPageView = (path: string, title: string) => {
    const sanitizedPath = sanitizePagePath(path);
    const sanitizedTitle = sanitizePageTitle(title);
    
    if (analytics) {
        firebaseLogEvent(analytics, 'page_view', {
            page_location: window.location.origin + sanitizedPath,
            page_path: sanitizedPath,
            page_title: sanitizedTitle,
        });
    } else {
        console.log(`[Analytics Disabled] Page View: ${sanitizedTitle} (${sanitizedPath})`);
    }
};

// Export sanitization functions for use in other components
export { sanitizeUrl, sanitizePagePath, sanitizePageTitle };