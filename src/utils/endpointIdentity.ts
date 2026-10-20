import { redactReportString } from './reportArtifact';

/** The redacted, host-normalized key browser-local histories group a server under. */
export const endpointIdentity = (value: string): string => {
  const redactedValue = redactReportString(value.trim());
  try {
    const url = new URL(redactedValue);
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return redactedValue;
  }
};
