import { useState, useRef, useCallback, useEffect } from 'react';
import { LogEntry, ResourceTemplate, TransportType } from '../types'; // Keep ResourceTemplate for handleConnect signature
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"; // Use correct import path
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { formatErrorForDisplay } from '../utils/errorHandling';
import { detectTransport, attemptParallelConnections } from '../utils/transportDetection';
import { CorsAwareStreamableHTTPTransport } from '../utils/corsAwareTransport';
import { logEvent } from '../utils/analytics';
import { useAuth } from '../context/AuthContext';
import { generatePKCE } from '../utils/pkce';
import { getOAuthConfig, isOAuthService, getOAuthServiceName, getOrRegisterOAuthClient } from '../utils/oauthDiscovery';

const RECENT_SERVERS_KEY = 'mcpRecentServers';
const MAX_RECENT_SERVERS = 100;

// Helper to load recent servers from localStorage
const loadRecentServers = (): string[] => {
  try {
    const stored = localStorage.getItem(RECENT_SERVERS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        // Handle both old format (string[]) and new format ({ url: string, useProxy?: boolean }[])
        return parsed.map(item => {
          if (typeof item === 'string') {
            return item;
          } else if (item && typeof item.url === 'string') {
            return item.url;
          }
          return null;
        }).filter(Boolean) as string[];
      }
    }
  } catch (e) {
    console.error("Failed to load or parse recent servers from localStorage:", e);
  }
  return [];
};

// Helper to save recent servers to localStorage
// Helper to save recent servers to localStorage with proxy state
const saveRecentServers = (servers: (string | { url: string; useProxy?: boolean })[]) => {
  console.log("[DEBUG] Attempting to save recent servers:", servers); // Log the array itself
  try {
    // Convert to the format we want to save
    const serversToSave = servers.map(server => {
      if (typeof server === 'string') {
        return { url: server };
      }
      return server;
    });
    
    const jsonString = JSON.stringify(serversToSave);
    console.log("[DEBUG] Stringified recent servers:", jsonString);
    localStorage.setItem(RECENT_SERVERS_KEY, jsonString);
    console.log("[DEBUG] Successfully saved recent servers to localStorage.");
  } catch (e) {
    console.error("Failed to save recent servers to localStorage:", e);
    // Log the problematic array again on error
    console.error("[DEBUG] Data that caused save error:", servers);
  }
};


