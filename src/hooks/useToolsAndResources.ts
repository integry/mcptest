import { useState, useCallback, useEffect, useRef } from 'react';
import { LogEntry, ResourceTemplate, SelectedTool } from '../types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js'; // Import SDK Client type

export const useToolsAndResources = (
  client: Client | null, // Use the SDK client instance
  addLogEntry: (entryData: Omit<LogEntry, 'timestamp'>) => void,
  connectionStatus: string
  // sessionId no longer needed
  // sendJsonRpcRequest no longer needed
) => {
  const [tools, setTools] = useState<any[]>([]);
  const [resources, setResources] = useState<ResourceTemplate[]>([]); // Holds resource templates
  const [selectedTool, setSelectedTool] = useState<SelectedTool | null>(null);
  const [selectedResourceTemplate, setSelectedResourceTemplate] = useState<ResourceTemplate | null>(null);
  const [toolParams, setToolParams] = useState<Record<string, any>>({});
  const [resourceArgs, setResourceArgs] = useState<Record<string, any>>({});
  // Remove refs and useEffect related to manual SSE handling


  // Refactored handleListTools using SDK Client
  const handleListTools = useCallback(async () => {
    if (!client || connectionStatus !== 'Connected') {
       addLogEntry({ type: 'warning', data: 'Cannot list tools: Not connected.' });
       return;
    }
    console.log("[DEBUG] Listing tools via SDK client...");
    addLogEntry({ type: 'info', data: 'Listing tools...' });
    try {
      const toolsList = await client.listTools();
      console.log("[DEBUG] SDK Client: Fetched tools:", toolsList);
      setTools(toolsList as any); // Cast for now
      addLogEntry({ type: 'info', data: `Fetched ${toolsList?.length ?? 0} tools.` });
    } catch (error: any) {
      console.error("[DEBUG] Error listing tools via SDK:", error);
      addLogEntry({ type: 'error', data: `Failed to list tools: ${error.message}` });
      setTools([]); // Clear tools on error
    }
  }, [client, connectionStatus, addLogEntry, setTools]); // Use client


  // Refactored handleListResources using SDK Client
  const handleListResources = useCallback(async () => {
     if (!client || connectionStatus !== 'Connected') {
       addLogEntry({ type: 'warning', data: 'Cannot list resources: Not connected.' });
       return;
     }
    console.log("[DEBUG] Listing resource templates via SDK client...");
    addLogEntry({ type: 'info', data: 'Listing resource templates...' });
    try {
      const resourcesList = await client.listResourceTemplates();
      console.log("[DEBUG] SDK Client: Fetched resource templates:", resourcesList);
      // Extract the array from the result object
      const templatesArray = resourcesList?.resourceTemplates || [];
      setResources(templatesArray);
      addLogEntry({ type: 'info', data: `Fetched ${templatesArray.length} resource templates.` });
    } catch (error: any) {
      console.error("[DEBUG] Error listing resource templates via SDK:", error);
      addLogEntry({ type: 'error', data: `Failed to list resource templates: ${error.message}` });
      setResources([]); // Clear resources on error
    }
  }, [client, connectionStatus, addLogEntry, setResources]); // Use client


  // Refactored handleExecuteTool using SDK Client
  const handleExecuteTool = useCallback(async () => {
    if (!client || !selectedTool || connectionStatus !== 'Connected') {
      addLogEntry({ type: 'warning', data: 'Cannot execute tool: Client not connected or no tool selected.' });
      return;
    }

    console.log(`[DEBUG] Executing tool "${selectedTool.name}" via SDK client with params:`, toolParams);
    addLogEntry({ type: 'info', data: `Executing tool: ${selectedTool.name}...` });

    try {
      const result = await client.callTool({
        name: selectedTool.name,
        arguments: toolParams,
      });
      console.log(`[DEBUG] SDK Client: Tool "${selectedTool.name}" execution result:`, result);
      // Log the result content (assuming it's simple text for now)
      const resultText = result?.content?.[0]?.type === 'text' ? result.content[0].text : JSON.stringify(result);
      addLogEntry({ type: 'tool_result', data: `Tool ${selectedTool.name} result: ${resultText}` });
      // TODO: Potentially display the result more formally in the UI
    } catch (error: any) {
      console.error(`[DEBUG] Error executing tool "${selectedTool.name}" via SDK:`, error);
      addLogEntry({ type: 'error', data: `Failed to execute tool ${selectedTool.name}: ${error.message}` });
    }
  }, [client, selectedTool, toolParams, connectionStatus, addLogEntry]); // Use client


  // Parameter Handling (no changes needed)
  const handleParamChange = (paramName: string, value: any) => {
    setToolParams(prev => ({ ...prev, [paramName]: value }));
  };

  // Resource Argument Handling (no changes needed)
  const handleResourceArgChange = (argName: string, value: any) => {
    setResourceArgs(prev => ({ ...prev, [argName]: value }));
  };

  // Tool Selection (no changes needed)
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

  // Resource Template Selection (no changes needed)
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
