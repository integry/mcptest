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


export const useConnection = (addLogEntry: (entryData: Omit<LogEntry, 'timestamp'>) => void, useProxy?: boolean) => {
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

  // Ref for strict mode check
  const isRealUnmount = useRef(false);
  const strictModeRenderCount = useRef(0);
  useEffect(() => {
    strictModeRenderCount.current += 1;
    return () => { if (strictModeRenderCount.current > 1) isRealUnmount.current = true; };
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
    urlToConnect?: string // Optional URL parameter
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
      return attemptParallelConnections(targetUrl, abortControllerRef.current?.signal);
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
          
          if (isCorsError && useProxy) {
            // Attempt proxy connection as fallback
            const result = await Promise.race([
              connectViaProxy(),
              timeoutPromise
            ]);
            finalClient = result.client;
            finalTransportType = result.transportType;
            connectionSuccess = true;
            addLogEntry({ type: 'info', data: `Proxy connection successful using ${result.transportType}` });
          } else {
            throw error; // Re-throw if not a CORS error or proxy is disabled
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
  }, [serverUrl, isConnecting, connectionStatus, recentServers, addLogEntry, cleanupConnection, useProxy, currentUser, isProxied]); // Added useProxy, currentUser, and isProxied dependencies

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
