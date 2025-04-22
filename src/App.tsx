import React, { useEffect, useRef, useState } from 'react';

// Import Components
import Header from './components/Header';
// import ActionToolbar from './components/ActionToolbar'; // Removed ActionToolbar import
import ConnectionPanel from './components/ConnectionPanel';
import { UnifiedPanel } from './components/UnifiedPanel'; // Import UnifiedPanel (Corrected import)
import { RecentServersPanel } from './components/RecentServersPanel'; // Import RecentServersPanel
// import ToolsPanel from './components/ToolsPanel'; // Removed
// import ResourcesPanel from './components/ResourcesPanel'; // Removed
// import PromptsPanel from './components/PromptsPanel'; // Removed
import ParamsPanel from './components/ParamsPanel';
import ResponsePanel from './components/ResponsePanel';

// Import Hooks
import { useLogEntries } from './hooks/useLogEntries';
import { useConnection } from './hooks/useConnection';
import { useToolsAndResources } from './hooks/useToolsAndResources'; // Add missing import
import { useResourceAccess } from './hooks/useResourceAccess';

// Import Types (needed for prompt handling)
import { Prompt, ResourceTemplate, SelectedPrompt, SelectedTool } from './types';

// Import Utils
import { parseUriTemplateArgs } from './utils/uriUtils';

// Constants for localStorage keys
const TOOL_HISTORY_KEY = 'mcpToolCallHistory';
const RESOURCE_HISTORY_KEY = 'mcpResourceAccessHistory';
const MAX_HISTORY_ITEMS = 10;

// Helper to load history from localStorage
const loadHistory = (key: string): Record<string, any[]> => {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Basic validation
      if (typeof parsed === 'object' && parsed !== null) {
        // Ensure values are arrays
        Object.keys(parsed).forEach(k => {
          if (!Array.isArray(parsed[k])) {
            parsed[k] = []; // Reset if not an array
          }
        });
        return parsed;
      }
    }
  } catch (e) {
    console.error(`Failed to load or parse history from localStorage key "${key}":`, e);
  }
  return {};
};

// Helper to save history to localStorage
const saveHistory = (key: string, history: Record<string, any[]>) => {
  try {
    localStorage.setItem(key, JSON.stringify(history));
  } catch (e) {
    console.error(`Failed to save history to localStorage key "${key}":`, e);
  }
};


// Add isReloading to window for TypeScript
declare global {
  interface Window {
    isReloading?: boolean;
    mcpSseCallback?: (data: any) => void;
  }
}

