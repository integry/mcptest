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
  'paypal.com': {
    name: 'PayPal',
    supportsDiscovery: true,
    supportsPKCE: true,
    requiresClientRegistration: true,
    scope: 'openid profile email',
  },
  'mcp.paypal.com': {
    name: 'PayPal MCP',
    supportsDiscovery: true,
    supportsPKCE: true,
    requiresClientRegistration: true,
    scope: 'openid profile email',
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
 * Follows MCP specification and RFC8414 (OAuth 2.0 Authorization Server Metadata)
 */
export async function discoverOAuthEndpoints(serverUrl: string): Promise<OAuthDiscoveryDocument | null> {
  try {
    const url = new URL(serverUrl);
    
    // Per MCP spec: The authorization base URL MUST be determined from the MCP server URL 
    // by discarding any existing path component
    const authorizationBaseUrl = `${url.protocol}//${url.host}`;
    
    // Per MCP spec: The metadata endpoint MUST be at 
    // {authorization_base_url}/.well-known/oauth-authorization-server
    const metadataUrl = `${authorizationBaseUrl}/.well-known/oauth-authorization-server`;
    
    try {
      console.log(`[OAuth Discovery] Attempting metadata discovery at: ${metadataUrl}`);
      const response = await fetch(metadataUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'MCP-Protocol-Version': '2024-11-05', // Include MCP protocol version as per spec
        },
      });
      
      if (response.ok) {
        const metadata = await response.json();
        console.log('[OAuth Discovery] Successfully discovered OAuth endpoints:', metadata);
        
        // Validate required fields per RFC8414
        if (metadata.authorization_endpoint && metadata.token_endpoint) {
          return metadata as OAuthDiscoveryDocument;
        } else {
          console.error('[OAuth Discovery] Invalid metadata document - missing required endpoints');
        }
      } else {
        console.log(`[OAuth Discovery] Metadata endpoint returned ${response.status}`);
      }
    } catch (error) {
      console.log(`[OAuth Discovery] Failed to fetch metadata:`, error);
    }
    
    // If it's a known service with static configuration, we can still try that as a last resort
    // but per MCP spec, discovery should be attempted first
    const serviceDomain = extractOAuthDomain(serverUrl);
    if (serviceDomain && OAUTH_SERVICES[serviceDomain]?.discoveryUrl) {
      try {
        console.log(`[OAuth Discovery] Trying known service discovery URL: ${OAUTH_SERVICES[serviceDomain].discoveryUrl}`);
        const response = await fetch(OAUTH_SERVICES[serviceDomain].discoveryUrl!, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
        });
        
        if (response.ok) {
          const metadata = await response.json();
          if (metadata.authorization_endpoint && metadata.token_endpoint) {
            return metadata as OAuthDiscoveryDocument;
          }
        }
      } catch (error) {
        console.log(`[OAuth Discovery] Known service discovery failed:`, error);
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
 * Follows MCP specification for discovery and fallback endpoints
 */
export async function getOAuthConfig(serverUrl: string): Promise<{
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  userinfo_endpoint?: string;
  scope: string;
  supportsPKCE: boolean;
  requiresClientRegistration: boolean;
  requiresDynamicRegistration?: boolean;
  customHeaders?: Record<string, string>;
} | null> {
  try {
    const url = new URL(serverUrl);
    const authorizationBaseUrl = `${url.protocol}//${url.host}`;
    
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
        userinfo_endpoint: discovered.userinfo_endpoint,
        scope: serviceConfig?.scope || discovered.scopes_supported?.join(' ') || 'openid profile email',
        // OAuth 2.1 requires PKCE for public clients - always enable it
        supportsPKCE: true,
        requiresClientRegistration: serviceConfig?.requiresClientRegistration ?? true,
        // If registration endpoint is available, we should use dynamic registration
        requiresDynamicRegistration: !!discovered.registration_endpoint,
        customHeaders: serviceConfig?.customHeaders,
      };
    }
    
    // Per MCP spec: For servers that do not implement OAuth 2.0 Authorization Server Metadata,
    // clients MUST use the following default endpoint paths relative to the authorization base URL
    console.log('[OAuth Config] No discovery available, using MCP default endpoints');
    
    // Check if it's a known service with static configuration first
    const serviceDomain = extractOAuthDomain(serverUrl);
    if (serviceDomain && OAUTH_SERVICES[serviceDomain]) {
      const serviceConfig = OAUTH_SERVICES[serviceDomain];
      
      // Use static configuration if available
      if (serviceConfig.authorizationEndpoint && serviceConfig.tokenEndpoint) {
        return {
          authorizationEndpoint: serviceConfig.authorizationEndpoint,
          tokenEndpoint: serviceConfig.tokenEndpoint,
          registrationEndpoint: serviceConfig.registrationEndpoint,
          userinfo_endpoint: undefined, // Known services with static config typically don't provide userinfo endpoint
          scope: serviceConfig.scope || 'openid profile email',
          // OAuth 2.1 requires PKCE for public clients - always enable it
          supportsPKCE: true,
          requiresClientRegistration: serviceConfig.requiresClientRegistration ?? true,
          requiresDynamicRegistration: false, // Known services typically don't support dynamic registration
          customHeaders: serviceConfig.customHeaders,
        };
      }
    }
    
    // Use MCP default endpoints as fallback
    return {
      authorizationEndpoint: `${authorizationBaseUrl}/authorize`,
      tokenEndpoint: `${authorizationBaseUrl}/token`,
      registrationEndpoint: `${authorizationBaseUrl}/register`,
      userinfo_endpoint: `${authorizationBaseUrl}/userinfo`, // Standard OpenID Connect endpoint
      scope: 'openid profile email',
      supportsPKCE: true,
      requiresClientRegistration: true,
      requiresDynamicRegistration: true, // Assume dynamic registration is supported by default
      customHeaders: {},
    };
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

/**
 * Dynamic Client Registration according to RFC7591
 * This allows MCP clients to obtain OAuth client IDs without user interaction
 */
export interface DynamicClientRegistrationRequest {
  client_name: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
  token_endpoint_auth_method?: string;
  application_type?: string;
  // Additional optional fields from RFC7591
  client_uri?: string;
  logo_uri?: string;
  tos_uri?: string;
  policy_uri?: string;
}

export interface DynamicClientRegistrationResponse {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
  token_endpoint_auth_method?: string;
  // Additional fields that might be returned
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  tos_uri?: string;
  policy_uri?: string;
}

/**
 * Perform OAuth 2.0 Dynamic Client Registration
 * Follows RFC7591 and MCP specification requirements
 */
export async function performDynamicClientRegistration(
  registrationEndpoint: string,
  request: DynamicClientRegistrationRequest
): Promise<DynamicClientRegistrationResponse | null> {
  try {
    console.log('[OAuth Registration] Attempting dynamic client registration at:', registrationEndpoint);
    console.log('[OAuth Registration] Registration request:', request);
    
    const response = await fetch(registrationEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(request),
    });
    
    if (response.ok) {
      const registrationData = await response.json();
      console.log('[OAuth Registration] Successfully registered client:', registrationData);
      return registrationData as DynamicClientRegistrationResponse;
    } else {
      const errorText = await response.text();
      console.error('[OAuth Registration] Registration failed:', response.status, errorText);
      
      // Try to parse error response
      try {
        const errorData = JSON.parse(errorText);
        console.error('[OAuth Registration] Error details:', errorData);
      } catch {
        // Not JSON error response
      }
      
      return null;
    }
  } catch (error) {
    console.error('[OAuth Registration] Error during registration:', error);
    return null;
  }
}

/**
 * Get or register OAuth client dynamically
 * This follows the MCP specification for dynamic client registration
 */
export async function getOrRegisterOAuthClient(
  serverUrl: string,
  registrationEndpoint: string
): Promise<{ clientId: string; clientSecret?: string } | null> {
  try {
    // Check if we already have a registered client for this server
    const storageKey = `oauth_client_${new URL(serverUrl).host}`;
    const storedClient = sessionStorage.getItem(storageKey);
    
    if (storedClient) {
      try {
        const clientData = JSON.parse(storedClient);
        console.log('[OAuth Registration] Using stored client registration:', clientData.clientId);
        return clientData;
      } catch {
        // Invalid stored data, proceed with new registration
      }
    }
    
    // Prepare registration request
    const registrationRequest: DynamicClientRegistrationRequest = {
      client_name: 'MCP SSE Tester',
      redirect_uris: [`${window.location.origin}/oauth/callback`],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      scope: 'openid profile email',
      token_endpoint_auth_method: 'none', // Public client
      application_type: 'web',
      client_uri: window.location.origin,
    };
    
    // Perform dynamic registration
    const registrationResponse = await performDynamicClientRegistration(
      registrationEndpoint,
      registrationRequest
    );
    
    if (registrationResponse) {
      // Store the client registration for future use
      const clientData = {
        clientId: registrationResponse.client_id,
        clientSecret: registrationResponse.client_secret,
        registeredAt: new Date().toISOString(),
      };
      
      sessionStorage.setItem(storageKey, JSON.stringify(clientData));
      console.log('[OAuth Registration] Client registered and stored:', clientData.clientId);
      
      return {
        clientId: registrationResponse.client_id,
        clientSecret: registrationResponse.client_secret,
      };
    }
    
    return null;
  } catch (error) {
    console.error('[OAuth Registration] Error getting/registering client:', error);
    return null;
  }
}