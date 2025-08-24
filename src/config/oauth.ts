// OAuth configuration using Cloudflare Worker exclusively

export interface OAuthConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}

// Cloudflare Worker URL - should be configured in environment
const cloudflareWorkerUrl = import.meta.env.VITE_OAUTH_WORKER_URL || 'https://oauth-worker.livecart.workers.dev';

// OAuth configuration
export const oauthConfig: OAuthConfig = {
  authorizationEndpoint: `${cloudflareWorkerUrl}/oauth/authorize`,
  tokenEndpoint: `${cloudflareWorkerUrl}/oauth/token`,
  clientId: 'mcptest-client',
  redirectUri: `${window.location.origin}/oauth/callback`,
  scope: 'openid profile email'
};

// Helper to check if OAuth is configured for Cloudflare Worker
export const isUsingCloudflareOAuth = (): boolean => {
  return true; // Always using Cloudflare Worker now
};

// Helper to get OAuth server type for logging
export const getOAuthServerType = (): string => {
  return 'Cloudflare Worker';
};