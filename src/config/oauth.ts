// OAuth configuration - follows MCP specification for dynamic client registration

export interface OAuthConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  redirectUri: string;
  scope: string;
}

// OAuth configuration - minimal configuration per MCP spec
// Client credentials should be obtained via dynamic registration (RFC7591)
export const oauthConfig: OAuthConfig = {
  authorizationEndpoint: '/oauth/authorize',
  tokenEndpoint: '/oauth/token',
  redirectUri: `${window.location.origin}/oauth/callback`,
  scope: 'openid profile email'
};

