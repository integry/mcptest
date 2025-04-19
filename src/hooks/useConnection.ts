import { useState, useRef, useCallback, useEffect } from 'react';
import { LogEntry, ResourceTemplate } from '../types'; // Keep ResourceTemplate for handleConnect signature
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"; // Use correct import path

export const useConnection = (addLogEntry: (entryData: Omit<LogEntry, 'timestamp'>) => void) => {
  const [serverUrl, setServerUrl] = useState(localStorage.getItem('mcpServerUrl') || 'http://localhost:3033');
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

  const cleanupConnection = useCallback(() => {
    // Clean up SDK client ref. Transport might close itself.
    if (clientRef.current) {
       console.log("[DEBUG] cleanupConnection: Cleaning up SDK client ref.");
       // No explicit disconnect on Client? Null the ref.
       clientRef.current = null;
    }
    setConnectionStatus('Disconnected');
    setIsConnecting(false);
    console.log('[DEBUG] Connection cleanup complete.');
  }, []); // No dependencies needed

  const handleDisconnect = useCallback(async () => {
    if (connectionStatus === 'Disconnected' || isConnecting) return;
    if (!isRealUnmount.current) {
       console.log('[DEBUG] Skipping disconnect during React strict mode check');
       return;
    }
    console.log(`[DEBUG] handleDisconnect: Initiating disconnect.`);
    addLogEntry({ type: 'info', data: 'Disconnecting...' });
    cleanupConnection(); // Call cleanup which clears the client ref
  }, [connectionStatus, isConnecting, addLogEntry, cleanupConnection]);

  const handleConnect = useCallback(async (
    // Pass setters for tools/resources, but list calls are manual now
    setTools: React.Dispatch<React.SetStateAction<any[]>>,
    setResources: React.Dispatch<React.SetStateAction<ResourceTemplate[]>>,
    setResponses: React.Dispatch<React.SetStateAction<LogEntry[]>>
  ) => {
    if (!serverUrl || isConnecting || connectionStatus !== 'Disconnected') return;

    setIsConnecting(true);
    setConnectionStatus('Connecting...');
    setResponses([]);
    localStorage.setItem('mcpServerUrl', serverUrl);

    if (clientRef.current) {
      console.log("[DEBUG] Cleaning up previous client instance before connecting.");
      clientRef.current = null; // Clear ref
    }

    let connectUrl: URL;
    try {
      connectUrl = new URL(serverUrl);
      if (!connectUrl.pathname.endsWith('/mcp')) {
         connectUrl.pathname = (connectUrl.pathname.endsWith('/') ? connectUrl.pathname : connectUrl.pathname + '/') + 'mcp';
      }
    } catch (e) {
      addLogEntry({ type: 'error', data: `Invalid Server URL format: ${serverUrl}` });
      setIsConnecting(false); setConnectionStatus('Error'); return;
    }

    addLogEntry({ type: 'info', data: `Connecting to ${connectUrl.toString()} using SDK Client (Stateless)...` });

    try {
      const client = new Client({ name: "mcp-sse-tester-react", version: "1.1.0" });
      clientRef.current = client;

      // Instantiate the StreamableHTTPClientTransport (stateless mode)
      const transport = new StreamableHTTPClientTransport(connectUrl);

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
      addLogEntry({ type: 'error', data: `Connection failed: ${error.message || error}` });
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
    handleConnect,
    handleDisconnect,
  };
};
