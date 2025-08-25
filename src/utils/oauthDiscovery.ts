/**
 * OAuth 2.1 Discovery and OpenID Connect Discovery implementation
 * Follows RFC 8414 (OAuth 2.0 Authorization Server Metadata), OpenID Connect Discovery 1.0,
 * and OAuth 2.1 draft specification requirements
 * 
 * OAuth 2.1 Requirements:
 * - PKCE is required for all public clients
 * - Implicit flow is deprecated
 * - Authorization code flow with PKCE is the recommended flow
 */

export interface OAuthDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported: string[];
  response_modes_supported?: string[];
  grant_types_supported?: string[];
  subject_types_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  claims_supported?: string[];
  code_challenge_methods_supported?: string[];
  introspection_endpoint?: string;
  revocation_endpoint?: string;
  end_session_endpoint?: string;
}

export interface OAuthServiceConfig {
  name: string;
  discoveryUrl?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  requiresClientRegistration?: boolean;
  registrationEndpoint?: string;
  supportsDiscovery: boolean;
  supportsPKCE?: boolean;
  customHeaders?: Record<string, string>;
}

// Well-known OAuth service configurations
export const OAUTH_SERVICES: Record<string, OAuthServiceConfig> = {
  'github.com': {
    name: 'GitHub',
    authorizationEndpoint: 'https://github.com/login/oauth/authorize',
    tokenEndpoint: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    supportsDiscovery: false,
    supportsPKCE: false,
    requiresClientRegistration: true,
  },
  'accounts.google.com': {
    name: 'Google',
    discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
    scope: 'openid profile email',
    supportsDiscovery: true,
    supportsPKCE: true,
    requiresClientRegistration: true,
  },
  'login.microsoftonline.com': {
    name: 'Microsoft',
    discoveryUrl: 'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration',
    scope: 'openid profile email',
    supportsDiscovery: true,
    supportsPKCE: true,
    requiresClientRegistration: true,
  },
  'auth0.com': {
    name: 'Auth0',
    supportsDiscovery: true,
    supportsPKCE: true,
    requiresClientRegistration: true,
    scope: 'openid profile email',
  },
  'okta.com': {
    name: 'Okta',
    supportsDiscovery: true,
    supportsPKCE: true,
    requiresClientRegistration: true,
    scope: 'openid profile email',
  },
  'notion.so': {
    name: 'Notion',
    authorizationEndpoint: 'https://api.notion.com/v1/oauth/authorize',
    tokenEndpoint: 'https://api.notion.com/v1/oauth/token',
    scope: 'read_user',
    supportsDiscovery: false,
    supportsPKCE: false,
    requiresClientRegistration: true,
    customHeaders: {
      'Notion-Version': '2022-06-28',
    },
  },
  'notion.com': {
    name: 'Notion',
    authorizationEndpoint: 'https://api.notion.com/v1/oauth/authorize',
    tokenEndpoint: 'https://api.notion.com/v1/oauth/token',
    scope: 'read_user',
    supportsDiscovery: false,
    supportsPKCE: false,
    requiresClientRegistration: true,
    customHeaders: {
      'Notion-Version': '2022-06-28',
    },
  },
  'mcp.notion.com': {
    name: 'Notion MCP',
    authorizationEndpoint: 'https://api.notion.com/v1/oauth/authorize',
    tokenEndpoint: 'https://api.notion.com/v1/oauth/token',
    scope: 'read_user',
    supportsDiscovery: false,
    supportsPKCE: false,
    requiresClientRegistration: true,
    customHeaders: {
      'Notion-Version': '2022-06-28',
    },
  },
};

/**
 * Extract the OAuth service domain from a URL
 */
