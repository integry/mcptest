import React, { useEffect, useRef, useState } from 'react';

// Import Components
import Header from './components/Header';
import ConnectionPanel from './components/ConnectionPanel';
import ToolsPanel from './components/ToolsPanel';
import ResourcesPanel from './components/ResourcesPanel';
import ParamsPanel from './components/ParamsPanel';
import ResponsePanel from './components/ResponsePanel';

// Import Hooks
import { useLogEntries } from './hooks/useLogEntries';
import { useConnection } from './hooks/useConnection';
import { useToolsAndResources } from './hooks/useToolsAndResources';
import { useResourceAccess } from './hooks/useResourceAccess';

// Import Utils
import { parseUriTemplateArgs } from './utils/uriUtils';

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
    handleConnect,
    handleDisconnect
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
    toolParams,
    setToolParams,
    resourceArgs,
    setResourceArgs,
    handleListTools,
    handleListResources,
    handleExecuteTool,
    handleParamChange,
    handleResourceArgChange,
    handleSelectTool,
    handleSelectResourceTemplate
  } = useToolsAndResources(client, addLogEntry, connectionStatus); // Pass client

  // Pass client to useResourceAccess
  const { handleAccessResource: accessResource } = useResourceAccess(client, addLogEntry);

  // Remove useEffects for window.mcpSseCallback and 'mcp-sse-event' listener
  // SDK Client handles events internally, and useConnection fetches initial lists.
  // List change notifications *could* be handled via client.onNotification if needed,
  // but we removed that for simplicity earlier.

  // Wrapper function to handle resource access
  const handleAccessResource = () => {
    accessResource(selectedResourceTemplate, resourceArgs);
  };

  // Wrapper function to handle connect with necessary state setters
  const handleConnectWrapper = () => {
    // Pass only the necessary setters to the SDK-based handleConnect
    handleConnect(
      setTools,
      setResources,
      handleClearResponse // Pass handleClearResponse to clear logs on connect
    );
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

  // Determine button disabled states
  const isConnected = connectionStatus === 'Connected';
  const isDisconnected = connectionStatus === 'Disconnected';

  // JSX Structure
  return (
    <div className="container-fluid">
      <Header />

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
            handleDisconnect={handleDisconnect}
          />
          <ToolsPanel
            tools={tools}
            selectedTool={selectedTool}
            isConnected={isConnected}
            isConnecting={isConnecting}
            handleListTools={() => handleListTools()}
            handleSelectTool={handleSelectTool}
          />
          <ResourcesPanel
            resources={resources}
            selectedResourceTemplate={selectedResourceTemplate}
            isConnected={isConnected}
            isConnecting={isConnecting}
            handleListResources={() => handleListResources()}
            handleSelectResourceTemplate={handleSelectResourceTemplate}
          />
        </div>

        {/* Middle Panel */}
        <div className="col-md-4">
          <ParamsPanel
            selectedTool={selectedTool}
            selectedResourceTemplate={selectedResourceTemplate}
            toolParams={toolParams}
            resourceArgs={resourceArgs}
            isConnected={isConnected}
            isConnecting={isConnecting}
            handleParamChange={handleParamChange}
            handleResourceArgChange={handleResourceArgChange}
            handleExecuteTool={handleExecuteTool}
            handleAccessResource={handleAccessResource}
            parseUriTemplateArgs={parseUriTemplateArgs}
          />
        </div>

        {/* Right Panel */}
        <div className="col-md-4">
          <ResponsePanel
            responses={responses}
            autoScroll={autoScroll}
            setAutoScroll={setAutoScroll}
            handleClearResponse={handleClearResponse}
          />
        </div>
      </div>
    </div>
  );
}

export default App;