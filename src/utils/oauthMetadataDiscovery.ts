/**
 * OAuth discovery for an MCP endpoint, shared by the evaluation's security
 * posture section and the discovery checker: RFC 9728 protected resource
 * metadata, then RFC 8414 / OpenID Connect metadata of the first advertised
 * authorization server that answers. Requests go through `fetchFn`, so callers
 * choose the route (direct, proxy, recorded fixture).
 */
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  type FetchLike,
  type OAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/client';

export type AuthorizationServerMetadata = NonNullable<
  Awaited<ReturnType<typeof discoverAuthorizationServerMetadata>>
>;

export interface OAuthMetadataDiscovery {
  resourceMetadata?: OAuthProtectedResourceMetadata;
  /** Why the protected resource metadata is absent (not served, unreadable or malformed). */
  resourceMetadataError?: string;
  /** The servers tried for authorization server metadata, in order. */
  authorizationServers: string[];
  authorizationServer?: string;
  authorizationMetadata?: AuthorizationServerMetadata;
  /** One entry per authorization server that failed, as `<server>: <reason>`. */
  authorizationErrors: string[];
}

export interface OAuthMetadataDiscoveryOptions {
  fetchFn: FetchLike;
  protocolVersion?: string;
  /**
   * Without protected resource metadata, treat the endpoint's origin as the
   * authorization server (the pre-RFC 9728 MCP behavior). The evaluation keeps
   * it for older servers; the discovery checker reports the absence instead.
   */
  originFallback?: boolean;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const discoverOAuthMetadata = async (
  endpoint: string,
  { fetchFn, protocolVersion, originFallback = false }: OAuthMetadataDiscoveryOptions
): Promise<OAuthMetadataDiscovery> => {
  const result: OAuthMetadataDiscovery = { authorizationServers: [], authorizationErrors: [] };

  try {
    result.resourceMetadata = await discoverOAuthProtectedResourceMetadata(
      endpoint,
      { protocolVersion },
      fetchFn
    );
  } catch (error) {
    // Protected-resource metadata is optional for older OAuth-enabled servers.
    result.resourceMetadataError = errorText(error);
  }

  const advertised = result.resourceMetadata?.authorization_servers ?? [];
  result.authorizationServers = advertised.length > 0
    ? [...advertised]
    : originFallback ? [new URL(endpoint).origin] : [];

  for (const candidate of result.authorizationServers) {
    try {
      const metadata = await discoverAuthorizationServerMetadata(candidate, { fetchFn, protocolVersion });
      if (metadata) {
        result.authorizationServer = candidate;
        result.authorizationMetadata = metadata;
        break;
      }
      result.authorizationErrors.push(`${candidate}: no OAuth or OpenID Connect metadata was found.`);
    } catch (error) {
      // Continue when one advertised authorization server has unavailable metadata.
      result.authorizationErrors.push(`${candidate}: ${errorText(error)}`);
    }
  }

  return result;
};