export function extractOAuthDomain(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    
    // Check for exact matches first
    if (OAUTH_SERVICES[hostname]) {
      return hostname;
    }
    
    // Check for subdomain matches (e.g., *.auth0.com, *.okta.com)
    for (const domain of Object.keys(OAUTH_SERVICES)) {
      if (hostname.endsWith(`.${domain}`)) {
        return domain;
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Discover OAuth endpoints using well-known configuration
 */
export async function discoverOAuthEndpoints(serverUrl: string): Promise<OAuthDiscoveryDocument | null> {
  try {
    const url = new URL(serverUrl);
    const baseUrl = `${url.protocol}//${url.host}`;
    
    // Try OpenID Connect Discovery first
    const wellKnownUrls = [
      `${baseUrl}/.well-known/openid-configuration`,
      `${baseUrl}/.well-known/oauth-authorization-server`,
      `${url.origin}/.well-known/openid-configuration`,
      `${url.origin}/.well-known/oauth-authorization-server`,
      // For multi-tenant services, try the base domain
      `${url.protocol}//${url.hostname}/.well-known/openid-configuration`,
    ];
    
    // If it's a known service with a custom discovery URL, use that
    const serviceDomain = extractOAuthDomain(serverUrl);
    if (serviceDomain && OAUTH_SERVICES[serviceDomain]?.discoveryUrl) {
      wellKnownUrls.unshift(OAUTH_SERVICES[serviceDomain].discoveryUrl!);
    }
    
    for (const discoveryUrl of wellKnownUrls) {
      try {
        console.log(`[OAuth Discovery] Trying discovery URL: ${discoveryUrl}`);
        const response = await fetch(discoveryUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
        });
        
        if (response.ok) {
          const metadata = await response.json();
          console.log('[OAuth Discovery] Successfully discovered OAuth endpoints:', metadata);
          
          // Validate required fields
          if (metadata.authorization_endpoint && metadata.token_endpoint) {
            return metadata as OAuthDiscoveryDocument;
          }
        }
      } catch (error) {
        console.log(`[OAuth Discovery] Failed to fetch ${discoveryUrl}:`, error);
        // Continue to next URL
      }
    }
    
    return null;
  } catch (error) {
    console.error('[OAuth Discovery] Error during discovery:', error);
    return null;
  }
}

/**
 * Get OAuth configuration for a server URL
 */
export async function getOAuthConfig(serverUrl: string): Promise<{
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scope: string;
  supportsPKCE: boolean;
  requiresClientRegistration: boolean;
  customHeaders?: Record<string, string>;
} | null> {
  try {
    // Always try discovery first for any service
    const discovered = await discoverOAuthEndpoints(serverUrl);
    if (discovered) {
      // Check if it's a known service for custom configurations
      const serviceDomain = extractOAuthDomain(serverUrl);
      const serviceConfig = serviceDomain ? OAUTH_SERVICES[serviceDomain] : null;
      
      return {
        authorizationEndpoint: discovered.authorization_endpoint,
        tokenEndpoint: discovered.token_endpoint,
        registrationEndpoint: discovered.registration_endpoint,
        scope: serviceConfig?.scope || discovered.scopes_supported?.join(' ') || 'openid profile email',
        // OAuth 2.1 requires PKCE for public clients - always enable it
        supportsPKCE: true,
        requiresClientRegistration: serviceConfig?.requiresClientRegistration ?? true,
        customHeaders: serviceConfig?.customHeaders,
      };
    }
    
    // Check if it's a known service with static configuration
    const serviceDomain = extractOAuthDomain(serverUrl);
    if (serviceDomain && OAUTH_SERVICES[serviceDomain]) {
      const serviceConfig = OAUTH_SERVICES[serviceDomain];
      
      // Use static configuration if available
      if (serviceConfig.authorizationEndpoint && serviceConfig.tokenEndpoint) {
        return {
          authorizationEndpoint: serviceConfig.authorizationEndpoint,
          tokenEndpoint: serviceConfig.tokenEndpoint,
          registrationEndpoint: serviceConfig.registrationEndpoint,
          scope: serviceConfig.scope || 'openid profile email',
          // OAuth 2.1 requires PKCE for public clients - always enable it
          supportsPKCE: true,
          requiresClientRegistration: serviceConfig.requiresClientRegistration ?? true,
          customHeaders: serviceConfig.customHeaders,
        };
      }
    }
    
    // No discovery or known configuration found
    return null;
  } catch (error) {
    console.error('[OAuth Config] Error getting OAuth configuration:', error);
    return null;
  }
}

/**
 * Check if a URL might be an OAuth-enabled service
 */
export function isOAuthService(url: string): boolean {
  const serviceDomain = extractOAuthDomain(url);
  return serviceDomain !== null;
}

/**
 * Format OAuth service name for display
 */
export function getOAuthServiceName(url: string): string | null {
  const serviceDomain = extractOAuthDomain(url);
  return serviceDomain ? OAUTH_SERVICES[serviceDomain]?.name : null;
}