// OAuth configuration with support for both localhost and Cloudflare Worker endpoints

export interface OAuthConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}

// Determine if we're using Cloudflare Worker or localhost based on environment
const useCloudflareWorker = import.meta.env.VITE_USE_CLOUDFLARE_OAUTH === 'true' || 
                          import.meta.env.PROD; // Use Cloudflare Worker in production by default

// Cloudflare Worker URL - should be configured in environment
const cloudflareWorkerUrl = import.meta.env.VITE_OAUTH_WORKER_URL || 'https://mcptest-oauth-worker.workers.dev';

// Get the base URL for OAuth endpoints
const getOAuthBaseUrl = (): string => {
  if (useCloudflareWorker) {
    return cloudflareWorkerUrl;
  }
  
  // Fall back to localhost for development
  return 'http://localhost:3000';
};

// OAuth configuration
export const oauthConfig: OAuthConfig = {
  authorizationEndpoint: `${getOAuthBaseUrl()}/oauth/authorize`,
  tokenEndpoint: `${getOAuthBaseUrl()}/oauth/token`,
  clientId: 'mcptest-client',
  redirectUri: `${window.location.origin}/oauth/callback`,
  scope: 'openid profile email'
};

// Helper to check if OAuth is configured for Cloudflare Worker
export const isUsingCloudflareOAuth = (): boolean => {
  return useCloudflareWorker;
};

// Helper to get OAuth server type for logging
export const getOAuthServerType = (): string => {
  return useCloudflareWorker ? 'Cloudflare Worker' : 'Localhost';
};