export const useConnection = (addLogEntry: (entryData: Omit<LogEntry, 'timestamp'>) => void, useProxy?: boolean, useOAuth?: boolean, onAuthFlowStart?: () => void) => {
  const [recentServers, setRecentServers] = useState<string[]>(loadRecentServers);
  const [serverUrl, setServerUrl] = useState<string>(recentServers[0] || 'http://localhost:3033/mcp');
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [transportType, setTransportType] = useState<TransportType | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStartTime, setConnectionStartTime] = useState<Date | null>(null);
  const [connectionError, setConnectionError] = useState<{ error: string; serverUrl: string; timestamp: Date; details?: string } | null>(null);
  const clientRef = useRef<Client | null>(null); // Store the SDK Client instance
  const abortControllerRef = useRef<AbortController | null>(null);
  const { currentUser } = useAuth();
  const [isProxied, setIsProxied] = useState(false); // State to track if current connection is proxied
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isAuthFlowActive, setIsAuthFlowActive] = useState(false);
  const [oauthProgress, setOauthProgress] = useState<string | null>(null);
  const [needsOAuthConfig, setNeedsOAuthConfig] = useState(false);
  const [oauthConfigServerUrl, setOAuthConfigServerUrl] = useState<string | null>(null);
  const [oauthUserInfo, setOauthUserInfo] = useState<any>(null);
  const [isOAuthConnection, setIsOAuthConnection] = useState(false); // Track if current connection uses OAuth

  // Ref for strict mode check
  const isRealUnmount = useRef(false);
  const strictModeRenderCount = useRef(0);
  useEffect(() => {
    strictModeRenderCount.current += 1;
    return () => { if (strictModeRenderCount.current > 1) isRealUnmount.current = true; };
  }, []);

  // Check for stored access token on mount and when connection changes
  useEffect(() => {
    if (!serverUrl) return; // Skip if no serverUrl
    try {
      const storedToken = sessionStorage.getItem(`oauth_access_token_${new URL(addProtocolIfMissing(serverUrl)).host}`)
      if (storedToken) {
        setAccessToken(storedToken);
        console.log('[OAuth] Access token found in sessionStorage');
      }
    } catch (error) {
      console.warn('[OAuth] Invalid serverUrl for token lookup:', serverUrl, error);
    }
  }, [connectionStatus]); // Re-check when connection status changes

  // Always check sessionStorage for the latest token before connecting
  const getLatestAccessToken = useCallback(() => {
    if (!serverUrl) {
      console.log('[OAuth] No serverUrl provided for token lookup');
      return accessToken; // Return existing token if no serverUrl
    }
    try {
      const normalizedUrl = addProtocolIfMissing(serverUrl);
      const host = new URL(normalizedUrl).host;
      const storedToken = sessionStorage.getItem(`oauth_access_token_${host}`);
      
      console.log('[OAuth] Token lookup:', {
        serverUrl,
        host,
        tokenKey: `oauth_access_token_${host}`,
        hasStoredToken: !!storedToken,
        hasCurrentToken: !!accessToken,
        tokensMatch: storedToken === accessToken
      });
      
      if (storedToken && storedToken !== accessToken) {
        console.log('[OAuth] Found updated access token in sessionStorage');
        setAccessToken(storedToken);
      }
      return storedToken || accessToken;
    } catch (error) {
      console.warn('[OAuth] Invalid serverUrl for token lookup:', serverUrl, error);
      return accessToken;
    }
  }, [accessToken, serverUrl])

  // Fetch OAuth user info when we have an access token
  useEffect(() => {
    const fetchUserInfo = async () => {
      if (!accessToken || connectionStatus !== 'Connected' || !isOAuthConnection) {
        console.log('[OAuth] Skipping user info fetch:', { 
          hasAccessToken: !!accessToken, 
          connectionStatus, 
          isOAuthConnection 
        });
        return;
      }

      try {
        // Get OAuth endpoints from session storage (per server)
        if (!serverUrl) {
          console.log('[OAuth] No serverUrl available for user info fetch');
          return;
        }
        const serverHost = new URL(addProtocolIfMissing(serverUrl)).host;
        const storedEndpoints = sessionStorage.getItem(`oauth_endpoints_${serverHost}`);
        if (!storedEndpoints) {
          console.log('[OAuth] No OAuth endpoints found, skipping user info fetch');
          return;
        }

        const oauthEndpoints = JSON.parse(storedEndpoints);
        if (!oauthEndpoints.userinfo_endpoint) {
          console.log('[OAuth] No userinfo endpoint in OAuth configuration');
          // Set a default user info if userinfo endpoint is not available
          setOauthUserInfo({
            name: 'OAuth User',
            email: 'OAuth authenticated',
            sub: 'oauth-user'
          });
          return;
        }

        console.log('[OAuth] Fetching user info from:', oauthEndpoints.userinfo_endpoint);
        
        const response = await fetch(oauthEndpoints.userinfo_endpoint, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
          }
        });

        if (response.ok) {
          const userInfo = await response.json();
          console.log('[OAuth] User info fetched successfully:', userInfo);
          setOauthUserInfo(userInfo);
          addLogEntry({
            type: 'info',
            data: '✅ OAuth user information retrieved successfully'
          });
        } else {
          console.error('[OAuth] Failed to fetch user info:', response.status, response.statusText);
          // Don't show error to user as this is optional
        }
      } catch (error) {
        console.error('[OAuth] Error fetching user info:', error);
        // Don't show error to user as this is optional
      }
    };

    fetchUserInfo();
  }, [accessToken, connectionStatus, isOAuthConnection, addLogEntry]);

  // --- SDK Client Based Logic ---

  const cleanupConnection = useCallback(async () => {
    // Clean up SDK client ref and attempt to close the connection.
    if (clientRef.current) {
       console.log("[DEBUG] cleanupConnection: Closing SDK client connection and cleaning up ref.");
       try {
         await clientRef.current.close(); // Attempt to close the client connection
         console.log("[DEBUG] SDK Client closed successfully.");
       } catch (error) {
         console.error("[DEBUG] Error closing SDK client:", error);
         // Log the error but continue cleanup
         addLogEntry({ type: 'error', data: `Error during disconnect cleanup: ${error}` });
       } finally {
         clientRef.current = null; // Null the ref regardless of close success/failure
       }
    } else {
        console.log("[DEBUG] cleanupConnection: No active client ref to clean up.");
    }
    setConnectionStatus('Disconnected');
    setTransportType(null);
    setIsConnecting(false);
    setConnectionStartTime(null);
    setIsProxied(false);
    setIsAuthFlowActive(false);
    setOauthProgress(null);
    setNeedsOAuthConfig(false);
    setOAuthConfigServerUrl(null);
    setOauthUserInfo(null);
    setIsOAuthConnection(false);
    
    // Clear server-specific OAuth tokens and endpoints on disconnect
    if (serverUrl) {
      try {
        const serverHost = new URL(addProtocolIfMissing(serverUrl)).host;
        sessionStorage.removeItem(`oauth_access_token_${serverHost}`);
        sessionStorage.removeItem(`oauth_refresh_token_${serverHost}`);
        sessionStorage.removeItem(`oauth_endpoints_${serverHost}`);
        console.log(`[OAuth] Cleared tokens and endpoints for server: ${serverHost}`);
      } catch (error) {
        console.error('[OAuth] Error clearing server-specific tokens:', error);
      }
    }
    
    // Clear access token from state
    setAccessToken(null);
    
    // Abort any ongoing connection attempt
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    console.log('[DEBUG] Connection cleanup complete.');
  }, [addLogEntry, serverUrl]); // Added addLogEntry and serverUrl dependencies

  const handleDisconnect = useCallback(async () => {
    if (connectionStatus !== 'Disconnected' && !isConnecting) {
        logEvent('disconnect');
        addLogEntry({ type: 'info', data: 'Disconnecting...' });
        await cleanupConnection();
    }
  }, [connectionStatus, isConnecting, addLogEntry, cleanupConnection, serverUrl]);

  const handleAbortConnection = useCallback(() => {
    if (isConnecting && abortControllerRef.current) {
      logEvent('connect_abort');
      console.log('[DEBUG] Aborting connection attempt...');
      abortControllerRef.current.abort();
      addLogEntry({ type: 'info', data: 'Connection aborted by user' });
      cleanupConnection();
    }
  }, [isConnecting, addLogEntry, cleanupConnection, serverUrl]);

  // Helper function to detect and add protocol if missing
  const addProtocolIfMissing = (url: string): string => {
    if (!url) return url;
    
    // If URL already has a protocol, return as-is
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    
    // Default to HTTPS for URLs without protocol
    return `https://${url}`;
  };

  // Helper function to get HTTP version of a URL
  const getHttpVersion = (url: string): string => {
    return url.replace(/^https:\/\//, 'http://');
  };

  // Modify handleConnect to accept an optional URL override
  const handleConnect = useCallback(async (
    // Keep setters for potential future use or different connect flows
    setTools: React.Dispatch<React.SetStateAction<any[]>>,
    setResources: React.Dispatch<React.SetStateAction<ResourceTemplate[]>>,
    setResponses: React.Dispatch<React.SetStateAction<LogEntry[]>>,
    urlToConnect?: string, // Optional URL parameter
    forceUseProxy?: boolean // Optional proxy override
  ) => {
    const rawUrl = urlToConnect || serverUrl; // Use override or state URL
    const targetUrl = addProtocolIfMissing(rawUrl); // Add protocol if missing
    logEvent('connect_attempt');

    // Clear any previous connection error
    setConnectionError(null);

    // Allow connect attempt even if already connected, but not if currently connecting or no target URL
    if (!targetUrl || isConnecting) {
        console.log(`[DEBUG] handleConnect: Connect cancelled (Target URL: ${targetUrl}, IsConnecting: ${isConnecting})`);
        return;
    }

    // Always get the latest access token from sessionStorage
    const latestAccessToken = getLatestAccessToken();
    
    // Check if OAuth is enabled and initiate OAuth flow
    if (useOAuth && !latestAccessToken) {
      // Check if we just completed OAuth (to prevent immediate re-authentication)
      const oauthCompletedTime = sessionStorage.getItem('oauth_completed_time');
      if (oauthCompletedTime) {
        const timeSinceCompletion = Date.now() - parseInt(oauthCompletedTime);
        // If OAuth was completed within the last 10 seconds, don't restart it
        if (timeSinceCompletion < 10000) {
          console.log('[DEBUG] OAuth was just completed, skipping re-authentication');
          addLogEntry({ 
            type: 'warning', 
            data: `⚠️ OAuth authentication was just completed ${Math.round(timeSinceCompletion / 1000)}s ago. Connection may require additional configuration.` 
          });
          setIsConnecting(false);
          setConnectionStatus('Disconnected');
          cleanupConnection();
          return;
        }
      }
      
      console.log('[DEBUG] OAuth enabled but no access token, initiating OAuth flow...');
      
      // Check if this is a known OAuth service
      const serviceName = getOAuthServiceName(targetUrl);
      
      addLogEntry({ 
        type: 'info', 
        data: `🔐 OAuth 2.1 Flow Started: ${serviceName ? `Detected ${serviceName} - ` : ''}Beginning authorization with PKCE` 
      });
      
      setIsAuthFlowActive(true);
      setOauthProgress('Starting OAuth 2.1 authorization process...');
      
      // Notify parent component that OAuth flow is starting
      if (onAuthFlowStart) {
        onAuthFlowStart();
      }
      
      // Generate PKCE challenge
      let code_verifier: string;
      let code_challenge: string;
      
      addLogEntry({ 
        type: 'info', 
        data: '📋 Step 1/5: Generating PKCE (Proof Key for Code Exchange) parameters...' 
      });
      setOauthProgress('Step 1/5: Generating PKCE security parameters...');
      console.log('[OAuth Progress] Step 1/5: Generating PKCE parameters');
      
      try {
        const pkce = await generatePKCE();
        code_verifier = pkce.code_verifier;
        code_challenge = pkce.code_challenge;
        
        // Add debug logging
        addLogEntry({ 
          type: 'info', 
          data: `✅ PKCE generated successfully:\n  - Verifier: ${code_verifier.substring(0, 10)}... (${code_verifier.length} chars)\n  - Challenge: ${code_challenge.substring(0, 10)}... (${code_challenge.length} chars)` 
        });
        console.log('[OAuth Progress] PKCE generated successfully');
        console.log('[OAuth Debug] PKCE verifier:', code_verifier);
        console.log('[OAuth Debug] PKCE challenge:', code_challenge);
      } catch (error) {
        console.error('PKCE generation error:', error);
        addLogEntry({ 
          type: 'error', 
          data: `Failed to generate PKCE challenge: ${error instanceof Error ? error.message : 'Unknown error'}` 
        });
        setConnectionError({
          error: 'Failed to generate PKCE challenge. Please try again.',
          serverUrl: targetUrl,
          timestamp: new Date()
        });
        setIsConnecting(false);
        return;
      }
      
      sessionStorage.setItem('pkce_code_verifier', code_verifier);
      sessionStorage.setItem('oauth_server_url', targetUrl);
      
      // Store all active tabs before OAuth redirect so we can restore them
      const activeTabs = localStorage.getItem('mcpConnectionTabs');
      if (activeTabs) {
        sessionStorage.setItem('oauth_tabs_before_redirect', activeTabs);
        console.log('[OAuth] Stored active tabs before redirect');
      }
      
      // The tab ID is already stored by the TabContent component when OAuth flow starts
      const storedTabId = sessionStorage.getItem('oauth_tab_id');
      if (storedTabId) {
        console.log('[OAuth] Tab ID already stored for return navigation:', storedTabId);
      }
      
      addLogEntry({ 
        type: 'info', 
        data: '💾 Step 2/5: Stored PKCE verifier and server URL in session storage' 
      });
      setOauthProgress('Step 2/5: Storing security parameters...');
      console.log('[OAuth Progress] Step 2/5: Stored PKCE verifier and server URL');

      // Validate PKCE values before proceeding
      if (!code_verifier || !code_challenge) {
        addLogEntry({ 
          type: 'error', 
          data: 'Invalid PKCE values generated' 
        });
        setConnectionError({
          error: 'Failed to generate secure authentication parameters. Please try again.',
          serverUrl: targetUrl,
          timestamp: new Date()
        });
        setIsConnecting(false);
        return;
      }
      
      // Discover OAuth endpoints
      addLogEntry({ 
        type: 'info', 
        data: '🔍 Step 3/6: Discovering OAuth endpoints...' 
      });
      setOauthProgress('Step 3/6: Discovering OAuth endpoints...');
      console.log('[OAuth Progress] Step 3/6: Discovering OAuth endpoints for', targetUrl);
      
      let oauthEndpoints;
      try {
        oauthEndpoints = await getOAuthConfig(targetUrl);
        
        if (!oauthEndpoints) {
          // For any server where discovery fails, try to construct standard OAuth endpoints
          const url = new URL(targetUrl);
          const baseUrl = `${url.protocol}//${url.host}`;
          
          addLogEntry({ 
            type: 'info', 
            data: '📋 OAuth discovery failed, trying standard OAuth paths...' 
          });
          
          // Try common OAuth 2.1 endpoint patterns
          // According to MCP spec, these should be the standard paths
          oauthEndpoints = {
            authorizationEndpoint: `${baseUrl}/oauth/authorize`,
            tokenEndpoint: `${baseUrl}/oauth/token`,
            scope: 'openid profile email',
            supportsPKCE: true, // OAuth 2.1 requires PKCE
            requiresClientRegistration: true,
          };
          
          addLogEntry({ 
            type: 'info', 
            data: `✅ Using standard OAuth endpoints:\n  - Authorization: ${oauthEndpoints.authorizationEndpoint}\n  - Token: ${oauthEndpoints.tokenEndpoint}` 
          });
        } else {
          addLogEntry({ 
            type: 'info', 
            data: `✅ OAuth endpoints discovered:\n  - Authorization: ${oauthEndpoints.authorizationEndpoint}\n  - Token: ${oauthEndpoints.tokenEndpoint}\n  - PKCE Support: ${oauthEndpoints.supportsPKCE ? 'Yes' : 'No'}\n  - Client Registration Required: ${oauthEndpoints.requiresClientRegistration ? 'Yes' : 'No'}` 
          });
        }
      } catch (error) {
        console.error('OAuth discovery failed:', error);
        addLogEntry({ 
          type: 'error', 
          data: `Failed to discover OAuth endpoints: ${error instanceof Error ? error.message : 'Unknown error'}` 
        });
        setConnectionError({
          error: 'Failed to discover OAuth endpoints. Please check if the service supports OAuth 2.0.',
          serverUrl: targetUrl,
          timestamp: new Date()
        });
        setIsConnecting(false);
        return;
      }
      
      // Store discovered endpoints for callback (per server)
      const serverHost = new URL(targetUrl).host;
      sessionStorage.setItem(`oauth_endpoints_${serverHost}`, JSON.stringify(oauthEndpoints));
      
      // Build authorization URL
      addLogEntry({ 
        type: 'info', 
        data: '🔗 Step 4/7: Checking for dynamic client registration...' 
      });
      setOauthProgress('Step 4/7: Checking client registration...');
      console.log('[OAuth Progress] Step 4/7: Checking client registration');
      
      let oauthClientId: string | null = null;
      let oauthClientSecret: string | null = null;
      
      // Try dynamic client registration if supported
      if (oauthEndpoints.registrationEndpoint) {
        addLogEntry({ 
          type: 'info', 
          data: '🔐 Step 5/7: Performing dynamic client registration...' 
        });
        setOauthProgress('Step 5/7: Registering OAuth client...');
        console.log('[OAuth Progress] Step 5/7: Dynamic client registration at', oauthEndpoints.registrationEndpoint);
        
        const clientRegistration = await getOrRegisterOAuthClient(targetUrl, oauthEndpoints.registrationEndpoint);
        
        if (clientRegistration) {
          oauthClientId = clientRegistration.clientId;
          oauthClientSecret = clientRegistration.clientSecret || null;
          
          addLogEntry({ 
            type: 'info', 
            data: `✅ OAuth client registered successfully:\n  - Client ID: ${oauthClientId}\n  - Client Secret: ${oauthClientSecret ? 'Provided' : 'Not required (public client)'}` 
          });
        } else {
          addLogEntry({ 
            type: 'error', 
            data: '❌ Dynamic client registration failed. The server may not support RFC7591.' 
          });
          
          // For known services that don't support dynamic registration, show config dialog
          if (serviceName && oauthEndpoints.requiresClientRegistration) {
            addLogEntry({ 
              type: 'warning', 
              data: `⚠️ ${serviceName} requires manual OAuth client registration. You need to:\n  1. Register your application with ${serviceName}\n  2. Configure the client ID and secret\n  3. Add ${window.location.origin}/oauth/callback as a redirect URI` 
            });
            
            // Show OAuth config dialog
            setNeedsOAuthConfig(true);
            setOAuthConfigServerUrl(targetUrl);
            setIsConnecting(false);
            setIsAuthFlowActive(false);
            return;
          }
          
          // For unknown services, we cannot proceed without client registration
          setConnectionError({
            error: 'OAuth client registration failed. This server requires OAuth but does not support dynamic client registration.',
            serverUrl: targetUrl,
            timestamp: new Date(),
            details: 'Per MCP specification, dynamic client registration (RFC7591) is recommended for OAuth-enabled servers.'
          });
          setIsConnecting(false);
          setIsAuthFlowActive(false);
          return;
        }
      } else {
        // Check if we have manually configured server-specific credentials
        const serverHost = new URL(targetUrl).host;
        const dynamicClientKey = `oauth_client_${serverHost}`;
        const storedClientData = sessionStorage.getItem(dynamicClientKey);
        
        if (storedClientData) {
          try {
            const clientData = JSON.parse(storedClientData);
            if (clientData.registeredManually && clientData.clientId) {
              oauthClientId = clientData.clientId;
              oauthClientSecret = clientData.clientSecret;
              addLogEntry({ 
                type: 'info', 
                data: `📋 Step 5/7: Using manually configured OAuth credentials for ${serverHost}` 
              });
            }
          } catch (e) {
            console.error('[OAuth] Failed to parse stored client data:', e);
          }
        }
        
        if (!oauthClientId && oauthEndpoints.requiresClientRegistration) {
          // No dynamic registration and no manual credentials
          addLogEntry({ 
            type: 'warning', 
            data: `⚠️ OAuth client registration required. ${serviceName || 'This service'} does not support dynamic registration.` 
          });
          
          // Show OAuth config dialog
          setNeedsOAuthConfig(true);
          setOAuthConfigServerUrl(targetUrl);
          setIsConnecting(false);
          setIsAuthFlowActive(false);
          return;
        }
      }
      
      // Ensure we have a client ID
      if (!oauthClientId) {
        addLogEntry({ 
          type: 'error', 
          data: 'OAuth client ID not available. Cannot proceed with authorization.' 
        });
        setConnectionError({
          error: 'OAuth client ID not configured',
          serverUrl: targetUrl,
          timestamp: new Date()
        });
        setIsConnecting(false);
        return;
      }
      
      // Build authorization URL
      addLogEntry({ 
        type: 'info', 
        data: '🔗 Step 6/7: Building OAuth authorization URL...' 
      });
      setOauthProgress('Step 6/7: Building authorization URL...');
      console.log('[OAuth Progress] Step 6/7: Building authorization URL');
      
      // Validate authorization endpoint before constructing URL
      if (!oauthEndpoints.authorizationEndpoint) {
        addLogEntry({ 
          type: 'error', 
          data: '❌ OAuth authorization endpoint is missing or undefined' 
        });
        setConnectionError({
          error: 'OAuth configuration error: Authorization endpoint is missing',
          serverUrl: targetUrl,
          timestamp: new Date(),
          details: 'The OAuth service did not provide a valid authorization endpoint URL.'
        });
        setIsConnecting(false);
        setIsAuthFlowActive(false);
        return;
      }
      
      let authUrl: URL;
      try {
        authUrl = new URL(oauthEndpoints.authorizationEndpoint);
      } catch (error) {
        addLogEntry({ 
          type: 'error', 
          data: `❌ Invalid OAuth authorization endpoint URL: ${oauthEndpoints.authorizationEndpoint}` 
        });
        setConnectionError({
          error: `Invalid OAuth authorization endpoint: ${oauthEndpoints.authorizationEndpoint}`,
          serverUrl: targetUrl,
          timestamp: new Date(),
          details: `Failed to construct URL: ${error instanceof Error ? error.message : 'Invalid URL format'}`
        });
        setIsConnecting(false);
        setIsAuthFlowActive(false);
        return;
      }
      
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', oauthClientId);
      authUrl.searchParams.set('redirect_uri', `${window.location.origin}/oauth/callback`);
      
      // OAuth 2.1 requires PKCE for all public clients
      // Always add PKCE parameters
      authUrl.searchParams.set('code_challenge', code_challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      
      authUrl.searchParams.set('scope', oauthEndpoints.scope);
      
      // Log the authorization URL for debugging
      addLogEntry({ 
        type: 'info', 
        data: `📝 Authorization URL built:\n  - Service: ${serviceName || 'OAuth Service'}\n  - Endpoint: ${oauthEndpoints.authorizationEndpoint}\n  - Client ID: ${oauthClientId}\n  - Redirect URI: ${window.location.origin}/oauth/callback\n  - Scopes: ${oauthEndpoints.scope}\n  - PKCE: ${oauthEndpoints.supportsPKCE ? 'Enabled (S256)' : 'Disabled'}` 
      });
      console.log('[OAuth Progress] Authorization URL:', authUrl.toString());
      
      // First, try to get server metadata to check if it requires authentication
      addLogEntry({ 
        type: 'info', 
        data: '🌐 Step 7/7: Checking authorization endpoint accessibility...' 
      });
      setOauthProgress('Step 7/7: Checking authorization endpoint...');
      console.log('[OAuth Progress] Step 7/7: Checking authorization endpoint');
      
      try {
        // Attempt to fetch the authorization endpoint with credentials
        const existingToken = sessionStorage.getItem('mcp_auth_token');
        addLogEntry({ 
          type: 'info', 
          data: `🔍 Making GET request to: ${authUrl.toString()}\n  - Including existing token: ${existingToken ? 'Yes' : 'No'}\n  - Redirect mode: manual` 
        });
        
        const authCheckResponse = await fetch(authUrl.toString(), {
          method: 'GET',
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            // If we have any existing auth token, include it
            ...(existingToken ? {
              'Authorization': `Bearer ${existingToken}`
            } : {})
          },
          redirect: 'manual' // Don't follow redirects automatically
        });

        addLogEntry({ 
          type: 'info', 
          data: `📡 Authorization endpoint response: ${authCheckResponse.status} ${authCheckResponse.statusText}` 
        });
        
        if (authCheckResponse.status === 302 || authCheckResponse.status === 303) {
          // Server wants to redirect - follow it
          const redirectUrl = authCheckResponse.headers.get('Location');
          addLogEntry({ 
            type: 'info', 
            data: `✅ Authorization endpoint returned redirect (${authCheckResponse.status})\n  - Redirect location: ${redirectUrl || 'Not provided'}\n  - Following redirect...` 
          });
          setOauthProgress('Redirecting to authorization server...');
          console.log('[OAuth Progress] Redirecting to:', redirectUrl || authUrl.toString());
          if (redirectUrl) {
            window.location.href = redirectUrl;
            return;
          }
        } else if (authCheckResponse.status === 401) {
          // Server requires authentication for the auth endpoint itself
          addLogEntry({ 
            type: 'error', 
            data: `❌ Step 6/6 FAILED: Authorization endpoint returned 401 Unauthorized\n  - The OAuth server requires authentication to access the /oauth/authorize endpoint\n  - This typically means the server configuration needs adjustment\n  - Request URL: ${authUrl.toString()}` 
          });
          console.error('[OAuth Progress] OAuth endpoint returned 401 Unauthorized');
          setOauthProgress('OAuth authorization failed - server requires authentication');
          
          // Log the response details for debugging
          try {
            const responseText = await authCheckResponse.text();
            const responseHeaders = Array.from(authCheckResponse.headers.entries())
              .map(([key, value]) => `    ${key}: ${value}`)
              .join('\n');
            
            addLogEntry({ 
              type: 'error', 
              data: `📋 Response details:\n  - Status: ${authCheckResponse.status} ${authCheckResponse.statusText}\n  - Headers:\n${responseHeaders}\n  - Body: ${responseText ? responseText.substring(0, 200) + (responseText.length > 200 ? '...' : '') : '(empty)'}` 
            });
          } catch (e) {
            addLogEntry({ 
              type: 'error', 
              data: `⚠️ Could not read response body: ${e instanceof Error ? e.message : 'Unknown error'}` 
            });
          }
          
          setConnectionError({
            error: 'OAuth authorization endpoint requires authentication. Please check your server configuration and client credentials. For testing OAuth locally, use http://localhost:3000 as the server URL.',
            serverUrl: targetUrl,
            timestamp: new Date(),
            details: 'The OAuth server at ' + targetUrl + ' requires authentication to access its authorization endpoint. This is a server configuration issue.'
          });
          cleanupConnection();
          return;
        } else if (authCheckResponse.ok || authCheckResponse.status === 200) {
          // If we get HTML content, redirect to the auth URL
          addLogEntry({ 
            type: 'info', 
            data: `✅ Authorization endpoint is accessible (${authCheckResponse.status})\n  - Redirecting to authorization page...` 
          });
          setOauthProgress('Redirecting to authorization page...');
          console.log('[OAuth Progress] Redirecting to authorization page');
          
          
          window.location.href = authUrl.toString();
          return;
        } else {
          // Unexpected response - log and try redirect anyway
          console.log(`[DEBUG] Unexpected auth endpoint response: ${authCheckResponse.status}`);
          addLogEntry({ 
            type: 'warning', 
            data: `⚠️ Unexpected response from authorization endpoint (${authCheckResponse.status})\n  - Attempting redirect anyway...` 
          });
          setOauthProgress('Redirecting to authorization page...');
          window.location.href = authUrl.toString();
          return;
        }
      } catch (error) {
        // If fetch fails (CORS, network error, etc.), fall back to regular redirect
        console.log('[DEBUG] Auth endpoint check failed, falling back to redirect:', error);
        addLogEntry({ 
          type: 'warning', 
          data: `⚠️ Could not check authorization endpoint\n  - Error: ${error instanceof Error ? error.message : 'Unknown error'}\n  - This might be due to CORS restrictions\n  - Proceeding with direct redirect...` 
        });
        addLogEntry({ 
          type: 'info', 
          data: `➡️ Redirecting directly to authorization URL...` 
        });
        setOauthProgress('Redirecting to authorization URL...');
        console.log('[OAuth Progress] Direct redirect to:', authUrl.toString());
        window.location.href = authUrl.toString();
        return;
      }
    }

    setIsConnecting(true);
    setConnectionStatus('Connecting...');
    setTransportType(null);
    setConnectionStartTime(new Date());
    setResponses([]); // Clear logs for new connection attempt
    
    // Create abort controller for this connection attempt
    abortControllerRef.current = new AbortController();

    // --- Auto-disconnect if already connected ---
    if (connectionStatus === 'Connected') {
        console.log("[DEBUG] handleConnect: Already connected. Initiating disconnect first.");
        addLogEntry({ type: 'info', data: 'Disconnecting previous connection...' });
        await cleanupConnection(); // Disconnect the current connection cleanly
        // Add a small delay to allow state updates before proceeding
        await new Promise(resolve => setTimeout(resolve, 100));
        console.log("[DEBUG] handleConnect: Previous connection cleanup complete. Proceeding with new connection.");
    }
    // -----------------------------------------

    // We'll update the recent servers list after successful connection with the actual working URL

    if (clientRef.current) {
      console.log("[DEBUG] Cleaning up previous client instance before connecting.");
      clientRef.current = null; // Clear ref
    }

    let connectionSuccess = false;
    let finalClient: Client | null = null;
    let finalTransportType: TransportType | null = null;
    let finalUrl: string | null = null;
    let lastError: any = null;
    const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout after 30 seconds')), 30000)
    );

    // Helper function to attempt direct connection
    const connectDirectly = async () => {
      setIsProxied(false);
      addLogEntry({ type: 'info', data: `Attempting direct connection to ${targetUrl}...` });
      // Set OAuth connection flag based on whether we have an access token
      setIsOAuthConnection(!!latestAccessToken);
      if (latestAccessToken) {
        console.log('[OAuth] Using access token for connection:', latestAccessToken.substring(0, 20) + '...');
        addLogEntry({ type: 'info', data: `🔐 Using OAuth access token for authenticated connection` });
      }
      return attemptParallelConnections(targetUrl, abortControllerRef.current?.signal, latestAccessToken || undefined);
    };

    // Helper function to attempt proxy connection
    const connectViaProxy = async () => {
      if (!import.meta.env.VITE_PROXY_URL) {
        return Promise.reject(new Error("Proxy not configured."));
      }
      const proxyUrl = import.meta.env.VITE_PROXY_URL;
      const connectionUrl = `${proxyUrl}?target=${encodeURIComponent(targetUrl)}`;
      setIsProxied(true);
      addLogEntry({ type: 'info', data: `Direct connection failed with CORS error. Attempting connection via proxy to ${targetUrl}...` });
      let authToken: string | undefined;
      if (currentUser) {
        try {
          authToken = await currentUser.getIdToken();
          addLogEntry({ type: 'info', data: 'Authentication token obtained for proxy connection' });
        } catch (error) {
          console.error('[DEBUG] Failed to get auth token:', error);
          addLogEntry({ type: 'error', data: 'Failed to obtain authentication token for proxy' });
        }
      }
      // For proxy connections, prefer OAuth token over Firebase token
      const proxyAuthToken = latestAccessToken || authToken;
      // Set OAuth connection flag based on whether we have an OAuth token
      setIsOAuthConnection(!!latestAccessToken);
      return attemptParallelConnections(connectionUrl, abortControllerRef.current?.signal, proxyAuthToken);
    };

    try {
        // Always try direct connection first
        try {
          const result = await Promise.race([
            connectDirectly(),
            timeoutPromise
          ]);
          
          finalClient = result.client;
          finalTransportType = result.transportType;
          finalUrl = result.url;
          connectionSuccess = true;
          addLogEntry({ type: 'info', data: `Connection successful using ${result.transportType} at ${result.url}` });
        } catch (error: any) {
          // Check if it's a CORS error and if automatic proxy fallback is enabled
          const isCorsError = error.message?.toLowerCase().includes('cors') || 
                            (error.message?.toLowerCase().includes('failed to fetch') && 
                             !error.message?.toLowerCase().includes('network'));
          
          // Use forceUseProxy if provided, otherwise fall back to the hook's useProxy value
          const shouldUseProxy = forceUseProxy !== undefined ? forceUseProxy : useProxy;
          
          if (isCorsError && shouldUseProxy && currentUser) {
            // Attempt proxy connection as fallback only if user is logged in
            const result = await Promise.race([
              connectViaProxy(),
              timeoutPromise
            ]);
            finalClient = result.client;
            finalTransportType = result.transportType;
            finalUrl = result.url;
            connectionSuccess = true;
            addLogEntry({ type: 'info', data: `Proxy connection successful using ${result.transportType} at ${result.url}` });
          } else {
            if (isCorsError && shouldUseProxy && !currentUser) {
              addLogEntry({ type: 'warning', data: 'Proxy fallback disabled: User not logged in' });
            }
            throw error; // Re-throw if not a CORS error, proxy is disabled, or user not logged in
          }
        }

        // --- Finalize Connection ---
        if (connectionSuccess && finalClient && finalTransportType && finalUrl) {
            clientRef.current = finalClient;
            setTransportType(finalTransportType);
            
            // Extract the actual URL that was connected to (with correct endpoint)
            let displayUrl = targetUrl; // Default to original target
            try {
                const finalUrlObj = new URL(finalUrl);
                
                // For proxy URLs, extract the target parameter
                if (finalUrlObj.searchParams.has('target')) {
                    displayUrl = finalUrlObj.searchParams.get('target') || targetUrl;
                } else {
                    // For direct URLs, use the final URL which includes the correct endpoint
                    displayUrl = finalUrl;
                }
                
                console.log(`[DEBUG] Setting display URL: ${displayUrl} (from finalUrl: ${finalUrl})`);
            } catch (error) {
                console.error('[DEBUG] Error parsing final URL:', error);
                // Fall back to original target URL
            }
            
            setServerUrl(displayUrl); // Set UI URL to the actual connected URL with endpoint
            setConnectionStatus('Connected');
            setIsConnecting(false);
            addLogEntry({ type: 'info', data: `SDK Client Connected successfully.` });
            logEvent('connect_success', { 
              transport_type: finalTransportType,
              is_proxied: isProxied,
            });
            setTools([]);
            setResources([]);
            
            // Update recent servers list with the original URL (without transport-specific endpoints)
            // We want to save the base URL without /mcp or /sse endpoints for flexibility
            let urlToSave = targetUrl; // Default to original target URL
            
            try {
                // Remove transport-specific endpoints from the URL before saving
                const url = new URL(targetUrl);
                url.pathname = url.pathname.replace(/\/(mcp|sse)\/?$/, '');
                urlToSave = url.toString();
            } catch (error) {
                console.error('[DEBUG] Error normalizing URL for recent servers:', error);
                // Fall back to original target URL
            }
            
            const updatedServers = [urlToSave, ...recentServers.filter(url => url !== urlToSave)];
            const limitedServers = updatedServers.slice(0, MAX_RECENT_SERVERS);
            setRecentServers(limitedServers); // Update state
            saveRecentServers(Array.from(limitedServers)); // Save to localStorage
            console.log('[DEBUG] Saved successful URL to recent servers:', urlToSave);
        }

    } catch (error: any) {
        const isUserAborted = error.message && error.message.includes('Connection aborted by user');
        if (!isUserAborted) {
            // Check if this is a 401 Unauthorized error
            const is401Error = error.message && (
                error.message.includes('401') || 
                error.message.toLowerCase().includes('unauthorized') ||
                error.statusCode === 401 ||
                error.status === 401
            );
            
            if (is401Error && !useOAuth) {
                // Attempt OAuth discovery for 401 errors
                console.log('[OAuth] 401 error detected, attempting OAuth discovery...');
                addLogEntry({ type: 'info', data: '🔐 Authentication required. Checking for OAuth support...' });
                
                try {
                    const oauthConfig = await getOAuthConfig(targetUrl);
                    
                    if (oauthConfig) {
                        // OAuth is available for this service
                        const serviceName = getOAuthServiceName(targetUrl);
                        addLogEntry({ 
                            type: 'info', 
                            data: `✅ OAuth authentication available${serviceName ? ` for ${serviceName}` : ''}. Configuration required.` 
                        });
                        
                        // Show OAuth configuration dialog
                        setNeedsOAuthConfig(true);
                        setOAuthConfigServerUrl(targetUrl);
                        setIsConnecting(false);
                        
                        // Clear the connection error since we're handling it with OAuth
                        return;
                    } else {
                        // No OAuth available, show the original error
                        addLogEntry({ 
                            type: 'warning', 
                            data: 'OAuth discovery failed. The server requires authentication but does not support OAuth.' 
                        });
                    }
                } catch (discoveryError) {
                    console.error('OAuth discovery error:', discoveryError);
                    addLogEntry({ 
                        type: 'warning', 
                        data: `OAuth discovery failed: ${discoveryError instanceof Error ? discoveryError.message : 'Unknown error'}` 
                    });
                }
            }
            
            // Handle all other errors normally
            logEvent('connect_failure');
            const errorDetails = formatErrorForDisplay(error, {
                serverUrl: targetUrl, // Report error against the target URL
                operation: 'connection'
            });
            setConnectionError({
                error: errorDetails,
                serverUrl: targetUrl,
                timestamp: new Date(),
                details: error.stack || error.toString()
            });
            addLogEntry({ type: 'error', data: `Connection failed: ${errorDetails}` });
        }
        cleanupConnection();
    }
  }, [serverUrl, isConnecting, connectionStatus, recentServers, addLogEntry, cleanupConnection, useProxy, currentUser, isProxied, useOAuth, accessToken, getLatestAccessToken]); // Added useProxy, currentUser, isProxied, useOAuth, accessToken, and getLatestAccessToken dependencies

  // Clear connection error on successful connect
  const clearConnectionError = useCallback(() => {
    setConnectionError(null);
  }, []);

  // Return the client instance
  return {
    serverUrl,
    setServerUrl,
    connectionStatus,
    transportType,
    isConnecting,
    connectionStartTime,
    connectionError,
    clearConnectionError,
    client: clientRef.current, // Expose the connected client instance
    recentServers, // Expose recent servers
    handleConnect, // Keep original signature for export, wrapper in App.tsx handles the override
    handleDisconnect,
    handleAbortConnection,
    isProxied, // Expose proxy status
    accessToken, // Expose access token
    isAuthFlowActive, // Expose auth flow status
    oauthProgress, // Expose OAuth progress message
    oauthUserInfo, // Expose OAuth user info
    isOAuthConnection, // Expose if current connection uses OAuth
    needsOAuthConfig, // Expose if OAuth config is needed
    oauthConfigServerUrl, // Expose the server URL that needs config
    clearOAuthConfigNeed: () => {
      setNeedsOAuthConfig(false);
      setOAuthConfigServerUrl(null);
    }, // Function to clear OAuth config need
    // Function to remove a server from the recent list
    removeRecentServer: (urlToRemove: string) => {
      const updatedServers = recentServers.filter(url => url !== urlToRemove);
      setRecentServers(updatedServers); // Update state
      saveRecentServers(updatedServers); // Save to localStorage (outside state update)
      // If the removed server was the currently selected one, reset to default or next available
      if (serverUrl === urlToRemove) {
        setServerUrl(updatedServers[0] || 'http://localhost:3033/mcp');
      }
    },
  };
};
