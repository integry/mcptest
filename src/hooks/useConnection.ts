import { useState, useRef, useCallback, useEffect } from 'react';
import { LogEntry, ResourceTemplate, TransportType } from '../types'; // Keep ResourceTemplate for handleConnect signature
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"; // Use correct import path
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { formatErrorForDisplay } from '../utils/errorHandling';
import { detectTransport, attemptParallelConnections } from '../utils/transportDetection';
import { CorsAwareStreamableHTTPTransport } from '../utils/corsAwareTransport';
import { logEvent } from '../utils/analytics';

const RECENT_SERVERS_KEY = 'mcpRecentServers';
const MAX_RECENT_SERVERS = 100;

// Helper to load recent servers from localStorage
const loadRecentServers = (): string[] => {
  try {
    const stored = localStorage.getItem(RECENT_SERVERS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed.filter(item => typeof item === 'string');
      }
    }
  } catch (e) {
    console.error("Failed to load or parse recent servers from localStorage:", e);
  }
  return [];
};

// Helper to save recent servers to localStorage
const saveRecentServers = (servers: string[]) => {
  console.log("[DEBUG] Attempting to save recent servers:", servers); // Log the array itself
  // Check the type just before saving
  if (!Array.isArray(servers) || !servers.every(s => typeof s === 'string')) {
     console.error("[DEBUG] Invalid data type passed to saveRecentServers! Expected string[]. Got:", typeof servers, servers);
     // Optionally throw an error or return early to prevent saving bad data
     // throw new Error("Invalid data type for recent servers");
     return;
  }
  try {
    // Stringify separately to potentially catch error here and log
    const jsonString = JSON.stringify(servers);
    console.log("[DEBUG] Stringified recent servers:", jsonString);
    localStorage.setItem(RECENT_SERVERS_KEY, jsonString);
    console.log("[DEBUG] Successfully saved recent servers to localStorage.");
  } catch (e) {
    console.error("Failed to save recent servers to localStorage:", e);
    // Log the problematic array again on error
    console.error("[DEBUG] Data that caused save error:", servers);
  }
};


