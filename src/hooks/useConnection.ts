import { useState, useRef, useCallback, useEffect } from 'react';
import { LogEntry, Resource, TransportType } from '../types';
import { Client, type ProtocolEra } from '@modelcontextprotocol/client';
import { formatErrorForDisplay } from '../utils/errorHandling';
import {
  attemptParallelConnections,
  getObservedAuthenticationChallenge,
} from '../utils/transportDetection';
import { logEvent } from '../utils/analytics';
import { useAuth } from '../context/AuthContext';
import {
  beginOAuthFlow,
  isOAuthClientConfigurationRequired,
  loadOAuthAuthorization,
} from '../utils/oauthFlow';
import {
  OAuthFlightRecorder,
  recordOAuthAuthenticationChallenge,
  resumeOAuthFlightRecorder,
} from '../utils/oauthTrace';

const RECENT_SERVERS_KEY = 'mcpRecentServers';
const MAX_RECENT_SERVERS = 100;

const getConnectedServerUrl = (
  finalUrl: string,
  targetUrl: string,
  usedProxy: boolean
): string => {
  if (!usedProxy) return finalUrl;

  try {
    return new URL(finalUrl).searchParams.get('target') || targetUrl;
  } catch {
    return targetUrl;
  }
};

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


export const useConnection = (
  addLogEntry: (entryData: Omit<LogEntry, 'timestamp'>) => void,
  useProxy?: boolean,
  onAuthFlowStart?: () => void,
  requestHeaders?: Record<string, string>
) => {
  const [recentServers, setRecentServers] = useState<string[]>(loadRecentServers);
  const [serverUrl, setServerUrl] = useState<string>(recentServers[0] || 'http://localhost:3033/mcp');
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [transportType, setTransportType] = useState<TransportType | null>(null);
  const [protocolEra, setProtocolEra] = useState<ProtocolEra | null>(null);
  const [protocolVersion, setProtocolVersion] = useState<string | null>(null);
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
      const storedToken = loadOAuthAuthorization(serverUrl)?.accessToken;
      if (storedToken) {
        setAccessToken(storedToken);
        console.log('[OAuth] Access token found in sessionStorage');
      } else {
        setAccessToken(null);
      }
    } catch (error) {
      console.warn('[OAuth] Invalid serverUrl for token lookup:', serverUrl, error);
      setAccessToken(null);
    }
  }, [connectionStatus, serverUrl]); // Re-check when connection status changes

  // Always check sessionStorage for the latest token before connecting
  const getLatestAccessToken = useCallback((tokenServerUrl: string = serverUrl) => {
    if (!tokenServerUrl) {
      console.log('[OAuth] No serverUrl provided for token lookup');
      return undefined;
    }
    try {
      const normalizedUrl = addProtocolIfMissing(tokenServerUrl);
      const authorization = loadOAuthAuthorization(normalizedUrl);
      const storedToken = authorization?.accessToken;
      
      console.log('[OAuth] Token lookup:', {
        serverUrl: tokenServerUrl,
        issuer: authorization?.issuer,
        hasStoredToken: !!storedToken,
        hasCurrentToken: !!accessToken,
        tokensMatch: storedToken === accessToken
      });
      
      if ((storedToken || null) !== accessToken) {
        console.log('[OAuth] Updated access token state from issuer-bound SDK storage');
        setAccessToken(storedToken || null);
      }
      return storedToken;
    } catch (error) {
      console.warn('[OAuth] Invalid serverUrl for token lookup:', tokenServerUrl, error);
      setAccessToken(null);
      return undefined;
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
        if (!serverUrl) {
          console.log('[OAuth] No serverUrl available for user info fetch');
          return;
        }
        const authorization = loadOAuthAuthorization(serverUrl);
        if (!authorization || authorization.accessToken !== accessToken) {
          console.log('[OAuth] No issuer-bound authorization found, skipping user info fetch');
          return;
        }

        if (!authorization.userInfoEndpoint) {
          console.log('[OAuth] No userinfo endpoint in OAuth configuration');
          // Set a default user info if userinfo endpoint is not available
          setOauthUserInfo({
            name: 'OAuth User',
            email: 'OAuth authenticated',
            sub: 'oauth-user'
          });
          return;
        }

        console.log('[OAuth] Fetching user info from:', authorization.userInfoEndpoint);
        
        const response = await fetch(authorization.userInfoEndpoint, {
          headers: {
            'Authorization': `Bearer ${authorization.accessToken}`,
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
  }, [accessToken, connectionStatus, isOAuthConnection, addLogEntry, serverUrl]);

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
    setProtocolEra(null);
    setProtocolVersion(null);
    setIsConnecting(false);
    setConnectionStartTime(null);
    setIsProxied(false);
    setIsAuthFlowActive(false);
    setOauthProgress(null);
    setNeedsOAuthConfig(false);
    setOAuthConfigServerUrl(null);
    setOauthUserInfo(null);
    setIsOAuthConnection(false);
    
    // Clear the legacy endpoint hint on disconnect. Issuer-bound SDK tokens
    // remain available for later authenticated connections.
    if (serverUrl) {
      try {
        const serverHost = new URL(addProtocolIfMissing(serverUrl)).host;
        sessionStorage.removeItem(`oauth_endpoints_${serverHost}`);
        console.log(`[OAuth] Cleared legacy endpoint hint for server: ${serverHost}`);
      } catch (error) {
        console.error('[OAuth] Error clearing legacy OAuth endpoint hint:', error);
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
    setResources: React.Dispatch<React.SetStateAction<Resource[]>>,
    setResponses: React.Dispatch<React.SetStateAction<LogEntry[]>>,
    urlToConnect?: string, // Optional URL parameter
    forceUseProxy?: boolean, // Optional proxy override
    protocolEraHint?: 'stateful' | 'legacy'
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
    let latestAccessToken = getLatestAccessToken(targetUrl);

    setIsConnecting(true);
    setConnectionStatus('Connecting...');
    setTransportType(null);
    setProtocolEra(null);
    setProtocolVersion(null);
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
    let finalProtocolEra: ProtocolEra | null = null;
    let finalProtocolVersion: string | null = null;
    let finalUrl: string | null = null;
    let finalUsedProxy = false;
    let connectionRoute: 'direct' | 'proxy' = 'direct';
    let oauthTrace: OAuthFlightRecorder | undefined;
    let oauthRetryPending = false;
    let connectionAttemptStartedAt = Date.now();
    const withConnectionTimeout = async <T,>(attempt: Promise<T>): Promise<T> => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Connection timeout after 30 seconds')),
          30000
        );
      });

      try {
        return await Promise.race([attempt, timeout]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    };

    // Helper function to attempt direct connection
    const connectDirectly = async () => {
      connectionRoute = 'direct';
      connectionAttemptStartedAt = Date.now();
      setIsProxied(false);
      addLogEntry({ type: 'info', data: `Attempting direct connection to ${targetUrl}...` });
      // Set OAuth connection flag based on whether we have an access token
      setIsOAuthConnection(!!latestAccessToken);
      if (latestAccessToken) {
        console.log('[OAuth] Using access token for connection');
        addLogEntry({ type: 'info', data: `🔐 Using OAuth access token for authenticated connection` });
      }
      return attemptParallelConnections(
        targetUrl,
        abortControllerRef.current?.signal,
        latestAccessToken || undefined,
        requestHeaders,
        false,
        protocolEraHint
      );
    };

    // Helper function to attempt proxy connection
    const connectViaProxy = async () => {
      connectionRoute = 'proxy';
      connectionAttemptStartedAt = Date.now();
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
      // Set OAuth connection flag based on whether we have an OAuth token
      setIsOAuthConnection(!!latestAccessToken);
      const targetHeaders = {
        ...requestHeaders,
        ...(latestAccessToken ? { Authorization: `Bearer ${latestAccessToken}` } : {}),
      };
      return attemptParallelConnections(
        connectionUrl,
        abortControllerRef.current?.signal,
        authToken,
        targetHeaders,
        true,
        protocolEraHint
      );
    };

    const connectOnce = async () => {
      // Always try the unauthenticated or already-authorized MCP connection
      // before considering a new OAuth flow.
      try {
        const result = await withConnectionTimeout(connectDirectly());
        return { result, usedProxy: false };
      } catch (error: any) {
        // Check if it's a CORS error and if automatic proxy fallback is enabled
        const isCorsError = error.message?.toLowerCase().includes('cors') ||
          (error.message?.toLowerCase().includes('failed to fetch') &&
            !error.message?.toLowerCase().includes('network'));

        // Use forceUseProxy if provided, otherwise fall back to the hook's useProxy value
        const shouldUseProxy = forceUseProxy !== undefined ? forceUseProxy : useProxy;

        if (isCorsError && shouldUseProxy && currentUser) {
          const result = await withConnectionTimeout(connectViaProxy());
          return { result, usedProxy: true };
        }

        if (isCorsError && shouldUseProxy && !currentUser) {
          addLogEntry({ type: 'warning', data: 'Proxy fallback disabled: User not logged in' });
        }
        throw error;
      }
    };

    const hasExplicitTargetCredential = Object.keys(requestHeaders || {}).some((header) => (
      ['authorization', 'x-api-key', 'api-key'].includes(header.toLowerCase())
    ));

    try {
      let attemptedAutomaticOAuth = false;

      while (!connectionSuccess) {
        try {
          const { result, usedProxy } = await connectOnce();
          finalClient = result.client;
          finalTransportType = result.transportType;
          finalProtocolEra = result.protocolEra;
          finalProtocolVersion = result.protocolVersion ?? null;
          finalUrl = result.url;
          finalUsedProxy = usedProxy;
          connectionSuccess = true;
          if (oauthRetryPending) {
            oauthTrace?.enrichLast('mcp_retry', {
              outcome: 'succeeded',
              explanation: `The authenticated MCP retry succeeded using the ${result.protocolEra} protocol path.`,
              response: {
                metadata: {
                  transportType: result.transportType,
                  protocolEra: result.protocolEra,
                  protocolVersion: result.protocolVersion,
                },
              },
            });
            oauthRetryPending = false;
          }
          addLogEntry({
            type: 'info',
            data: `${usedProxy ? 'Proxy connection' : 'Connection'} successful using ${result.transportType} (${result.protocolEra}${result.protocolVersion ? `, ${result.protocolVersion}` : ''}) at ${result.url}`
          });
        } catch (error) {
          const challenge = getObservedAuthenticationChallenge(error);
          const shouldDiscoverOAuth = challenge?.source === 'target'
            && !attemptedAutomaticOAuth
            && !hasExplicitTargetCredential;

          if (challenge) {
            oauthTrace = oauthTrace || recordOAuthAuthenticationChallenge({
              targetUrl,
              status: challenge.status,
              source: challenge.source,
              route: challenge.source === 'proxy' ? 'proxy' : connectionRoute,
              storage: sessionStorage,
              timing: {
                startedAt: new Date(connectionAttemptStartedAt).toISOString(),
                durationMs: Math.max(0, Date.now() - connectionAttemptStartedAt),
              },
            });
          }

          if (!shouldDiscoverOAuth) {
            oauthTrace?.terminal(
              'failed',
              challenge?.source === 'proxy'
                ? 'The connection stopped at authenticated proxy access; target OAuth discovery was not started.'
                : 'The target authentication challenge was not converted into automatic OAuth discovery.'
            );
            throw error;
          }
          attemptedAutomaticOAuth = true;

          addLogEntry({
            type: 'info',
            data: `🔐 The MCP server returned HTTP ${challenge.status}. Discovering its OAuth configuration...`
          });
          setConnectionStatus('Authorization required');
          setIsAuthFlowActive(true);
          setOauthProgress('Discovering the protected resource and authorization server...');
          onAuthFlowStart?.();

          const activeTabs = localStorage.getItem('mcpConnectionTabs');
          if (activeTabs) sessionStorage.setItem('oauth_tabs_before_redirect', activeTabs);

          try {
            const result = await beginOAuthFlow(targetUrl, {
              ...(latestAccessToken ? { forceReauthorization: true } : {})
            });

            if (result === 'REDIRECT') {
              setIsConnecting(false);
              setConnectionStartTime(null);
              abortControllerRef.current = null;
              return;
            }

            latestAccessToken = getLatestAccessToken(targetUrl);
            if (!latestAccessToken) {
              throw new Error('OAuth completed without returning an access token.');
            }

            setIsAuthFlowActive(false);
            setOauthProgress(null);
            setConnectionStatus('Connecting...');
            addLogEntry({
              type: 'info',
              data: '✅ OAuth authorization found. Retrying the MCP connection.'
            });
            oauthTrace = oauthTrace || resumeOAuthFlightRecorder(targetUrl, sessionStorage);
            oauthTrace?.record({
              type: 'mcp_retry',
              outcome: 'started',
              provenance: 'direct_target',
              route: connectionRoute,
              explanation: `Retrying the MCP connection with OAuth credentials using the ${protocolEraHint || 'negotiated'} protocol path.`,
              request: { method: 'POST', url: targetUrl },
              response: { metadata: { protocolEraHint: protocolEraHint || 'automatic' } },
            });
            oauthRetryPending = true;
          } catch (oauthError) {
            setIsAuthFlowActive(false);
            setOauthProgress(null);
            setIsConnecting(false);
            setConnectionStartTime(null);
            abortControllerRef.current = null;

            if (isOAuthClientConfigurationRequired(oauthError)) {
              setNeedsOAuthConfig(true);
              setOAuthConfigServerUrl(targetUrl);
              setConnectionStatus('Authorization required');
              addLogEntry({
                type: 'warning',
                data: '⚠️ Automatic OAuth discovery completed, but this provider requires a pre-registered client.'
              });
              return;
            }

            const message = oauthError instanceof Error
              ? oauthError.message
              : 'Unknown OAuth error';
            setConnectionStatus('Error');
            setConnectionError({
              error: `OAuth authorization failed: ${message}`,
              serverUrl: targetUrl,
              timestamp: new Date()
            });
            addLogEntry({ type: 'error', data: `OAuth authorization failed: ${message}` });
            return;
          }
        }
      }

        // --- Finalize Connection ---
        if (connectionSuccess && finalClient && finalTransportType && finalUrl) {
            clientRef.current = finalClient;
            setTransportType(finalTransportType);
            setProtocolEra(finalProtocolEra);
            setProtocolVersion(finalProtocolVersion);
            
            const displayUrl = getConnectedServerUrl(finalUrl, targetUrl, finalUsedProxy);
            console.log(
              `[DEBUG] Setting display URL: ${displayUrl} (from finalUrl: ${finalUrl}, proxy: ${finalUsedProxy})`
            );
            
            setServerUrl(displayUrl); // Set UI URL to the actual connected URL with endpoint
            setConnectionStatus('Connected');
            setIsConnecting(false);
            addLogEntry({ type: 'info', data: `SDK Client Connected successfully.` });
            logEvent('connect_success', { 
              transport_type: finalTransportType,
              is_proxied: finalUsedProxy,
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
  }, [serverUrl, isConnecting, connectionStatus, recentServers, addLogEntry, cleanupConnection, useProxy, currentUser, accessToken, getLatestAccessToken, requestHeaders, onAuthFlowStart]);

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
    protocolEra,
    protocolVersion,
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