function App() {
  // Track whether this is the first render
  const isFirstRender = useRef(true);
  const isUnmounting = useRef(false);

  // State for call history
  const [toolCallHistory, setToolCallHistory] = useState<Record<string, any[]>>(() => loadHistory(TOOL_HISTORY_KEY));
  const [resourceAccessHistory, setResourceAccessHistory] = useState<Record<string, any[]>>(() => loadHistory(RESOURCE_HISTORY_KEY));


  // Use custom hooks
  const {
    responses,
    autoScroll,
    setAutoScroll,
    addLogEntry,
    handleClearResponse
  } = useLogEntries();

  const {
    serverUrl,
    setServerUrl,
    connectionStatus,
    // sessionId, // Removed
    isConnecting,
    // sendJsonRpcRequest, // Removed
    client, // Get client instance from SDK hook
    recentServers, // Get recent servers from hook
    handleConnect,
    handleDisconnect,
    removeRecentServer // Get remove function from hook
  } = useConnection(addLogEntry);

  const {
    tools,
    setTools,
    resources,
    setResources,
    selectedTool,
    setSelectedTool,
    selectedResourceTemplate,
    setSelectedResourceTemplate,
    prompts, // Added
    setPrompts, // Added
    selectedPrompt, // Added
    setSelectedPrompt, // Added
    toolParams,
    setToolParams,
    resourceArgs,
    setResourceArgs,
    promptParams, // Added
    setPromptParams, // Added
    handleListTools,
    handleListResources,
    handleListPrompts, // Added
    handleExecuteTool, // Uncommented for use in wrapper
    handleExecutePrompt, // Uncommented for use in wrapper
    handleParamChange, // Updated signature in hook
    handleResourceArgChange,
    handleSelectTool,
    handleSelectResourceTemplate,
    handleSelectPrompt // Added
  } = useToolsAndResources(client, addLogEntry, connectionStatus); // Pass client

  // Pass client to useResourceAccess
  const { handleAccessResource: accessResource } = useResourceAccess(client, addLogEntry);

  // Remove useEffects for window.mcpSseCallback and 'mcp-sse-event' listener
  // SDK Client handles events internally, and useConnection fetches initial lists.
  // List change notifications *could* be handled via client.onNotification if needed,
  // but we removed that for simplicity earlier.

  // Wrapper function to handle resource access and save history
  const handleAccessResource = () => {
    if (!selectedResourceTemplate) return;
    const uri = selectedResourceTemplate.uri; // Assuming ResourceTemplate has a URI
    accessResource(selectedResourceTemplate, resourceArgs);

    // Update history only if resourceArgs is not empty
    if (Object.keys(resourceArgs).length > 0) {
        setResourceAccessHistory(prevHistory => {
          // Ensure uri is treated as a string key
          const uriKey = uri as string ?? '';
          const currentList = prevHistory[uriKey] || [];
          // Avoid adding exact duplicate of the last entry
          if (JSON.stringify(currentList[0]) === JSON.stringify(resourceArgs)) {
            return prevHistory;
          }
          const updatedList = [resourceArgs, ...currentList].slice(0, MAX_HISTORY_ITEMS);
          const newHistory = { ...prevHistory, [uriKey]: updatedList };
          saveHistory(RESOURCE_HISTORY_KEY, newHistory);
          return newHistory;
        });
    } else {
        console.log("[DEBUG] Skipping resource history save: No arguments provided.");
    }
  };

  // Wrapper for handleParamChange to determine type
  const handleParamChangeWrapper = (paramName: string, value: any) => {
    if (selectedTool) {
      handleParamChange(paramName, value, 'tool');
    } else if (selectedPrompt) {
      handleParamChange(paramName, value, 'prompt');
    }
  };


  // Wrapper function to handle connect, accepting optional URL override
  const handleConnectWrapper = (urlToConnect?: string) => {
    // Pass setters and optional URL to the SDK-based handleConnect
    handleConnect(
      setTools,
      setResources,
      handleClearResponse, // Pass handleClearResponse to clear logs on connect
      urlToConnect // Pass the optional URL
    );
  };

  // Wrapper for handleExecuteTool to save history
  const handleExecuteToolWrapper = () => {
    if (!selectedTool || !client) return;
    const toolName = selectedTool.name;
    handleExecuteTool(); // Call original hook function (no args needed)

    // Update history only if toolParams is not empty
    if (Object.keys(toolParams).length > 0) {
        setToolCallHistory(prevHistory => {
          // Ensure toolName is treated as a string key
          const toolNameKey = toolName as string ?? '';
          const currentList = prevHistory[toolNameKey] || [];
           // Avoid adding exact duplicate of the last entry
          if (JSON.stringify(currentList[0]) === JSON.stringify(toolParams)) {
            return prevHistory;
          }
          const updatedList = [toolParams, ...currentList].slice(0, MAX_HISTORY_ITEMS);
          const newHistory = { ...prevHistory, [toolNameKey]: updatedList };
          saveHistory(TOOL_HISTORY_KEY, newHistory);
          return newHistory;
        });
    } else {
        console.log("[DEBUG] Skipping tool history save: No parameters provided.");
    }
  };

  // Wrapper for handleExecutePrompt (add history saving if needed later)
  const handleExecutePromptWrapper = () => {
     if (!selectedPrompt || !client) return;
     handleExecutePrompt(); // Call original hook function (no args needed)
     // TODO: Add prompt history saving if required
  };

  // Wrapper for handleDisconnect to include state cleanup
  const handleDisconnectWrapper = async () => {
    await handleDisconnect(); // Call the original hook function
    // Clear related state after disconnect completes
    setTools([]);
    setResources([]);
    setPrompts([]);
    setSelectedTool(null);
    setSelectedResourceTemplate(null);
    setSelectedPrompt(null);
    setToolParams({});
    setResourceArgs({});
    setPromptParams({});
    console.log("[DEBUG] Cleared tools, resources, prompts, and params state after disconnect.");
  };


  // Effect for cleanup on unmount - only run on actual unmount, not during React strict mode checks
  useEffect(() => {
    // Skip the first render effect (which would be duplicated in strict mode)
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    return () => {
      // Only perform cleanup if this is a real unmount, not a strict mode check
      isUnmounting.current = true;
      
      if (connectionStatus !== 'Disconnected') {
        console.log("Cleaning up connection on component unmount.");
        // Only disconnect if this is a real unmount, not a strict mode check
        // In development, React 18's strict mode will mount/unmount components twice
        // We don't want to disconnect during these checks
        const isStrictModeCheck = document.visibilityState === 'visible' && 
                                 document.hasFocus() && 
                                 !window.isReloading;
                                 
        if (isStrictModeCheck) {
          console.log("Skipping disconnect - detected React strict mode check");
          addLogEntry({ type: 'info', data: 'Skipping disconnect during React strict mode check' });
        } else {
          addLogEntry({ type: 'info', data: 'Disconnecting on component unmount...' });
          handleDisconnect(); // No argument needed
        }
      }
    };
  }, [connectionStatus, addLogEntry, handleDisconnect]);

  // Effect to automatically list items when connected
  useEffect(() => {
    if (connectionStatus === 'Connected') {
      console.log("[DEBUG] Connection established, automatically listing tools, resources, and prompts.");
      addLogEntry({ type: 'info', data: 'Connection established. Fetching lists...' });
      handleListTools();
      handleListResources();
      handleListPrompts();
    }
  }, [connectionStatus, handleListTools, handleListResources, handleListPrompts, addLogEntry]); // Add dependencies


  // Determine button disabled states
  const isConnected = connectionStatus === 'Connected';
  const isDisconnected = connectionStatus === 'Disconnected';

  // Wrapper function for the refresh button
  const handleRefreshAllLists = () => {
    if (!isConnected) return;
    addLogEntry({ type: 'info', data: 'Refreshing all lists...' });
    handleListTools();
    handleListResources();
    handleListPrompts();
  };

  // JSX Structure
  return (
    <div className="container-fluid">
      <Header />

      {/* Action Toolbar Removed */}

      <div className="row">
        {/* Left Panel */}
        <div className="col-md-4">
          <ConnectionPanel
            serverUrl={serverUrl}
            setServerUrl={setServerUrl}
            connectionStatus={connectionStatus}
            isConnecting={isConnecting}
            isConnected={isConnected}
            isDisconnected={isDisconnected}
            handleConnect={handleConnectWrapper}
            handleDisconnect={handleDisconnectWrapper} // Use the wrapper
            recentServers={recentServers} // Pass recent servers down (still needed for ConnectionPanel input)
          />
          {/* Add Recent Servers Panel */}
          <RecentServersPanel
             recentServers={recentServers}
             setServerUrl={setServerUrl}
             handleConnect={handleConnectWrapper} // Use the wrapper
             removeRecentServer={removeRecentServer}
             isConnected={isConnected}
             isConnecting={isConnecting}
          />
          {/* Unified Panel */}
          <UnifiedPanel
            tools={tools}
            resources={resources}
            prompts={prompts}
            selectedTool={selectedTool}
            selectedResourceTemplate={selectedResourceTemplate}
            selectedPrompt={selectedPrompt}
            handleSelectTool={handleSelectTool}
            handleSelectResourceTemplate={handleSelectResourceTemplate}
            handleSelectPrompt={handleSelectPrompt}
            connectionStatus={connectionStatus} // Pass connection status
            onRefreshLists={handleRefreshAllLists} // Pass refresh handler
            isConnecting={isConnecting} // Pass connecting status
          />
        </div>

        {/* Middle Panel */}
        <div className="col-md-4">
          <ParamsPanel
            selectedTool={selectedTool}
            selectedResourceTemplate={selectedResourceTemplate}
            selectedPrompt={selectedPrompt} // Pass selectedPrompt
            toolParams={toolParams}
            resourceArgs={resourceArgs}
            promptParams={promptParams} // Pass promptParams
            isConnected={isConnected}
            isConnecting={isConnecting}
            handleParamChange={handleParamChangeWrapper} // Pass wrapper
            handleResourceArgChange={handleResourceArgChange}
            handleExecuteTool={handleExecuteToolWrapper} // Pass history wrapper
            handleExecutePrompt={handleExecutePromptWrapper} // Pass wrapper (add history later if needed)
            handleAccessResource={handleAccessResource} // Pass history wrapper
            parseUriTemplateArgs={parseUriTemplateArgs}
            // Pass history and setters for ParamsPanel UI
            // Ensure keys are treated as strings and handle potential null/undefined
            toolHistory={toolCallHistory[selectedTool?.name as string ?? ''] || []}
            resourceHistory={resourceAccessHistory[selectedResourceTemplate?.uri as string ?? ''] || []}
            setToolParams={setToolParams}
            setResourceArgs={setResourceArgs}
          />
        </div>

        {/* Right Panel */}
        <div className="col-md-4">
          <ResponsePanel
            responses={responses}
            autoScroll={autoScroll}
            setAutoScroll={setAutoScroll}
            handleClearResponse={handleClearResponse}
            isConnected={isConnected} // Pass isConnected prop
          />
        </div>
      </div>
    </div>
  );
}

export default App;