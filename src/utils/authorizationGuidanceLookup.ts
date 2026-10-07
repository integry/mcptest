import {
  createAuthorizationGuidance,
  createUnknownAuthorizationGuidance,
  type AuthorizationGuidanceViewModel,
} from './authorizationGuidance';
import { getCatalogServerByEndpoint } from './catalogUtils';

/** Safe exact-endpoint lookup for interactive reports and OAuth panels. */
export const getAuthorizationGuidanceForEndpoint = (
  endpoint: string
): AuthorizationGuidanceViewModel => {
  const server = getCatalogServerByEndpoint(endpoint);
  if (server) return createAuthorizationGuidance(server);
  let providerName = 'This endpoint';
  try {
    providerName = new URL(endpoint).host || providerName;
  } catch {
    // Keep a bounded generic label for invalid/untrusted targets.
  }
  return createUnknownAuthorizationGuidance(providerName);
};

export const getTrustedAuthorizationGuidanceForEndpoint = (
  endpoint: string
): AuthorizationGuidanceViewModel | undefined => {
  const guidance = getAuthorizationGuidanceForEndpoint(endpoint);
  return guidance.trustedCatalogMatch ? guidance : undefined;
};
