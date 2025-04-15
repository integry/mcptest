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
  // Stores pending requests keyed by their JSON-RPC ID
  const pendingRequests = useRef<Record<string, { method: string, internalId?: string }>>({});
  // Stores internal IDs keyed by JSON-RPC ID for timeout clearing
  const timeoutMap = useRef<Record<string, number>>({}); // setTimeout returns a number in browsers

  // Listen for SSE events
  useEffect(() => {
    // Type the event directly as CustomEvent
    const handleSseEvent = (event: CustomEvent) => {
      console.log("useToolsAndResources received SSE event (raw detail):", event.detail);
      
      if (!event.detail || !event.detail.id) {
        console.log("SSE event ignored: Missing detail or id field.");
        return;
      }
      
      const jsonRpcId = event.detail.id.toString();
      console.log(`Processing SSE event with JSON-RPC ID: ${jsonRpcId}`);
      
      // Check if this is a response to a pending request
      // Check if this ID corresponds to a pending request
      if (pendingRequests.current[jsonRpcId]) {
        const requestInfo = pendingRequests.current[jsonRpcId];
        console.log(`Found pending request for JSON-RPC ID ${jsonRpcId}:`, requestInfo);
        
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
          // Clear the pending request and its timeout
          clearTimeout(timeoutMap.current[jsonRpcId]);
          delete timeoutMap.current[jsonRpcId];
          delete pendingRequests.current[jsonRpcId];
        } else if (requestInfo.method === 'tools/list') {
          if (event.detail.result && Array.isArray(event.detail.result.tools)) {
            console.log("Setting tools from SSE event:", event.detail.result.tools);
            setTools(event.detail.result.tools);
            addLogEntry({ 
              type: 'info', 
              data: `Received ${event.detail.result.tools.length} tools via SSE.`
            });
          }
          // Clear the pending request and its timeout
          clearTimeout(timeoutMap.current[jsonRpcId]);
          delete timeoutMap.current[jsonRpcId];
          delete pendingRequests.current[jsonRpcId];
        }
      } 
      // Special case for resource templates that might not have the same ID
      // Fallback: Check if it's a resource template list even if ID doesn't match a pending request
      // This might happen if the server sends updates proactively
      // Fallback: Check specifically for resourceTemplates array in the result, even if ID doesn't match
      else if (event.detail?.result && Array.isArray(event.detail.result.resourceTemplates)) {
        const templates = event.detail.result.resourceTemplates;
        console.log(`Fallback triggered: Found resourceTemplates array in SSE event (ID: ${event.detail?.id ?? 'none'}). Setting resources.`);
        console.log("Templates data:", templates);
        setResources(templates);
        addLogEntry({
          type: 'info',
          data: `Received ${templates.length} resource templates via SSE (ID mismatch or missing).`
        });
        
        // Attempt to clear ANY pending resource template request, as we received the data
        Object.keys(pendingRequests.current).forEach(reqId => {
          if (pendingRequests.current[reqId].method === 'resources/templates/list') {
            console.log(`Fallback clearing pending request ID ${reqId} for resources/templates/list.`);
            clearTimeout(timeoutMap.current[reqId]);
            delete timeoutMap.current[reqId];
            delete pendingRequests.current[reqId];
          }
        });
      }
      // Special case for tools that might not have the same ID
      // Fallback: Check if it's a tools list even if ID doesn't match
      // Fallback: Check specifically for tools array in the result, even if ID doesn't match
      else if (event.detail?.result && Array.isArray(event.detail.result.tools)) {
        const toolsList = event.detail.result.tools;
         console.log(`Fallback triggered: Found tools array in SSE event (ID: ${event.detail?.id ?? 'none'}). Setting tools.`);
        console.log("Tools data:", toolsList);
        setTools(toolsList);
        addLogEntry({
          type: 'info',
          data: `Received ${toolsList.length} tools via SSE (ID mismatch or missing).`
        });

        // Attempt to clear ANY pending tools list request
        Object.keys(pendingRequests.current).forEach(reqId => {
          if (pendingRequests.current[reqId].method === 'tools/list') {
             console.log(`Fallback clearing pending request ID ${reqId} for tools/list.`);
            clearTimeout(timeoutMap.current[reqId]);
            delete timeoutMap.current[reqId];
            delete pendingRequests.current[reqId];
          }
        });
      } else {
        console.log(`SSE event with ID ${jsonRpcId} did not match any known pending request or fallback structure.`);
      }
    };

    console.log("Added mcp-sse-event listener in useToolsAndResources");
    window.addEventListener('mcp-sse-event', handleSseEvent as EventListener);
    
    return () => {
      console.log("Removed mcp-sse-event listener in useToolsAndResources");
      window.removeEventListener('mcp-sse-event', handleSseEvent as EventListener);
    };
  }, [addLogEntry, setResources, setTools]); // End of useEffect

  const handleListTools = useCallback(async (currentSessionId: string | null = sessionId) => {
    if (!currentSessionId || connectionStatus !== 'Connected') return;
    console.log("Listing tools...");
    
    // Using the MCP protocol method names
    const response = await sendJsonRpcRequest('tools/list');
    
    if (!response) {
      console.error("No response received for tools/list request.");
      addLogEntry({ type: 'error', data: 'No response received for tools/list request.' });
      return;
    }
    
    const jsonRpcId = response.id?.toString();
    if (!jsonRpcId) {
      console.error("Response for tools/list missing JSON-RPC ID.");
      // Proceed cautiously, might be a direct response without ID?
    }
    
    
    // If we got a direct JSON response (not via SSE)
    if (response && response.result && Array.isArray(response.result.tools)) {
      setTools(response.result.tools);
      addLogEntry({ type: 'info', data: `Found ${response.result.tools.length} tools.` });
      // No need to track pending if response is immediate
    } 
    // If the response indicates it will come via SSE, wait for the SSE event
    else if (response && response.result && response.result._note?.includes("SSE stream")) {
      console.log("Tools list will be delivered via SSE stream");
      // Mark this request as pending using its JSON-RPC ID
      if (jsonRpcId) {
        pendingRequests.current[jsonRpcId] = { method: 'tools/list' };
        console.log(`tools/list request with ID ${jsonRpcId} is pending SSE response.`);
        // Set a timeout (optional, maybe rely on server or connection closure)
        // timeoutMap.current[jsonRpcId] = setTimeout(...);
      } else {
         console.warn("Cannot track pending tools/list request without JSON-RPC ID.");
      }
    } 
    // Handle error case
    else if (response?.error) {
      console.error("Failed to list tools:", response.error);
      addLogEntry({ type: 'error', data: `Failed to list tools: ${response.error.message}` });
      setTools([]);
      // Clear pending state if it was somehow set without an ID
      if (jsonRpcId) delete pendingRequests.current[jsonRpcId];
    }
  }, [sessionId, connectionStatus, sendJsonRpcRequest, addLogEntry]);

  const handleListResources = useCallback(async (currentSessionId: string | null = sessionId) => {
    if (!currentSessionId || connectionStatus !== 'Connected') return;
    console.log("Listing resource templates...");
    // Using the MCP protocol method names
    const response = await sendJsonRpcRequest('resources/templates/list');
    console.log("Resource templates list initial response:", response);
    
    if (!response) {
      console.error("No response received for resources/templates/list request.");
      addLogEntry({ type: 'error', data: 'No response received for resources/templates/list request.' });
      return;
    }
    
    const jsonRpcId = response.id?.toString();
    if (!jsonRpcId) {
      console.error("Response for resources/templates/list missing JSON-RPC ID.");
      // Proceed cautiously, might be a direct response without ID?
    }
    
    
    // If we got a direct JSON response (not via SSE)
    if (response && response.result && Array.isArray(response.result.resourceTemplates)) {
      console.log("Direct response with resource templates:", response.result.resourceTemplates);
      setResources(response.result.resourceTemplates);
      addLogEntry({ type: 'info', data: `Found ${response.result.resourceTemplates.length} resource templates.` });
      // No need to track pending if response is immediate
    } 
    // If the response indicates it will come via SSE, wait for the SSE event
    else if (response && response.result && response.result._note?.includes("SSE stream")) {
      console.log("Resource templates list will be delivered via SSE stream");
      // Mark this request as pending using its JSON-RPC ID
      if (jsonRpcId) {
        pendingRequests.current[jsonRpcId] = { method: 'resources/templates/list' };
        console.log(`resources/templates/list request with ID ${jsonRpcId} is pending SSE response.`);
        
        // Set a timeout to clear the pending request if no response is received via SSE
        timeoutMap.current[jsonRpcId] = setTimeout(() => {
          if (pendingRequests.current[jsonRpcId]) {
            console.log(`Timeout waiting for SSE response for request ID ${jsonRpcId}, clearing pending request.`);
            addLogEntry({ type: 'warning', data: `Timeout waiting for resource templates (Req ID: ${jsonRpcId}).` });
            delete pendingRequests.current[jsonRpcId];
          }
        }, 5000); // 5 second timeout
      } else {
        console.warn("Cannot track pending resources/templates/list request without JSON-RPC ID.");
      }
    } 
    // Handle error case
    else if (response?.error) {
      console.error("Failed to list resource templates:", response.error);
      addLogEntry({ type: 'error', data: `Failed to list resource templates: ${response.error.message}` });
      setResources([]);
      // Clear pending state and timeout if it exists
      if (jsonRpcId) {
        clearTimeout(timeoutMap.current[jsonRpcId]);
        delete timeoutMap.current[jsonRpcId];
        delete pendingRequests.current[jsonRpcId];
      }
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
