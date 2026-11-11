/** localStorage key for the recent endpoints useConnection records on each successful connection. */
export const RECENT_SERVERS_KEY = 'mcpRecentServers';

/**
 * The stored recent endpoint URLs, newest first. Handles both the old
 * (string[]) and the current ({ url, useProxy? }[]) format; [] when storage
 * is unavailable or unreadable.
 */
export const loadRecentServers = (): string[] => {
  try {
    if (typeof localStorage === 'undefined') return [];
    const stored = localStorage.getItem(RECENT_SERVERS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed.map(item => {
          if (typeof item === 'string') {
            return item;
          } else if (item && typeof item.url === 'string') {
            return item.url;
          }
          return null;
        }).filter(Boolean) as string[];
      }
    }
  } catch (e) {
    console.error("Failed to load or parse recent servers from localStorage:", e);
  }
  return [];
};
