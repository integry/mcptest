import { useState, useRef, useCallback, useEffect } from 'react';
import { LogEntry } from '../types';

// We'll handle the SSE connection directly since we're in a browser environment
export const useConnection = (addLogEntry: (entryData: Omit<LogEntry, 'timestamp'>) => void) => {
  const [serverUrl, setServerUrl] = useState(localStorage.getItem('mcpServerUrl') || 'http://localhost:3033');
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const mcpClientRef = useRef<any | null>(null);
  const streamReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // Use a ref to track if this is a real unmount vs. a React strict mode check
  const strictModeRenderCount = useRef(0);
  const isRealUnmount = useRef(false);
  
  // Track strict mode renders to prevent premature disconnection
  useEffect(() => {
    strictModeRenderCount.current += 1;
    
    // This will run on component unmount
    return () => {
      // In strict mode, components mount/unmount twice during development
      // We only want to disconnect on a real unmount, not during these checks
      if (strictModeRenderCount.current > 1) {
        isRealUnmount.current = true;
      }
    };
  }, []);
  
  // Helper function to process SSE data
  const processSSELine = useCallback((line: string, currentEvent: { id: string | null; event: string; data: string }) => {
    console.log("Processing SSE line:", line);
    
    if (line.startsWith('id:')) {
      currentEvent.id = line.substring(3).trim();
      console.log("Set event ID:", currentEvent.id);
      return null;
    } else if (line.startsWith('event:')) {
      currentEvent.event = line.substring(6).trim();
      console.log("Set event type:", currentEvent.event);
      return null;
    } else if (line.startsWith('data:')) {
      const dataLine = line.substring(5).trim();
      currentEvent.data = currentEvent.data ? `${currentEvent.data}\n${dataLine}` : dataLine;
      console.log("Added data line:", dataLine);
      return null;
    } else if (line === '') {
      // Empty line completes an event
      if (currentEvent.data) {
        console.log("Completed event with data:", currentEvent.data);
        const eventToDispatch = { ...currentEvent };
        currentEvent.data = '';
        currentEvent.event = 'message';
        return eventToDispatch;
      }
    }
    return null;
  }, []);
  
  // Process the SSE stream
  const processStream = useCallback(async (stream: ReadableStream, signal: AbortSignal) => {
    const reader = stream
      .pipeThrough(new TextDecoderStream())
      .getReader();
      
    // Store the reader as any type to avoid TypeScript errors
    streamReaderRef.current = reader as any;

    let buffer = '';
    let currentEvent = { id: null, event: 'message', data: '' };

    try {
      console.log("Starting SSE stream processing loop");
      
      while (true) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const { done, value } = await reader.read();
        if (done) {
          console.log("Stream finished.");
          if (buffer.trim()) {
            console.log("Processing remaining buffer data:", buffer);
            processRawMessage(buffer.trim());
          }
          break;
        }

        buffer += value;
        console.log("Received chunk, buffer now:", buffer);
        
        // Try to process as standard SSE format first
        if (buffer.includes('event:') || buffer.includes('data:')) {
          // Process standard SSE format
          let lines = buffer.split('\n');
          let processedLines = 0;
          
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim();
            if (line) {
              const event = processSSELine(line, currentEvent);
              if (event && event.data) {
                console.log("Completed SSE event:", event);
                try {
                  const parsedData = JSON.parse(event.data);
                  console.log("Parsed SSE data:", parsedData);
                  
                  addLogEntry({ 
                    type: 'sse_parsed', 
                    event: event.event, 
                    data: parsedData, 
                    eventId: event.id 
                  });
                  
                  // Call the global callback if it exists
                  if (window.mcpSseCallback) {
                    console.log("Calling global SSE callback with data:", parsedData);
                    window.mcpSseCallback(parsedData);
                  }
                  
                  // Dispatch a custom event so other hooks can listen for SSE messages
                  console.log("Dispatching custom mcp-sse-event with data:", parsedData);
                  const customEvent = new CustomEvent('mcp-sse-event', {
                    detail: parsedData
                  });
                  window.dispatchEvent(customEvent);
                } catch(e) {
                  console.error("Error parsing SSE data:", e, "Raw data:", event.data);
                  addLogEntry({ 
                    type: 'sse_raw', 
                    event: event.event, 
                    data: event.data, 
                    eventId: event.id 
                  });
                }
              }
            }
            processedLines++;
          }
          
          // Update buffer to contain only the unprocessed part
          if (processedLines > 0) {
            buffer = lines.slice(processedLines).join('\n');
          }
        } 
        // Try to process as direct message format
        else if (buffer.includes('message')) {
          console.log("Found 'message' prefix, trying to process as direct message");
          
          // Find complete messages
          const messageRegex = /message\s+(\{.*\})/g;
          let match;
          let lastIndex = 0;
          
          while ((match = messageRegex.exec(buffer)) !== null) {
            const jsonStr = match[1];
            console.log("Found JSON in message format:", jsonStr);
            processRawMessage(jsonStr);
            lastIndex = match.index + match[0].length;
          }
          
          // Keep only the unprocessed part
          if (lastIndex > 0) {
            buffer = buffer.substring(lastIndex);
          }
        }
        // Try to process as direct JSON
        else if (buffer.trim().startsWith('{') && buffer.trim().includes('}')) {
          console.log("Trying to process as direct JSON");
          
          // Find the end of a complete JSON object
          let depth = 0;
          let jsonEndIndex = -1;
          
          for (let i = 0; i < buffer.length; i++) {
            if (buffer[i] === '{') depth++;
            else if (buffer[i] === '}') {
              depth--;
              if (depth === 0) {
                jsonEndIndex = i;
                break;
              }
            }
          }
          
          if (jsonEndIndex !== -1) {
            const jsonStr = buffer.substring(0, jsonEndIndex + 1).trim();
            console.log("Found complete JSON object:", jsonStr);
            processRawMessage(jsonStr);
            
            // Keep only the unprocessed part
            buffer = buffer.substring(jsonEndIndex + 1);
          }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log("Stream reading aborted.");
        addLogEntry({ type: 'info', data: 'Connection aborted by client.' });
      } else {
        console.error("Error reading stream:", error);
        addLogEntry({ type: 'error', data: `Stream reading error: ${error.message}` });
        setConnectionStatus('Error');
      }
    } finally {
      console.log("Stream processing loop finished.");
      reader.releaseLock();
      streamReaderRef.current = null;
      if (!signal.aborted && connectionStatus === 'Connected') {
        console.log("Stream closed unexpectedly by server.");
        addLogEntry({ type: 'warning', data: 'Stream closed by server.' });
        cleanupConnection(true);
      }
    }
  }, [addLogEntry, connectionStatus, processSSELine, serverUrl]);
  
  // Helper function to process raw message format
  const processRawMessage = useCallback((message: string) => {
    console.log("Processing raw message:", message);
    
    try {
      // If the message starts with "message", extract the JSON part
      if (message.startsWith('message')) {
        const jsonMatch = message.match(/message\s+(\{.*\})/);
        if (jsonMatch && jsonMatch[1]) {
          message = jsonMatch[1];
        }
      }
      
      const parsedData = JSON.parse(message);
      console.log("Successfully parsed message as JSON:", parsedData);
      
      addLogEntry({ 
        type: 'sse_parsed', 
        event: 'message', 
        data: parsedData, 
        eventId: null 
      });
      
      // Call the global callback if it exists
      if (window.mcpSseCallback) {
        console.log("Calling global SSE callback with data:", parsedData);
        window.mcpSseCallback(parsedData);
      }
      
      // Dispatch a custom event so other hooks can listen for SSE messages
      console.log("Dispatching custom mcp-sse-event with data:", parsedData);
      const customEvent = new CustomEvent('mcp-sse-event', {
        detail: parsedData
      });
      window.dispatchEvent(customEvent);
      
      return true;
    } catch (e) {
      console.error("Error processing raw message:", e);
      return false;
    }
  }, [addLogEntry]);
  
  // Internal function to clean up connection state
  const cleanupConnection = useCallback((isAborting = false) => {
    // Skip cleanup if this is just a strict mode check
    if (!isRealUnmount.current && isAborting) {
      console.log('Skipping cleanup during React strict mode check');
      return;
    }
    
    setSessionId(null);
    setConnectionStatus('Disconnected');
    if (!isAborting) {
      setIsConnecting(false);
    }
    
    // Cancel any ongoing stream reading
    if (streamReaderRef.current) {
      streamReaderRef.current.cancel("Connection closed by client");
      streamReaderRef.current = null;
    }
    
    // Abort any pending requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    mcpClientRef.current = null;
    console.log('Connection cleanup complete.');
  }, []);
  
  // Utility for sending JSON-RPC requests
  const sendJsonRpcRequest = useCallback(async (method: string, params: any = {}) => {
    if (!sessionId || !serverUrl) {
      console.error("Cannot send: No session ID or server URL.");
      addLogEntry({ type: 'error', data: 'Not connected or server URL missing.' });
      return null;
    }

    const requestId = Math.floor(Math.random() * 10000);
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method: method,
      params: params,
      id: requestId
    });

    addLogEntry({ type: 'request', id: requestId, method: method, params: params, data: `${method}(${JSON.stringify(params || {})})` });

    let requestUrl = serverUrl;
    try {
      const urlObj = new URL(serverUrl);
      if (!urlObj.pathname.endsWith('/mcp')) {
        urlObj.pathname = (urlObj.pathname.endsWith('/') ? urlObj.pathname : urlObj.pathname + '/') + 'mcp';
      }
      requestUrl = urlObj.toString();
    } catch (e) {
      addLogEntry({ type: 'error', data: `Invalid Server URL format for request: ${serverUrl}` });
      return null;
    }

    try {
      console.log(`Sending JSON-RPC request to ${requestUrl} with session ID ${sessionId}`);
      
      // Use the existing session ID in the header instead of creating a new connection
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Mcp-Session-Id': sessionId
        },
        body: body
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorJson = null;
        try { errorJson = JSON.parse(errorText); } catch { /* ignore */ }
        const errorMessage = (errorJson as any)?.error?.message || errorText;
        throw new Error(`HTTP error! status: ${response.status}. ${errorMessage}`);
      }

      // Check the content type to determine how to handle the response
      const contentType = response.headers.get('Content-Type');
      
      // If it's an SSE response, we need to handle it differently
      if (contentType?.includes('text/event-stream')) {
        console.log(`Received SSE response for method ${method}`);
        
        // For SSE responses, we'll just return a placeholder since the actual data
        // will come through the SSE event stream that's already set up
        addLogEntry({ 
          type: 'info', 
          data: `Request ${method} will be handled via SSE stream` 
        });
        
        return {
          jsonrpc: "2.0",
          id: requestId,
          result: { _note: "Response will be delivered via SSE stream" }
        };
      }
      
      // For JSON responses, parse and return as normal
      const result = await response.json();
      addLogEntry({ type: 'response', id: result.id, data: result });
      return result;

    } catch (error: any) {
      console.error(`Error sending JSON-RPC request (${method}):`, error);
      addLogEntry({ type: 'error', data: `Error during ${method}: ${error.message || error}` });
      return null;
    }
  }, [serverUrl, sessionId, addLogEntry]);

  const handleDisconnect = useCallback(async (isAborting = false) => {
    if (connectionStatus === 'Disconnected' || (isConnecting && !isAborting)) return;

    // Skip disconnect if this is just a strict mode check
    if (!isRealUnmount.current && isAborting) {
      console.log('Skipping disconnect during React strict mode check');
      return;
    }

    const currentSessionId = sessionId;
    console.log(`Disconnecting session: ${currentSessionId}`);
    if (!isAborting) {
      setIsConnecting(true);
      addLogEntry({ type: 'info', data: 'Disconnecting...' });
    }

    // Cancel any ongoing stream reading
    if (streamReaderRef.current) {
      console.log("Canceling stream reader...");
      streamReaderRef.current.cancel("Connection closed by client");
      streamReaderRef.current = null;
    }
    
    // Abort any pending requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Only send DELETE request if this is an explicit disconnect (not from cleanup)
    // and we have a valid session ID and server URL
    if (!isAborting && currentSessionId && serverUrl) {
      let deleteUrl = serverUrl;
      try {
        const urlObj = new URL(serverUrl);
        if (!urlObj.pathname.endsWith('/mcp')) {
          urlObj.pathname = (urlObj.pathname.endsWith('/') ? urlObj.pathname : urlObj.pathname + '/') + 'mcp';
        }
        deleteUrl = urlObj.toString();
      } catch (e) {
        console.error(`Invalid Server URL format for DELETE: ${serverUrl}`);
      }

      try {
        const response = await fetch(deleteUrl, {
          method: 'DELETE',
          headers: { 'Mcp-Session-Id': currentSessionId }
        });
        if (!response.ok) {
          console.warn(`DELETE request failed: ${response.status} ${response.statusText}`);
          addLogEntry({ type: 'warning', data: `Failed to terminate session on server (Status: ${response.status}).` });
        } else {
          console.log("Server session terminated successfully.");
          addLogEntry({ type: 'info', data: 'Server session terminated.' });
        }
      } catch (error: any) {
        console.error("Error sending DELETE request:", error);
        addLogEntry({ type: 'error', data: `Error during disconnect: ${error.message || error}` });
      }
    }

    cleanupConnection(isAborting);
    
    return {
      setTools: null,
      setResources: null,
      setSelectedTool: null,
      setSelectedResourceTemplate: null,
      setToolParams: null,
      setResourceArgs: null
    };
  }, [connectionStatus, isConnecting, sessionId, serverUrl, addLogEntry, cleanupConnection]);

  const handleConnect = useCallback(async (
    setTools: React.Dispatch<React.SetStateAction<any[]>>,
    setResources: React.Dispatch<React.SetStateAction<any[]>>,
    setResponses: React.Dispatch<React.SetStateAction<LogEntry[]>>,
    handleListTools: (currentSessionId: string | null) => Promise<void>,
    handleListResources: (currentSessionId: string | null) => Promise<void>
  ) => {
    if (!serverUrl || isConnecting || connectionStatus !== 'Disconnected') return;

    setIsConnecting(true);
    setConnectionStatus('Connecting...');
    setResponses([]);
    localStorage.setItem('mcpServerUrl', serverUrl);

    // Create a new abort controller for this connection
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    let connectUrl = serverUrl;
    try {
      const urlObj = new URL(serverUrl);
      if (!urlObj.pathname.endsWith('/mcp')) {
        urlObj.pathname = (urlObj.pathname.endsWith('/') ? urlObj.pathname : urlObj.pathname + '/') + 'mcp';
      }
      connectUrl = urlObj.toString();
    } catch (e) {
      addLogEntry({ type: 'error', data: `Invalid Server URL format: ${serverUrl}` });
      setIsConnecting(false);
      setConnectionStatus('Error');
      return;
    }

    addLogEntry({ type: 'info', data: `Connecting to ${connectUrl}...` });

    try {
      // Initialize MCP session with a POST request
      const response = await fetch(connectUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            clientInfo: { name: "mcp-sse-tester-react", version: "1.1.0" },
            capabilities: { response_modes: ["stream", "batch"] }
          },
          id: Math.floor(Math.random() * 10000)
        }),
        signal: signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorJson = null;
        try { errorJson = JSON.parse(errorText); } catch { /* ignore */ }
        const errorMessage = (errorJson as any)?.error?.message || errorText;
        throw new Error(`Connection failed: ${response.status} ${response.statusText}. ${errorMessage}`);
      }

      const receivedSessionId = response.headers.get('Mcp-Session-Id');
      const contentType = response.headers.get('Content-Type');

      if (!receivedSessionId) throw new Error("Mcp-Session-Id header not received.");

      setSessionId(receivedSessionId);
      addLogEntry({ type: 'info', data: `Session Initialized: ${receivedSessionId}` });

      // Check if we got a JSON response or an event stream
      if (contentType?.includes('application/json')) {
        // Handle JSON response (initialize response)
        const jsonResponse = await response.json();
        addLogEntry({ type: 'response', id: jsonResponse.id, data: jsonResponse });
        
        setConnectionStatus('Connected');
        setIsConnecting(false);
        
        // Store a reference to the client info
        mcpClientRef.current = {
          clientInfo: { name: "mcp-sse-tester-react", version: "1.1.0" },
          capabilities: { response_modes: ["stream", "batch"] },
          sessionId: receivedSessionId
        };
        
        // Now that we have a session ID, we can list tools and resources
        handleListTools(receivedSessionId);
        handleListResources(receivedSessionId);
        
        // We need to set up the SSE connection separately
        console.log("Setting up SSE connection with session ID:", receivedSessionId);
        
        // Create a new EventSource with the session ID in the query parameters
        const sseUrl = new URL(connectUrl);
        sseUrl.searchParams.set('session_id', receivedSessionId);
        
        // Use fetch with the appropriate headers for SSE
        const sseResponse = await fetch(sseUrl.toString(), {
          method: 'GET',
          headers: {
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          },
          signal: signal
        });
        
        if (!sseResponse.ok) {
          const errorText = await sseResponse.text();
          throw new Error(`SSE connection failed: ${sseResponse.status} ${sseResponse.statusText}. ${errorText}`);
        }
        
        if (sseResponse.body) {
          console.log("SSE stream established. Processing events...");
          addLogEntry({ type: 'info', data: 'SSE stream established.' });
          
          // Process the SSE stream
          processStream(sseResponse.body, signal).catch(err => {
            console.error("Error processing SSE stream:", err);
            if (connectionStatus !== 'Disconnected') {
              setConnectionStatus('Error');
              addLogEntry({ type: 'error', data: `Stream processing failed: ${err.message}` });
            }
          });
        } else {
          console.warn("SSE response has no body");
          addLogEntry({ type: 'warning', data: 'SSE response has no body' });
        }
      } 
      // If the server directly returned an event stream in the initial response
      else if (contentType?.includes('text/event-stream') && response.body) {
        console.log("Received event stream response directly. Starting processing...");
        setConnectionStatus('Connected');
        setIsConnecting(false);
        addLogEntry({ type: 'info', data: 'SSE stream established in initial response.' });
        
        // Store a reference to the client info
        mcpClientRef.current = {
          clientInfo: { name: "mcp-sse-tester-react", version: "1.1.0" },
          capabilities: { response_modes: ["stream", "batch"] },
          sessionId: receivedSessionId
        };
        
        // Process the stream directly from the response
        processStream(response.body, signal).catch(err => {
          console.error("Error processing stream:", err);
          if (connectionStatus !== 'Disconnected') {
            setConnectionStatus('Error');
            addLogEntry({ type: 'error', data: `Stream processing failed: ${err.message}` });
          }
        });
        
        // Now that we have a session ID, we can list tools and resources
        handleListTools(receivedSessionId);
        handleListResources(receivedSessionId);
      } else {
        console.warn("Server responded OK but Content-Type is not recognized:", contentType);
        addLogEntry({ type: 'warning', data: `Connected (Session: ${receivedSessionId}) but unexpected Content-Type: ${contentType}` });
        setConnectionStatus('Connected');
        setIsConnecting(false);
        handleListTools(receivedSessionId);
        handleListResources(receivedSessionId);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log("Connection attempt aborted.");
        addLogEntry({ type: 'info', data: 'Connection attempt cancelled.' });
        setConnectionStatus('Disconnected');
      } else {
        console.error("Connection failed:", error);
        setConnectionStatus('Error');
        addLogEntry({ type: 'error', data: `Connection failed: ${error.message || error}` });
      }
      setSessionId(null);
      setIsConnecting(false);
      abortControllerRef.current = null;
    }
  }, [serverUrl, isConnecting, connectionStatus, addLogEntry, processStream]);

  return {
    serverUrl,
    setServerUrl,
    connectionStatus,
    sessionId,
    isConnecting,
    sendJsonRpcRequest,
    handleConnect,
    handleDisconnect,
    cleanupConnection
  };
};
