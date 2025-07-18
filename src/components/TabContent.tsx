import React, { useEffect, useRef, useState } from 'react';
import { ConnectionTab, LogEntry } from '../types';
import { logEvent } from '../utils/analytics';

// Import Components
import ConnectionPanel from './ConnectionPanel';
import { UnifiedPanel } from './UnifiedPanel';
import { RecentServersPanel } from './RecentServersPanel';
import { SuggestedServersPanel } from './SuggestedServersPanel';
import ParamsPanel from './ParamsPanel';
import ResponsePanel from './ResponsePanel';
import ResultPanel from './ResultPanel';

// Import Hooks
import { useLogEntries } from '../hooks/useLogEntries';
import { useConnection } from '../hooks/useConnection';
import { useToolsAndResources } from '../hooks/useToolsAndResources';
import { useResourceAccess } from '../hooks/useResourceAccess';

// Import Utils
import { parseUriTemplateArgs } from '../utils/uriUtils';

// Constants for localStorage keys
const TOOL_HISTORY_KEY = 'mcpToolCallHistory';
const RESOURCE_HISTORY_KEY = 'mcpResourceAccessHistory';
const MAX_HISTORY_ITEMS = 10;

// Helper to load history from localStorage
const loadData = <T extends {}>(key: string, defaultValue: T): T => {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      let parsed = JSON.parse(stored);
      if (typeof parsed === typeof defaultValue && parsed !== null) {
        return parsed as T;
      }
    }
  } catch (e) {
    console.error(`Failed to load or parse data from localStorage key "${key}":`, e);
  }
  return defaultValue;
};

// Helper to save history to localStorage
const saveData = (key: string, data: any) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error(`Failed to save data to localStorage key "${key}":`, e);
  }
};

interface TabContentProps {
  tab: ConnectionTab;
  isActive: boolean;
  onUpdateTab: (tabId: string, updates: Partial<ConnectionTab>) => void;
  spaces: any[];
  onAddCardToSpace: (spaceId: string, cardData: any) => void;
}

