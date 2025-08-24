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
import pkceChallenge from '../utils/pkce';

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

  // Ref for strict mode check
  const isRealUnmount = useRef(false);
  const strictModeRenderCount = useRef(0);
  useEffect(() => {
    strictModeRenderCount.current += 1;
    return () => { if (strictModeRenderCount.current > 1) isRealUnmount.current = true; };
  }, []);

  // Check for stored access token on mount
  useEffect(() => {
    const storedToken = sessionStorage.getItem('oauth_access_token');
    if (storedToken) {
      setAccessToken(storedToken);
    }
  }, []);

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
    // Abort any ongoing connection attempt
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    console.log('[DEBUG] Connection cleanup complete.');
  }, [addLogEntry]); // Added addLogEntry dependency

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

    // Check if OAuth is enabled and initiate OAuth flow
    if (useOAuth && !accessToken) {
      console.log('[DEBUG] OAuth enabled but no access token, initiating OAuth flow...');
      console.log('[OAuth Progress] Starting OAuth 2.1 authorization process');
      addLogEntry({ 
        type: 'info', 
        data: '🔐 OAuth Flow Started: Beginning OAuth 2.1 authorization process' 
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
        const pkce = pkceChallenge();
        code_verifier = pkce.code_verifier;
        code_challenge = pkce.code_challenge;
        
        // Add debug logging
        addLogEntry({ 
          type: 'info', 
          data: `✅ PKCE generated successfully (verifier: ${code_verifier.length} chars, challenge: ${code_challenge.length} chars)` 
        });
        console.log('[OAuth Progress] PKCE generated successfully');
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
      
      // Build authorization URL - derive from server URL
      addLogEntry({ 
        type: 'info', 
        data: '🔗 Step 3/5: Building OAuth authorization URL...' 
      });
      setOauthProgress('Step 3/5: Building authorization URL...');
      console.log('[OAuth Progress] Step 3/5: Building authorization URL');
      
      const authUrl = new URL(`${targetUrl}/oauth/authorize`);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', 'mcptest-client'); // This should be dynamic in a real app
      authUrl.searchParams.set('redirect_uri', `${window.location.origin}/oauth/callback`);
      authUrl.searchParams.set('code_challenge', code_challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('scope', 'openid profile email');
      
      // Log the authorization URL for debugging
      addLogEntry({ 
        type: 'info', 
        data: `📝 Authorization URL built:\n  - Endpoint: ${targetUrl}/oauth/authorize\n  - Client ID: mcptest-client\n  - Redirect URI: ${window.location.origin}/oauth/callback\n  - Scopes: openid profile email\n  - PKCE Method: S256` 
      });
      console.log('[OAuth Progress] Authorization URL:', authUrl.toString());
      
      // First, try to get server metadata to check if it requires authentication
      addLogEntry({ 
        type: 'info', 
        data: '🌐 Step 4/5: Checking authorization endpoint accessibility...' 
      });
      setOauthProgress('Step 4/5: Checking authorization endpoint...');
      console.log('[OAuth Progress] Step 4/5: Checking authorization endpoint');
      
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
            data: `✅ Step 5/5: Server returned redirect (${authCheckResponse.status})\n  - Redirect location: ${redirectUrl || 'Not provided'}\n  - Following redirect...` 
          });
          setOauthProgress('Step 5/5: Redirecting to authorization server...');
          console.log('[OAuth Progress] Step 5/5: Redirecting to:', redirectUrl || authUrl.toString());
          if (redirectUrl) {
            window.location.href = redirectUrl;
            return;
          }
        } else if (authCheckResponse.status === 401) {
          // Server requires authentication for the auth endpoint itself
          addLogEntry({ 
            type: 'error', 
            data: `❌ Step 5/5 FAILED: Authorization endpoint returned 401 Unauthorized\n  - The OAuth server requires authentication to access the /oauth/authorize endpoint\n  - This typically means the server configuration needs adjustment\n  - Request URL: ${authUrl.toString()}` 
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
            data: `✅ Step 5/5: Authorization endpoint is accessible (${authCheckResponse.status})\n  - Redirecting to authorization page...` 
          });
          setOauthProgress('Step 5/5: Redirecting to authorization page...');
          console.log('[OAuth Progress] Step 5/5: Redirecting to authorization page');
          window.location.href = authUrl.toString();
          return;
        } else {
          // Unexpected response - log and try redirect anyway
          console.log(`[DEBUG] Unexpected auth endpoint response: ${authCheckResponse.status}`);
          addLogEntry({ 
            type: 'warning', 
            data: `⚠️ Step 5/5: Unexpected response from authorization endpoint (${authCheckResponse.status})\n  - Attempting redirect anyway...` 
          });
          setOauthProgress('Step 5/5: Redirecting to authorization page...');
          window.location.href = authUrl.toString();
          return;
        }
      } catch (error) {
        // If fetch fails (CORS, network error, etc.), fall back to regular redirect
        console.log('[DEBUG] Auth endpoint check failed, falling back to redirect:', error);
        addLogEntry({ 
          type: 'warning', 
          data: `⚠️ Step 4/5: Could not check authorization endpoint\n  - Error: ${error instanceof Error ? error.message : 'Unknown error'}\n  - This might be due to CORS restrictions\n  - Proceeding with direct redirect...` 
        });
        addLogEntry({ 
          type: 'info', 
          data: `➡️ Step 5/5: Redirecting directly to authorization URL...` 
        });
        setOauthProgress('Step 5/5: Redirecting to authorization URL...');
        console.log('[OAuth Progress] Step 5/5: Direct redirect to:', authUrl.toString());
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

    // Update recent servers list using targetUrl (the original URL)
    const updatedServers = [targetUrl, ...recentServers.filter(url => url !== targetUrl)];
    const limitedServers = updatedServers.slice(0, MAX_RECENT_SERVERS);
    setRecentServers(limitedServers); // Update state
    saveRecentServers(Array.from(limitedServers)); // Save to localStorage

    if (clientRef.current) {
      console.log("[DEBUG] Cleaning up previous client instance before connecting.");
      clientRef.current = null; // Clear ref
    }

    let connectionSuccess = false;
    let finalClient: Client | null = null;
    let finalTransportType: TransportType | null = null;
    let lastError: any = null;
    const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout after 30 seconds')), 30000)
    );

    // Helper function to attempt direct connection
    const connectDirectly = async () => {
      setIsProxied(false);
      addLogEntry({ type: 'info', data: `Attempting direct connection to ${targetUrl}...` });
      return attemptParallelConnections(targetUrl, abortControllerRef.current?.signal, accessToken || undefined);
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
      return attemptParallelConnections(connectionUrl, abortControllerRef.current?.signal, authToken);
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
          connectionSuccess = true;
          addLogEntry({ type: 'info', data: `Connection successful using ${result.transportType}` });
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
            connectionSuccess = true;
            addLogEntry({ type: 'info', data: `Proxy connection successful using ${result.transportType}` });
          } else {
            if (isCorsError && shouldUseProxy && !currentUser) {
              addLogEntry({ type: 'warning', data: 'Proxy fallback disabled: User not logged in' });
            }
            throw error; // Re-throw if not a CORS error, proxy is disabled, or user not logged in
          }
        }

        // --- Finalize Connection ---
        if (connectionSuccess && finalClient && finalTransportType) {
            clientRef.current = finalClient;
            setTransportType(finalTransportType);
            setServerUrl(targetUrl); // CRUCIAL: Set UI URL to the original target
            setConnectionStatus('Connected');
            setIsConnecting(false);
            addLogEntry({ type: 'info', data: `SDK Client Connected successfully.` });
            logEvent('connect_success', { 
              transport_type: finalTransportType,
              is_proxied: isProxied,
            });
            setTools([]);
            setResources([]);
        }

    } catch (error: any) {
        const isUserAborted = error.message && error.message.includes('Connection aborted by user');
        if (!isUserAborted) {
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
  }, [serverUrl, isConnecting, connectionStatus, recentServers, addLogEntry, cleanupConnection, useProxy, currentUser, isProxied, useOAuth, accessToken]); // Added useProxy, currentUser, isProxied, useOAuth, and accessToken dependencies

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
