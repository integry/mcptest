import React, { useEffect, useRef, useState } from 'react';
import { ConnectionTab, LogEntry } from '../types';
import { logEvent } from '../utils/analytics';

// Import Components
import ConnectionPanel from './ConnectionPanel';
import { UnifiedPanel } from './UnifiedPanel';
import { RecentServersPanel } from './RecentServersPanel';
import { SuggestedServersPanel } from './SuggestedServersPanel';
import ParamsPanel from './ParamsPanel';
import OutputPanel from './OutputPanel';

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
  
  // Execution state
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionStartTime, setExecutionStartTime] = useState<number | null>(null);

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
    isProxied, // Destructure from useConnection
    removeRecentServer
  } = useConnection(addLogEntry, tab.useProxy);

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

  // Initialize tab state and handle auto-connection
  const hasAutoConnected = useRef(false);
  useEffect(() => {
    if (!hasInitialized.current) {
      setServerUrl(tab.serverUrl);
      hasInitialized.current = true;
    }
    
    // Auto-connect if this tab has resultShareData (result share URL) and we haven't already
    if (
      tab.resultShareData && 
      tab.serverUrl && 
      connectionStatus === 'Disconnected' && 
      !hasAutoConnected.current
    ) {
      console.log(`[Auto-Connect] Initiating connection for result share URL to: ${tab.serverUrl}`);
      addLogEntry({ type: 'info', data: `Auto-connecting to ${tab.serverUrl} for result share...` });
      hasAutoConnected.current = true;
      
      // Use a small timeout to ensure state is properly initialized
      setTimeout(() => {
        handleConnect(
          setTools,
          setResources,
          setResponses,
          tab.serverUrl
        );
      }, 100);
    }
  }, [
    tab.resultShareData, 
    tab.serverUrl, 
    connectionStatus, 
    addLogEntry, 
    handleConnect,
    setTools,
    setResources,
    setResponses
  ]);

  // Update tab when connection status changes (only if different)
  useEffect(() => {
    if (tab.connectionStatus !== connectionStatus || tab.transportType !== transportType) {
      onUpdateTab(tab.id, { 
        connectionStatus: connectionStatus as ConnectionTab['connectionStatus'],
        transportType: transportType 
      });
    }
  }, [connectionStatus, transportType, tab.id, onUpdateTab]);

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
  }, [serverUrl, tab.id, onUpdateTab]);

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

  // Effect to handle auto-execution for result share URLs
  const autoExecutionKey = useRef<string | null>(null);
  
  useEffect(() => {
    // Create a unique key for this auto-execution request
    const currentKey = tab.resultShareData ? `${tab.id}-${tab.resultShareData.type}-${tab.resultShareData.name}` : null;
    
    // Only proceed if we have result share data and haven't executed for this specific key
    if (
      connectionStatus === 'Connected' &&
      tab.resultShareData &&
      currentKey &&
      currentKey !== autoExecutionKey.current &&
      ((tab.resultShareData.type === 'tool' && tools.length > 0) ||
       (tab.resultShareData.type === 'resource' && (resources.length > 0 || resourceTemplates.length > 0)))
    ) {
      // Mark this execution as started
      autoExecutionKey.current = currentKey;
      console.log(`[Auto-Execute] Starting execution for key: ${currentKey}`);
      
      const { type, name, params } = tab.resultShareData;
      
      if (type === 'tool') {
        // Find the tool by name
        const tool = tools.find(t => t.name === name);
        if (tool) {
          console.log(`[Auto-Execute] Found tool: ${name}, preparing execution...`);
          addLogEntry({ type: 'info', data: `Auto-executing tool: ${name}` });
          
          // Select the tool and set params
          handleSelectTool(tool);
          if (params) {
            setToolParams(params);
          }
          
          // Execute the tool
          setTimeout(async () => {
            console.log('[Auto-Execute] Executing tool now...');
            
            // Execute directly using the client instead of relying on selectedTool state
            if (client && connectionStatus === 'Connected') {
              try {
                addLogEntry({ type: 'info', data: `Executing tool: ${tool.name}...` });
                const result = await client.callTool({
                  name: tool.name,
                  arguments: params || {},
                });
                
                console.log(`[DEBUG] SDK Client: Tool "${tool.name}" execution result:`, result);
                
                // Process and log the result
                if (result?.content && Array.isArray(result.content)) {
                  const resultLogEntry: LogEntry = {
                    type: 'tool_result',
                    data: result.content,
                    timestamp: new Date().toLocaleTimeString(),
                    callContext: {
                      serverUrl: serverUrl,
                      type: 'tool',
                      name: tool.name,
                      params: params || {}
                    }
                  };
                  addLogEntry(resultLogEntry);
                  setLastResult(resultLogEntry);
                } else {
                  const resultText = JSON.stringify(result);
                  const warningLogEntry: LogEntry = { type: 'warning', data: `Tool ${tool.name} result (unexpected format): ${resultText}`, timestamp: new Date().toLocaleTimeString() };
                  addLogEntry(warningLogEntry);
                  setLastResult(warningLogEntry);
                }
                
                // Clear the resultShareData after execution
                onUpdateTab(tab.id, { resultShareData: undefined });
              } catch (error: any) {
                console.error(`[DEBUG] Error executing tool "${tool.name}" via SDK:`, error);
                const errorLogEntry: LogEntry = { type: 'error', data: `Failed to execute tool ${tool.name}: ${error.message || error}`, timestamp: new Date().toLocaleTimeString() };
                addLogEntry(errorLogEntry);
                setLastResult(errorLogEntry);
              }
            }
          }, 1000); // Delay to ensure state updates
        } else {
          addLogEntry({ type: 'error', data: `Tool not found: ${name}` });
        }
      } else if (type === 'resource') {
        // First check if it's a direct resource
        const resource = resources.find(r => r.uri === name);
        if (resource) {
          console.log(`[Auto-Execute] Found direct resource: ${name}, preparing access...`);
          addLogEntry({ type: 'info', data: `Auto-accessing resource: ${name}` });
          
          // For direct resources, we need to create a pseudo-template
          const pseudoTemplate = { uriTemplate: name };
          handleSelectResourceTemplate(pseudoTemplate);
          
          // Access the resource
          setTimeout(async () => {
            console.log('[Auto-Execute] Accessing resource now...');
            
            if (client && connectionStatus === 'Connected') {
              try {
                addLogEntry({ type: 'info', data: `Accessing resource: ${name}...` });
                const result = await client.readResource({ uri: name });
                
                console.log(`[DEBUG] SDK Client: Resource "${name}" access result:`, result);
                
                // Process and log the result
                if (result?.contents && Array.isArray(result.contents)) {
                  const resultLogEntry: LogEntry = {
                    type: 'resource_result',
                    data: result.contents,
                    timestamp: new Date().toLocaleTimeString(),
                    callContext: {
                      serverUrl: serverUrl,
                      type: 'resource',
                      name: name,
                      params: {}
                    }
                  };
                  addLogEntry(resultLogEntry);
                  setLastResult(resultLogEntry);
                } else {
                  const resultText = JSON.stringify(result);
                  const warningLogEntry: LogEntry = { type: 'warning', data: `Resource ${name} result (unexpected format): ${resultText}`, timestamp: new Date().toLocaleTimeString() };
                  addLogEntry(warningLogEntry);
                  setLastResult(warningLogEntry);
                }
                
                // Clear the resultShareData after execution
                onUpdateTab(tab.id, { resultShareData: undefined });
              } catch (error: any) {
                console.error(`[DEBUG] Error accessing resource "${name}" via SDK:`, error);
                const errorLogEntry: LogEntry = { type: 'error', data: `Failed to access resource ${name}: ${error.message || error}`, timestamp: new Date().toLocaleTimeString() };
                addLogEntry(errorLogEntry);
                setLastResult(errorLogEntry);
              }
            }
          }, 1000);
        } else {
          // Check resource templates
          const template = resourceTemplates.find(rt => {
            // Match based on the URI pattern
            const templatePattern = rt.uriTemplate.replace(/{[^}]+}/g, '[^/]+');
            const regex = new RegExp(`^${templatePattern}$`);
            return regex.test(name);
          });
          
          if (template) {
            console.log(`[Auto-Execute] Found resource template: ${template.uriTemplate}, preparing access...`);
            addLogEntry({ type: 'info', data: `Auto-accessing resource template: ${name}` });
            
            // Select the template and set args
            handleSelectResourceTemplate(template);
            if (params) {
              setResourceArgs(params);
            }
            
            // Access the resource
            setTimeout(async () => {
              console.log('[Auto-Execute] Accessing resource template now...');
              
              if (client && connectionStatus === 'Connected') {
                try {
                  // Build the final URI from template
                  let finalUri = template.uriTemplate;
                  const templateArgs = parseUriTemplateArgs(finalUri);
                  
                  templateArgs.forEach(arg => {
                    const value = params?.[arg];
                    if (value !== undefined && value !== null && value !== '') {
                      const pathRegex = new RegExp(`\\{${arg}\\}`, 'g');
                      finalUri = finalUri.replace(pathRegex, encodeURIComponent(String(value)));
                    }
                  });
                  
                  addLogEntry({ type: 'info', data: `Accessing resource: ${finalUri}...` });
                  const result = await client.readResource({ uri: finalUri });
                  
                  console.log(`[DEBUG] SDK Client: Resource "${finalUri}" access result:`, result);
                  
                  // Process and log the result
                  if (result?.contents && Array.isArray(result.contents)) {
                    const resultLogEntry: LogEntry = {
                      type: 'resource_result',
                      data: result.contents,
                      timestamp: new Date().toLocaleTimeString(),
                      callContext: {
                        serverUrl: serverUrl,
                        type: 'resource',
                        name: finalUri,
                        params: params || {}
                      }
                    };
                    addLogEntry(resultLogEntry);
                    setLastResult(resultLogEntry);
                  } else {
                    const resultText = JSON.stringify(result);
                    const warningLogEntry: LogEntry = { type: 'warning', data: `Resource ${finalUri} result (unexpected format): ${resultText}`, timestamp: new Date().toLocaleTimeString() };
                    addLogEntry(warningLogEntry);
                    setLastResult(warningLogEntry);
                  }
                  
                  // Clear the resultShareData after execution
                  onUpdateTab(tab.id, { resultShareData: undefined });
                } catch (error: any) {
                  console.error(`[DEBUG] Error accessing resource template "${template.uriTemplate}" via SDK:`, error);
                  const errorLogEntry: LogEntry = { type: 'error', data: `Failed to access resource: ${error.message || error}`, timestamp: new Date().toLocaleTimeString() };
                  addLogEntry(errorLogEntry);
                  setLastResult(errorLogEntry);
                }
              }
            }, 1000);
          } else {
            addLogEntry({ type: 'error', data: `Resource not found: ${name}` });
          }
        }
      }
    }
  }, [
    connectionStatus,
    tools,
    resources, 
    resourceTemplates,
    tab.resultShareData,
    tab.id,
    client,
    serverUrl
  ]);

  // Wrapper function to handle resource access and save history
  const handleAccessResource = async () => {
    if (!selectedResourceTemplate) return;
    logEvent('access_resource');
    
    setIsExecuting(true);
    setExecutionStartTime(Date.now());
    
    const uri = selectedResourceTemplate.uriTemplate;
    const result = await accessResource(selectedResourceTemplate, resourceArgs);
    setLastResult(result);
    
    setIsExecuting(false);
    setExecutionStartTime(null);

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
    
    setIsExecuting(true);
    setExecutionStartTime(Date.now());
    
    const toolName = selectedTool.name;
    const result = await handleExecuteTool();
    setLastResult(result);
    
    setIsExecuting(false);
    setExecutionStartTime(null);

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
    
    setIsExecuting(true);
    setExecutionStartTime(Date.now());
    
    const result = await handleExecutePrompt();
    setLastResult(result);
    
    setIsExecuting(false);
    setExecutionStartTime(null);
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

  // Handler for "Run again" functionality
  const handleRunAgain = async (callContext?: LogEntry['callContext']) => {
    if (!callContext || !client || connectionStatus !== 'Connected') {
      console.error('[Run Again] Missing call context, client, or not connected');
      return;
    }

    const { type, name, params } = callContext;
    
    if (type === 'tool') {
      // Find and select the tool
      const tool = tools.find(t => t.name === name);
      if (tool) {
        console.log(`[Run Again] Re-executing tool: ${name}`);
        addLogEntry({ type: 'info', data: `Re-executing tool: ${name}...` });
        
        // Select the tool and set params
        handleSelectTool(tool);
        setToolParams(params || {});
        
        // Execute after a small delay to ensure state updates
        setTimeout(() => {
          handleExecuteToolWrapper();
        }, 100);
      } else {
        addLogEntry({ type: 'error', data: `Tool not found: ${name}` });
      }
    } else if (type === 'resource') {
      // Check if it's a direct resource or template
      const resource = resources.find(r => r.uri === name);
      const template = resourceTemplates.find(rt => rt.uriTemplate === name);
      
      if (resource || template) {
        console.log(`[Run Again] Re-accessing resource: ${name}`);
        addLogEntry({ type: 'info', data: `Re-accessing resource: ${name}...` });
        
        // Select the resource/template and set args
        if (resource) {
          handleSelectResourceTemplate({ uriTemplate: name });
        } else if (template) {
          handleSelectResourceTemplate(template);
        }
        setResourceArgs(params || {});
        
        // Access after a small delay to ensure state updates
        setTimeout(() => {
          handleAccessResource();
        }, 100);
      } else {
        addLogEntry({ type: 'error', data: `Resource not found: ${name}` });
      }
    }
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
        bottom: 0,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
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
            useProxy={tab.useProxy}
            setUseProxy={(useProxy: boolean) => onUpdateTab(tab.id, { useProxy })}
            isProxied={isProxied} // Pass the new prop
          />
      <div className="playground-layout row flex-grow-1" style={{ paddingTop: '0' }}>
        {/* Left Panel */}
        <div className={isConnected ? "col-md-4" : "col-md-12"}>
          {!isConnected && (
            <div className="row g-3">
              {recentServers.length > 0 && (
                <div className="col-md-6">
                  <RecentServersPanel
                    recentServers={recentServers}
                    setServerUrl={setServerUrl}
                    handleConnect={handleConnectWrapper}
                    removeRecentServer={removeRecentServer}
                    isConnected={isConnected}
                    isConnecting={isConnecting}
                  />
                </div>
              )}
              <div className="col-md-6">
                <SuggestedServersPanel
                  setServerUrl={setServerUrl}
                  handleConnect={handleConnectWrapper}
                  isConnected={isConnected}
                  isConnecting={isConnecting}
                />
              </div>
            </div>
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

        {/* Right Panel */}
        <div className={isConnected ? "col-12 col-md-8 d-flex flex-column" : "col-12 col-md-8"}>
          {isConnected && (
            <>
              {/* Action Panel */}
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
                isExecuting={isExecuting}
                executionStartTime={executionStartTime}
              />
              {/* Output Panel */}
              <OutputPanel
                lastResult={lastResult}
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
                onRunAgain={handleRunAgain}
                useProxy={tab.useProxy}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default TabContent;