import { useState, useRef, useCallback, useEffect } from 'react';
import { LogEntry, ResourceTemplate } from '../types'; // Keep ResourceTemplate for handleConnect signature
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"; // Use correct import path
import { formatErrorForDisplay } from '../utils/errorHandling';
import { CorsAwareStreamableHTTPTransport } from '../utils/corsAwareTransport';

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
  const [serverUrl, setServerUrl] = useState<string>(recentServers[0] || 'http://localhost:3033');
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [isConnecting, setIsConnecting] = useState(false);
  const clientRef = useRef<Client | null>(null); // Store the SDK Client instance

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
    setIsConnecting(false);
    console.log('[DEBUG] Connection cleanup complete.');
  }, [addLogEntry]); // Added addLogEntry dependency

  const handleDisconnect = useCallback(async () => {
    if (connectionStatus === 'Disconnected' || isConnecting) {
        console.log(`[DEBUG] handleDisconnect: Already disconnected or connecting. Status: ${connectionStatus}, IsConnecting: ${isConnecting}`);
        return;
    }
    // Removed strict mode check - manual disconnect should always work
    console.log(`[DEBUG] handleDisconnect: Initiating disconnect.`);
    addLogEntry({ type: 'info', data: 'Disconnecting...' });
    await cleanupConnection(); // Call cleanup which now includes client.close()
  }, [connectionStatus, isConnecting, addLogEntry, cleanupConnection]); // Dependencies remain the same

  // Modify handleConnect to accept an optional URL override
  const handleConnect = useCallback(async (
    // Keep setters for potential future use or different connect flows
    setTools: React.Dispatch<React.SetStateAction<any[]>>,
    setResources: React.Dispatch<React.SetStateAction<ResourceTemplate[]>>,
    setResponses: React.Dispatch<React.SetStateAction<LogEntry[]>>,
    urlToConnect?: string // Optional URL parameter
  ) => {
    const targetUrl = urlToConnect || serverUrl; // Use override or state URL

    // Allow connect attempt even if already connected, but not if currently connecting or no target URL
    if (!targetUrl || isConnecting) {
        console.log(`[DEBUG] handleConnect: Connect cancelled (Target URL: ${targetUrl}, IsConnecting: ${isConnecting})`);
        return;
    }

    setIsConnecting(true);
    setConnectionStatus('Connecting...');
    setResponses([]); // Clear logs for new connection attempt

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
      connectUrl = new URL(targetUrl); // Use targetUrl
      if (!connectUrl.pathname.endsWith('/mcp')) {
         connectUrl.pathname = (connectUrl.pathname.endsWith('/') ? connectUrl.pathname : connectUrl.pathname + '/') + 'mcp';
      }
    } catch (e) {
      addLogEntry({ type: 'error', data: `Invalid Server URL format: ${targetUrl}` }); // Use targetUrl in error
      setIsConnecting(false); setConnectionStatus('Error'); return;
    }

    addLogEntry({ type: 'info', data: `Connecting to ${connectUrl.toString()} using SDK Client (Stateless)...` });

    try {
      const client = new Client({ name: "mcp-sse-tester-react", version: "1.1.0" });
      clientRef.current = client;

      // Instantiate the CORS-aware transport (stateless mode)
      const transport = new CorsAwareStreamableHTTPTransport(connectUrl);

      // Optional: Setup transport listeners if needed (e.g., transport.onclose)
      // transport.onclose = () => { ... cleanupConnection(); ... };

      console.log("[DEBUG] handleConnect: Calling client.connect(transport)...");
      await client.connect(transport);
      console.log("[DEBUG] handleConnect: client.connect() promise resolved.");

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
      
      // Use enhanced error formatting
      const errorDetails = formatErrorForDisplay(error, {
        serverUrl: connectUrl.toString(),
        operation: 'connection'
      });
      
      addLogEntry({ 
        type: 'error', 
        data: `Connection failed: ${errorDetails}` 
      });
      cleanupConnection(); // Ensure cleanup on error
    }
  }, [serverUrl, isConnecting, connectionStatus, addLogEntry, cleanupConnection]); // Removed setters

  // Return the client instance
  return {
    serverUrl,
    setServerUrl,
    connectionStatus,
    isConnecting,
    client: clientRef.current, // Expose the connected client instance
    recentServers, // Expose recent servers
    handleConnect, // Keep original signature for export, wrapper in App.tsx handles the override
    handleDisconnect,
    // Function to remove a server from the recent list
    removeRecentServer: (urlToRemove: string) => {
      const updatedServers = recentServers.filter(url => url !== urlToRemove);
      setRecentServers(updatedServers); // Update state
      saveRecentServers(updatedServers); // Save to localStorage (outside state update)
      // If the removed server was the currently selected one, reset to default or next available
      if (serverUrl === urlToRemove) {
        setServerUrl(updatedServers[0] || 'http://localhost:3033');
      }
    },
  };
};