export const useConnection = (addLogEntry: (entryData: Omit<LogEntry, 'timestamp'>) => void) => {
  const [recentServers, setRecentServers] = useState<string[]>(loadRecentServers);
  const [serverUrl, setServerUrl] = useState<string>(recentServers[0] || 'http://localhost:3033/mcp');
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [transportType, setTransportType] = useState<TransportType | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStartTime, setConnectionStartTime] = useState<Date | null>(null);
  const [connectionError, setConnectionError] = useState<{ error: string; serverUrl: string; timestamp: Date; details?: string } | null>(null);
  const clientRef = useRef<Client | null>(null); // Store the SDK Client instance
  const abortControllerRef = useRef<AbortController | null>(null);

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
    // Abort any ongoing connection attempt
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    console.log('[DEBUG] Connection cleanup complete.');
  }, [addLogEntry]); // Added addLogEntry dependency

  const handleDisconnect = useCallback(async () => {
    if (connectionStatus !== 'Disconnected' && !isConnecting) {
        logEvent('disconnect', { server_url: serverUrl });
        addLogEntry({ type: 'info', data: 'Disconnecting...' });
        await cleanupConnection();
    }
  }, [connectionStatus, isConnecting, addLogEntry, cleanupConnection, serverUrl]);

  const handleAbortConnection = useCallback(() => {
    if (isConnecting && abortControllerRef.current) {
      logEvent('connect_abort', { server_url: serverUrl });
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
    logEvent('connect_attempt', { server_url: targetUrl });

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

    // Update recent servers list using targetUrl
    const updatedServers = [targetUrl, ...recentServers.filter(url => url !== targetUrl)];
    const limitedServers = updatedServers.slice(0, MAX_RECENT_SERVERS);
    setRecentServers(limitedServers); // Update state
    // Explicitly create a new array copy before saving to be extra safe
    const serversToSave = Array.from(limitedServers);
    saveRecentServers(serversToSave); // Save the copy to localStorage

    if (clientRef.current) {
      console.log("[DEBUG] Cleaning up previous client instance before connecting.");
      clientRef.current = null; // Clear ref
    }

    let connectUrl: URL;
    try {
      connectUrl = new URL(targetUrl); // Use targetUrl as-is, don't modify the path
    } catch (e) {
      addLogEntry({ type: 'error', data: `Invalid Server URL format: ${targetUrl}` }); // Use targetUrl in error
      setIsConnecting(false); setConnectionStatus('Error'); return;
    }

    addLogEntry({ type: 'info', data: `Connecting to ${connectUrl.toString()} with parallel transport attempts...` });

    try {
      console.log("[DEBUG] handleConnect: Starting connection attempts...");
      
      // Add timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout after 30 seconds')), 30000)
      );
      
      let result;
      let connectionUrl = connectUrl.toString();
      
      // If the original URL was protocol-less and we added HTTPS, try HTTPS first with HTTP fallback
      if (rawUrl === targetUrl.replace('https://', '') && targetUrl.startsWith('https://')) {
        console.log("[DEBUG] handleConnect: Attempting HTTPS connection first...");
        addLogEntry({ type: 'info', data: `Attempting HTTPS connection to ${connectionUrl}...` });
        
        try {
          // Try HTTPS first
          result = await Promise.race([
            attemptParallelConnections(connectionUrl, abortControllerRef.current?.signal),
            timeoutPromise
          ]);
          console.log("[DEBUG] handleConnect: HTTPS connection successful");
        } catch (httpsError: any) {
          console.log("[DEBUG] handleConnect: HTTPS failed, trying HTTP fallback...");
          
          // Only try HTTP fallback if the error suggests HTTPS issues
          if (httpsError.message?.includes('SSL') || 
              httpsError.message?.includes('certificate') || 
              httpsError.message?.includes('HTTPS') ||
              httpsError.message?.includes('timeout') ||
              httpsError.message?.includes('network')) {
            
            connectionUrl = getHttpVersion(connectionUrl);
            addLogEntry({ type: 'info', data: `HTTPS failed, trying HTTP fallback to ${connectionUrl}...` });
            
            // Try HTTP fallback
            result = await Promise.race([
              attemptParallelConnections(connectionUrl, abortControllerRef.current?.signal),
              timeoutPromise
            ]);
            console.log("[DEBUG] handleConnect: HTTP fallback successful");
          } else {
            // Re-throw if it's not a protocol-related error
            throw httpsError;
          }
        }
      } else {
        // If user explicitly provided a protocol, use it as-is
        console.log("[DEBUG] handleConnect: Using user-specified protocol...");
        result = await Promise.race([
          attemptParallelConnections(connectionUrl, abortControllerRef.current?.signal),
          timeoutPromise
        ]);
      }
      
      // Update state with the winning connection
      clientRef.current = result.client;
      setTransportType(result.transportType);
      addLogEntry({ type: 'info', data: `Connected using ${result.transportType} transport` });
      logEvent('connect_success', { 
        server_url: targetUrl, 
        transport_type: result.transportType 
      });
      
      console.log("[DEBUG] handleConnect: Connection completed with", result.transportType);

      // Update serverUrl state to reflect the final successful URL
      if (connectionUrl !== serverUrl) {
        setServerUrl(connectionUrl);
      }

      setConnectionStatus('Connected');
      setIsConnecting(false);
      // Log generic success as access method for serverInfo/capabilities is unclear
      addLogEntry({ type: 'info', data: `SDK Client Connected successfully.` });
      console.log("[DEBUG] SDK Client Connected.");
      // TODO: Investigate how to access serverInfo/capabilities in SDK v1.10.1 if needed

      // Do not automatically fetch lists for stateless connection
      console.log("[DEBUG] handleConnect: Skipping automatic initial list fetching for stateless connection.");
      setTools([]); // Ensure lists are cleared on connect
      setResources([]);

    } catch (error: any) {
      console.error('[DEBUG] handleConnect: Connection failed:', error);
      
      // Don't show error card if connection was aborted by user
      const isUserAborted = error.message && error.message.includes('Connection aborted by user');
      
      if (isUserAborted) {
        // Just log that it was aborted, no error card
        addLogEntry({ 
          type: 'info', 
          data: 'Connection aborted by user' 
        });
      } else {
        // Use enhanced error formatting for actual errors
        logEvent('connect_failure', {
          server_url: targetUrl,
          error_message: error.message
        });
        const errorDetails = formatErrorForDisplay(error, {
          serverUrl: connectUrl.toString(),
          operation: 'connection'
        });
        
        // Set connection error state for error card display
        setConnectionError({
          error: errorDetails,
          serverUrl: connectUrl.toString(),
          timestamp: new Date(),
          details: error.stack || error.toString()
        });
        
        addLogEntry({ 
          type: 'error', 
          data: `Connection failed: ${errorDetails}` 
        });
      }
      
      cleanupConnection(); // Ensure cleanup on error
    }
  }, [serverUrl, isConnecting, connectionStatus, addLogEntry, cleanupConnection]); // Removed setters

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
