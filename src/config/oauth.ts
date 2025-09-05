// OAuth configuration - follows MCP specification for dynamic client registration

export interface OAuthConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  redirectUri: string;
  scope: string;
}

// Cloudflare Worker URL - should be configured in environment
const cloudflareWorkerUrl = import.meta.env.VITE_OAUTH_WORKER_URL || 'https://oauth-worker.livecart.workers.dev';

// OAuth configuration - minimal configuration per MCP spec
// Client credentials should be obtained via dynamic registration (RFC7591)
export const oauthConfig: OAuthConfig = {
  authorizationEndpoint: `${cloudflareWorkerUrl}/oauth/authorize`,
  tokenEndpoint: `${cloudflareWorkerUrl}/oauth/token`,
  redirectUri: `${window.location.origin}/oauth/callback`,
  scope: 'openid profile email'
};

// Helper to check if OAuth is configured for Cloudflare Worker
export const isUsingCloudflareOAuth = (): boolean => {
  return true; // Always using Cloudflare Worker now
};

// Helper to get OAuth server type for logging
export const getOAuthServerType = (): string => {
  return 'OAuth 2.1 Compliant Server';
};