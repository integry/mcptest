import { useState, useCallback, useEffect, useRef } from 'react';
import { LogEntry, ResourceTemplate, SelectedTool } from '../types';

export const useToolsAndResources = (
  sendJsonRpcRequest: (method: string, params?: any) => Promise<any>,
  addLogEntry: (entryData: Omit<LogEntry, 'timestamp'>) => void,
  connectionStatus: string,
  sessionId: string | null
) => {
  const [tools, setTools] = useState<any[]>([]);
  const [resources, setResources] = useState<ResourceTemplate[]>([]); // Holds resource templates
  const [selectedTool, setSelectedTool] = useState<SelectedTool | null>(null);
  const [selectedResourceTemplate, setSelectedResourceTemplate] = useState<ResourceTemplate | null>(null);
  const [toolParams, setToolParams] = useState<Record<string, any>>({});
  const [resourceArgs, setResourceArgs] = useState<Record<string, any>>({});
  const pendingRequests = useRef<Record<string, { method: string }>>({});

  // Listen for SSE events
  useEffect(() => {
    const handleSseEvent = (event: CustomEvent) => {
      console.log("useToolsAndResources received SSE event:", event.detail);
      
      // Check if this is a response to a pending request
      if (event.detail && event.detail.id && pendingRequests.current[event.detail.id]) {
        const requestInfo = pendingRequests.current[event.detail.id];
        console.log(`Found pending request for id ${event.detail.id}:`, requestInfo);
        
        // Process the response based on the request method
        if (requestInfo.method === 'resources/templates/list') {
          if (event.detail.result && Array.isArray(event.detail.result.resourceTemplates)) {
            console.log("Setting resource templates from SSE event:", event.detail.result.resourceTemplates);
            setResources(event.detail.result.resourceTemplates);
            addLogEntry({ 
              type: 'info', 
              data: `Received ${event.detail.result.resourceTemplates.length} resource templates via SSE.` 
            });
          }
          // Clear the pending request
          delete pendingRequests.current[event.detail.id];
        } else if (requestInfo.method === 'tools/list') {
          if (event.detail.result && Array.isArray(event.detail.result.tools)) {
            console.log("Setting tools from SSE event:", event.detail.result.tools);
            setTools(event.detail.result.tools);
            addLogEntry({ 
              type: 'info', 
              data: `Received ${event.detail.result.tools.length} tools via SSE.` 
            });
          }
          // Clear the pending request
          delete pendingRequests.current[event.detail.id];
        }
      } 
      // Special case for resource templates that might not have the same ID
      else if (event.detail && event.detail.result && Array.isArray(event.detail.result.resourceTemplates)) {
        console.log("Setting resource templates from non-matching SSE event:", event.detail.result.resourceTemplates);
        setResources(event.detail.result.resourceTemplates);
        addLogEntry({ 
          type: 'info', 
          data: `Received ${event.detail.result.resourceTemplates.length} resource templates via SSE (non-matching ID).` 
        });
        
        // Clear any pending resource templates requests
        Object.keys(pendingRequests.current).forEach(id => {
          if (pendingRequests.current[id].method === 'resources/templates/list') {
            delete pendingRequests.current[id];
          }
        });
      }
      // Special case for tools that might not have the same ID
      else if (event.detail && event.detail.result && Array.isArray(event.detail.result.tools)) {
        console.log("Setting tools from non-matching SSE event:", event.detail.result.tools);
        setTools(event.detail.result.tools);
        addLogEntry({ 
          type: 'info', 
          data: `Received ${event.detail.result.tools.length} tools via SSE (non-matching ID).` 
        });
        
        // Clear any pending tools requests
        Object.keys(pendingRequests.current).forEach(id => {
          if (pendingRequests.current[id].method === 'tools/list') {
            delete pendingRequests.current[id];
          }
        });
      }
    };

    console.log("Added mcp-sse-event listener in useToolsAndResources");
    window.addEventListener('mcp-sse-event', handleSseEvent as EventListener);
    
    return () => {
      console.log("Removed mcp-sse-event listener in useToolsAndResources");
      window.removeEventListener('mcp-sse-event', handleSseEvent as EventListener);
    };
  }, [addLogEntry, setResources, setTools]);

  const handleListTools = useCallback(async (currentSessionId: string | null = sessionId) => {
    if (!currentSessionId || connectionStatus !== 'Connected') return;
    console.log("Listing tools...");
    
    // Mark this request as pending
    const requestId = Math.random().toString(36).substr(2, 9);
    pendingRequests.current[requestId] = { method: 'tools/list' };
    
    // Using the MCP protocol method names
    const response = await sendJsonRpcRequest('tools/list');
    
    // If we got a direct JSON response (not via SSE)
    if (response && response.result && Array.isArray(response.result.tools)) {
      setTools(response.result.tools);
      addLogEntry({ type: 'info', data: `Found ${response.result.tools.length} tools.` });
      delete pendingRequests.current[requestId];
    } 
    // If the response indicates it will come via SSE, wait for the SSE event
    else if (response && response.result && response.result._note?.includes("SSE stream")) {
      console.log("Tools list will be delivered via SSE stream");
      // We'll wait for the SSE event handler to process the response
    } 
    // Handle error case
    else if (response?.error) {
      console.error("Failed to list tools:", response.error);
      addLogEntry({ type: 'error', data: `Failed to list tools: ${response.error.message}` });
      setTools([]);
      delete pendingRequests.current[requestId];
    }
  }, [sessionId, connectionStatus, sendJsonRpcRequest, addLogEntry]);

  const handleListResources = useCallback(async (currentSessionId: string | null = sessionId) => {
    if (!currentSessionId || connectionStatus !== 'Connected') return;
    console.log("Listing resource templates...");
    
    // Mark this request as pending
    const requestId = Math.random().toString(36).substr(2, 9);
    pendingRequests.current[requestId] = { method: 'resources/templates/list' };
    
    // Using the MCP protocol method names
    const response = await sendJsonRpcRequest('resources/templates/list');
    console.log("Resource templates list response:", response);
    
    // If we got a direct JSON response (not via SSE)
    if (response && response.result && Array.isArray(response.result.resourceTemplates)) {
      console.log("Direct response with resource templates:", response.result.resourceTemplates);
      setResources(response.result.resourceTemplates);
      addLogEntry({ type: 'info', data: `Found ${response.result.resourceTemplates.length} resource templates.` });
      delete pendingRequests.current[requestId];
    } 
    // If the response indicates it will come via SSE, wait for the SSE event
    else if (response && response.result && response.result._note?.includes("SSE stream")) {
      console.log("Resource templates list will be delivered via SSE stream");
      // We'll wait for the SSE event handler to process the response
      
      // Set a timeout to clear the pending request if no response is received
      setTimeout(() => {
        if (pendingRequests.current[requestId]) {
          console.log("Timeout waiting for resource templates via SSE, clearing pending request");
          delete pendingRequests.current[requestId];
        }
      }, 5000); // 5 second timeout
    } 
    // Handle error case
    else if (response?.error) {
      console.error("Failed to list resource templates:", response.error);
      addLogEntry({ type: 'error', data: `Failed to list resource templates: ${response.error.message}` });
      setResources([]);
      delete pendingRequests.current[requestId];
    }
  }, [sessionId, connectionStatus, sendJsonRpcRequest, addLogEntry]);

  const handleExecuteTool = useCallback(async () => {
    if (!selectedTool || !sessionId || connectionStatus !== 'Connected') {
      addLogEntry({ type: 'warning', data: 'Cannot execute tool: Select a tool and ensure connection.' });
      return;
    }
    
    // Using the MCP protocol method names
    await sendJsonRpcRequest('tools/call', {
      name: selectedTool.name,
      arguments: toolParams
    });
  }, [selectedTool, toolParams, sessionId, connectionStatus, sendJsonRpcRequest, addLogEntry]);

  // Parameter Handling
  const handleParamChange = (paramName: string, value: any) => {
    setToolParams(prev => ({ ...prev, [paramName]: value }));
  };

  // Resource Argument Handling
  const handleResourceArgChange = (argName: string, value: any) => {
    setResourceArgs(prev => ({ ...prev, [argName]: value }));
  };

  // Tool Selection
  const handleSelectTool = (tool: any) => {
    setSelectedTool(tool);
    setSelectedResourceTemplate(null); // Deselect resource
    setResourceArgs({}); // Clear resource args
    const initialParams: Record<string, any> = {};
    if (tool.input_schema?.properties) {
      Object.entries(tool.input_schema.properties).forEach(([name, schema]) => {
        if ((schema as any)?.default !== undefined) {
          initialParams[name] = (schema as any).default;
        }
      });
    }
    setToolParams(initialParams);
    console.log("Selected tool:", tool);
    addLogEntry({ type: 'info', data: `Selected tool: ${tool.name}` });
  };

  // Resource Template Selection
  const handleSelectResourceTemplate = (template: any) => {
    setSelectedResourceTemplate(template);
    setSelectedTool(null); // Deselect tool
    setToolParams({}); // Clear tool params
    setResourceArgs({}); // Clear resource args for new selection
    console.log("Selected resource template:", template);
    addLogEntry({ type: 'info', data: `Selected resource template: ${template.uriTemplate}` });
  };

  return {
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
  };
};
