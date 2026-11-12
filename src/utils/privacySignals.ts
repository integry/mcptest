/**
 * Browser privacy signals that turn analytics off.
 *
 * mcptest has no consent banner, so the visitor's browser-level choice is the
 * consent: a Do Not Track header preference or a Global Privacy Control
 * signal drops every analytics event and keeps Firebase Analytics from
 * initializing. The privacy policy page documents this.
 */

interface PrivacySignalSource {
  doNotTrack?: string | null;
  msDoNotTrack?: string | null;
  globalPrivacyControl?: boolean;
}

const DO_NOT_TRACK_VALUES = new Set(['1', 'yes']);

/** True when the browser asks not to be tracked (DNT or GPC). */
export const hasPrivacyOptOut = (
  nav: PrivacySignalSource | undefined = typeof navigator === 'undefined' ? undefined : navigator as PrivacySignalSource,
  win: { doNotTrack?: string | null } | undefined = typeof window === 'undefined' ? undefined : window as { doNotTrack?: string | null }
): boolean => {
  if (nav?.globalPrivacyControl === true) return true;
  const signals = [nav?.doNotTrack, nav?.msDoNotTrack, win?.doNotTrack];
  return signals.some((signal) => typeof signal === 'string' && DO_NOT_TRACK_VALUES.has(signal.toLowerCase()));
};

/** Analytics may run only in a browser that has not opted out. */
export const isAnalyticsAllowed = (): boolean => typeof window !== 'undefined' && !hasPrivacyOptOut();