const TabContent: React.FC<TabContentProps> = ({ tab, isActive, onUpdateTab, spaces, onAddCardToSpace }) => {
  // Track whether this is the first render
  const isFirstRender = useRef(true);
  const isUnmounting = useRef(false);
  const hasInitialized = useRef(false);

  // State for call history
  const [toolCallHistory, setToolCallHistory] = useState<Record<string, any[]>>(() => loadData(TOOL_HISTORY_KEY, {}));
  const [resourceAccessHistory, setResourceAccessHistory] = useState<Record<string, any[]>>(() => loadData(RESOURCE_HISTORY_KEY, {}));
  const [lastResult, setLastResult] = useState<LogEntry | null>(null);

  // Custom Hooks for this tab
  const {
    responses,
    setResponses,
    autoScroll,
    setAutoScroll,
    addLogEntry,
    handleClearResponse
  } = useLogEntries();

  const {
    serverUrl,
    setServerUrl,
    connectionStatus,
    transportType,
    isConnecting,
    connectionStartTime,
    connectionError,
    clearConnectionError,
    client,
    recentServers,
    handleConnect,
    handleDisconnect,
    handleAbortConnection,
    removeRecentServer
  } = useConnection(addLogEntry);

  const {
    tools,
    setTools,
    resources,
    setResources,
    resourceTemplates,
    setResourceTemplates,
    selectedTool,
    setSelectedTool,
    selectedResourceTemplate,
    setSelectedResourceTemplate,
    prompts,
    setPrompts,
    selectedPrompt,
    setSelectedPrompt,
    toolParams,
    setToolParams,
    resourceArgs,
    setResourceArgs,
    promptParams,
    setPromptParams,
    handleListTools,
    handleListResources,
    handleListResourceTemplates,
    handleListPrompts,
    handleExecuteTool,
    handleExecutePrompt,
    handleParamChange,
    handleResourceArgChange,
    handleSelectTool: originalHandleSelectTool,
    handleSelectResourceTemplate: originalHandleSelectResourceTemplate,
    handleSelectPrompt: originalHandleSelectPrompt
  } = useToolsAndResources(client, addLogEntry, connectionStatus, serverUrl);

  const handleSelectTool = (tool: any) => {
    originalHandleSelectTool(tool);
    setLastResult(null);
  };
  const handleSelectResourceTemplate = (template: any) => {
    originalHandleSelectResourceTemplate(template);
    setLastResult(null);
  };
  const handleSelectPrompt = (prompt: any) => {
    originalHandleSelectPrompt(prompt);
    setLastResult(null);
  };

  const { handleAccessResource: accessResource } = useResourceAccess(client, addLogEntry, serverUrl);

  // Initialize tab state only once
  useEffect(() => {
    if (!hasInitialized.current) {
      setServerUrl(tab.serverUrl);
      hasInitialized.current = true;
    }
  }, []); // Empty dependency array - only run once

  // Update tab when connection status changes (only if different)
  useEffect(() => {
    if (tab.connectionStatus !== connectionStatus || tab.transportType !== transportType) {
      onUpdateTab(tab.id, { 
        connectionStatus: connectionStatus as ConnectionTab['connectionStatus'],
        transportType: transportType 
      });
    }
  }, [connectionStatus, transportType, tab.id, tab.connectionStatus, tab.transportType, onUpdateTab]);

  // Update tab when server URL changes (only if different)
  useEffect(() => {
    if (tab.serverUrl !== serverUrl) {
      // Update server URL and tab title when URL changes
      let newTitle = tab.title;
      if (serverUrl) {
        try {
          const hostname = new URL(serverUrl).hostname;
          newTitle = hostname;
        } catch {
          // If URL parsing fails, use the serverUrl as-is for title
          newTitle = serverUrl;
        }
      } else {
        // If serverUrl is empty, reset to "New Connection"
        newTitle = 'New Connection';
      }
      
      onUpdateTab(tab.id, { serverUrl, title: newTitle });
    }
  }, [serverUrl, tab.id, tab.serverUrl, tab.title, onUpdateTab]);

  // Effect to automatically list items when connected and update tab title
  useEffect(() => {
    if (connectionStatus === 'Connected') {
      console.log(`[DEBUG] Tab ${tab.id}: Connection established, automatically listing capabilities.`);
      addLogEntry({ type: 'info', data: 'Connection established. Fetching lists...' });
      handleListTools();
      handleListResources();
      handleListResourceTemplates();
      handleListPrompts();
      
      // Update tab title if it's still the default "New Connection"
      if (tab.title === 'New Connection' && serverUrl) {
        try {
          const hostname = new URL(serverUrl).hostname;
          onUpdateTab(tab.id, { title: hostname });
        } catch {
          // If URL parsing fails, use the serverUrl as-is
          onUpdateTab(tab.id, { title: serverUrl });
        }
      }
    }
  }, [connectionStatus, handleListTools, handleListResources, handleListResourceTemplates, handleListPrompts, addLogEntry, tab.id, tab.title, serverUrl, onUpdateTab]);

  // Effect for cleanup on unmount
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    return () => {
      isUnmounting.current = true;
      if (connectionStatus !== 'Disconnected') {
        console.log(`Tab ${tab.id}: Cleaning up connection on component unmount.`);
        const isStrictModeCheck = document.visibilityState === 'visible' && document.hasFocus();
        if (isStrictModeCheck) {
          console.log(`Tab ${tab.id}: Skipping disconnect - detected React strict mode check`);
        } else {
          addLogEntry({ type: 'info', data: 'Disconnecting on component unmount...' });
          handleDisconnect();
        }
      }
    };
  }, [connectionStatus, addLogEntry, handleDisconnect, tab.id]);

  // Effect to clear capabilities when connection status changes
  useEffect(() => {
    if (connectionStatus === 'Connecting' || connectionStatus === 'Disconnected') {
      setTools([]);
      setResources([]);
      setResourceTemplates([]);
      setPrompts([]);
      setSelectedTool(null);
      setSelectedResourceTemplate(null);
      setSelectedPrompt(null);
      console.log(`[DEBUG] Tab ${tab.id}: Cleared all capabilities for connection status change`);
    }
  }, [connectionStatus, tab.id]);

  // Wrapper function to handle resource access and save history
  const handleAccessResource = async () => {
    if (!selectedResourceTemplate) return;
    logEvent('access_resource');
    const uri = selectedResourceTemplate.uriTemplate;
    const result = await accessResource(selectedResourceTemplate, resourceArgs);
    setLastResult(result);

    if (Object.keys(resourceArgs).length > 0) {
      setResourceAccessHistory(prevHistory => {
        const uriKey = uri as string ?? '';
        const currentList = prevHistory[uriKey] || [];
        if (JSON.stringify(currentList[0]) === JSON.stringify(resourceArgs)) {
          return prevHistory;
        }
        const updatedList = [resourceArgs, ...currentList].slice(0, MAX_HISTORY_ITEMS);
        const newHistory = { ...prevHistory, [uriKey]: updatedList };
        saveData(RESOURCE_HISTORY_KEY, newHistory);
        return newHistory;
      });
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

  // Wrapper function to handle connect
  const handleConnectWrapper = (urlToConnect?: string) => {
    handleConnect(
      setTools,
      setResources,
      setResponses,
      urlToConnect
    );
  };

  // Wrapper for handleExecuteTool to save history
  const handleExecuteToolWrapper = async () => {
    if (!selectedTool || !client) return;
    const toolName = selectedTool.name;
    const result = await handleExecuteTool();
    setLastResult(result);

    if (Object.keys(toolParams).length > 0) {
      setToolCallHistory(prevHistory => {
        const toolNameKey = toolName as string ?? '';
        const currentList = prevHistory[toolNameKey] || [];
        if (JSON.stringify(currentList[0]) === JSON.stringify(toolParams)) {
          return prevHistory;
        }
        const updatedList = [toolParams, ...currentList].slice(0, MAX_HISTORY_ITEMS);
        const newHistory = { ...prevHistory, [toolNameKey]: updatedList };
        saveData(TOOL_HISTORY_KEY, newHistory);
        return newHistory;
      });
    }
  };

  // Wrapper for handleExecutePrompt
  const handleExecutePromptWrapper = async () => {
    if (!selectedPrompt || !client) return;
    const result = await handleExecutePrompt();
    setLastResult(result);
  };

  // Wrapper for handleDisconnect to include state cleanup
  const handleDisconnectWrapper = async () => {
    await handleDisconnect();
    setTools([]);
    setResources([]);
    setPrompts([]);
    setSelectedTool(null);
    setSelectedResourceTemplate(null);
    setSelectedPrompt(null);
    setToolParams({});
    setResourceArgs({});
    setPromptParams({});
    console.log(`[DEBUG] Tab ${tab.id}: Cleared state after disconnect.`);
  };

  // Determine button disabled states
  const isConnected = connectionStatus === 'Connected';
  const isDisconnected = connectionStatus === 'Disconnected';

  // Wrapper function for the refresh button
  const handleRefreshAllLists = () => {
    if (!isConnected) return;
    logEvent('refresh_capabilities');
    addLogEntry({ type: 'info', data: 'Refreshing all lists...' });
    handleListTools();
    handleListResources();
    handleListResourceTemplates();
    handleListPrompts();
  };

  return (
    <div 
      className={`tab-content-panel ${isActive ? '' : 'd-none'}`}
      style={{ 
        height: '100%',
        position: isActive ? 'static' : 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0
      }}
    >
      <div className="inspector-layout row h-100" style={{ paddingTop: '1rem' }}>
        {/* Left Panel */}
        <div className={isConnected ? "col-md-4" : "col-12"}>
          <ConnectionPanel
            serverUrl={serverUrl}
            setServerUrl={setServerUrl}
            connectionStatus={connectionStatus}
            transportType={transportType}
            isConnecting={isConnecting}
            isConnected={isConnected}
            isDisconnected={isDisconnected}
            connectionStartTime={connectionStartTime}
            handleConnect={handleConnectWrapper}
            handleDisconnect={handleDisconnectWrapper}
            handleAbortConnection={handleAbortConnection}
            recentServers={recentServers}
            connectionError={connectionError}
            clearConnectionError={clearConnectionError}
          />
          {!isConnected && (
            <>
              <RecentServersPanel
                recentServers={recentServers}
                setServerUrl={setServerUrl}
                handleConnect={handleConnectWrapper}
                removeRecentServer={removeRecentServer}
                isConnected={isConnected}
                isConnecting={isConnecting}
              />
              <SuggestedServersPanel
                setServerUrl={setServerUrl}
                handleConnect={handleConnectWrapper}
                isConnected={isConnected}
                isConnecting={isConnecting}
              />
            </>
          )}
          {isConnected && (
            <UnifiedPanel
              tools={tools}
              resources={resources}
              resourceTemplates={resourceTemplates}
              prompts={prompts}
              selectedTool={selectedTool}
              selectedResourceTemplate={selectedResourceTemplate}
              selectedPrompt={selectedPrompt}
              handleSelectTool={handleSelectTool}
              handleSelectResourceTemplate={handleSelectResourceTemplate}
              handleSelectPrompt={handleSelectPrompt}
              connectionStatus={connectionStatus}
              onRefreshLists={handleRefreshAllLists}
              isConnecting={isConnecting}
            />
          )}
        </div>

        {/* Right Panel - Stacked Parameters and Logs */}
        <div className="col-md-8">
          {isConnected && (
            <>
              {/* Parameters / Arguments Panel */}
              <ParamsPanel
                selectedTool={selectedTool}
                selectedResourceTemplate={selectedResourceTemplate}
                selectedPrompt={selectedPrompt}
                toolParams={toolParams}
                resourceArgs={resourceArgs}
                promptParams={promptParams}
                isConnected={isConnected}
                isConnecting={isConnecting}
                handleParamChange={handleParamChangeWrapper}
                handleResourceArgChange={handleResourceArgChange}
                handleExecuteTool={handleExecuteToolWrapper}
                handleExecutePrompt={handleExecutePromptWrapper}
                handleAccessResource={handleAccessResource}
                parseUriTemplateArgs={parseUriTemplateArgs}
                toolHistory={toolCallHistory[selectedTool?.name as string ?? ''] || []}
                resourceHistory={resourceAccessHistory[selectedResourceTemplate?.uriTemplate as string ?? ''] || []}
                setToolParams={setToolParams}
                setResourceArgs={setResourceArgs}
              />

              {/* Result Panel */}
              <ResultPanel
                lastResult={lastResult}
                isConnected={isConnected}
                serverUrl={tab.serverUrl}
              />

              {/* Logs & Events Panel */}
              <ResponsePanel
                responses={responses}
                autoScroll={autoScroll}
                setAutoScroll={setAutoScroll}
                handleClearResponse={handleClearResponse}
                isConnected={isConnected}
                spaces={spaces}
                onAddCardToSpace={onAddCardToSpace}
                serverUrl={serverUrl}
                selectedTool={selectedTool}
                selectedResourceTemplate={selectedResourceTemplate}
                toolParams={toolParams}
                resourceArgs={resourceArgs}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default TabContent;