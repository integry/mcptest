import { useState, useCallback, useEffect, useRef } from 'react';
import { LogEntry, Resource, ResourceTemplate, SelectedTool, Prompt, SelectedPrompt } from '../types'; // Added Resource
import { Client } from '@modelcontextprotocol/sdk/client/index.js'; // Import SDK Client type
import { ListPromptsResultSchema, GetPromptResultSchema } from '@modelcontextprotocol/sdk/types.js'; // Corrected schema import
import { formatErrorForDisplay } from '../utils/errorHandling';

export const useToolsAndResources = (
  client: Client | null,
  addLogEntry: (entryData: Omit<LogEntry, 'timestamp'>) => void,
  connectionStatus: string,
  serverUrl: string // Add serverUrl prop
) => {
  const [tools, setTools] = useState<any[]>([]);
  const [resources, setResources] = useState<Resource[]>([]); // Actual resource instances
  const [resourceTemplates, setResourceTemplates] = useState<ResourceTemplate[]>([]); // Resource templates
  const [prompts, setPrompts] = useState<Prompt[]>([]); // State for prompts
  const [selectedTool, setSelectedTool] = useState<SelectedTool | null>(null);
  const [selectedResourceTemplate, setSelectedResourceTemplate] = useState<ResourceTemplate | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<SelectedPrompt | null>(null); // State for selected prompt
  const [toolParams, setToolParams] = useState<Record<string, any>>({});
  const [resourceArgs, setResourceArgs] = useState<Record<string, any>>({});
  const [promptParams, setPromptParams] = useState<Record<string, any>>({}); // State for prompt params


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
      // Extract the array from the result object
      const toolsArray = toolsList?.tools || [];
      setTools(toolsArray);
      addLogEntry({ type: 'info', data: `Fetched ${toolsArray.length} tools.` });
    } catch (error: any) {
      console.error("[DEBUG] Error listing tools via SDK:", error);
      const errorDetails = formatErrorForDisplay(error, {
        serverUrl,
        operation: 'list tools'
      });
      addLogEntry({ type: 'error', data: `Failed to list tools: ${errorDetails}` });
      setTools([]); // Clear tools on error
    }
  }, [client, connectionStatus, addLogEntry, setTools]); // Use client


  // List resource templates using SDK Client
  const handleListResourceTemplates = useCallback(async () => {
     if (!client || connectionStatus !== 'Connected') {
       addLogEntry({ type: 'warning', data: 'Cannot list resource templates: Not connected.' });
       return;
     }
    console.log("[DEBUG] Listing resource templates via SDK client...");
    addLogEntry({ type: 'info', data: 'Listing resource templates...' });
    try {
      const resourcesList = await client.listResourceTemplates();
      console.log("[DEBUG] SDK Client: Fetched resource templates:", resourcesList);
      // Extract the array from the result object
      const templatesArray = resourcesList?.resourceTemplates || [];
      setResourceTemplates(templatesArray);
      addLogEntry({ type: 'info', data: `Fetched ${templatesArray.length} resource templates.` });
    } catch (error: any) {
      console.error("[DEBUG] Error listing resource templates via SDK:", error);
      const errorDetails = formatErrorForDisplay(error, {
        serverUrl,
        operation: 'list resource templates'
      });
      addLogEntry({ type: 'error', data: `Failed to list resource templates: ${errorDetails}` });
      setResourceTemplates([]); // Clear resource templates on error
    }
  }, [client, connectionStatus, addLogEntry, setResourceTemplates]); // Use client

  // List actual resources using SDK Client
  const handleListResources = useCallback(async () => {
     if (!client || connectionStatus !== 'Connected') {
       addLogEntry({ type: 'warning', data: 'Cannot list resources: Not connected.' });
       return;
     }
    console.log("[DEBUG] Listing resources via SDK client...");
    addLogEntry({ type: 'info', data: 'Listing resources...' });
    try {
      const resourcesList = await client.listResources();
      console.log("[DEBUG] SDK Client: Fetched resources:", resourcesList);
      // Extract the array from the result object
      const resourcesArray = resourcesList?.resources || [];
      setResources(resourcesArray);
      addLogEntry({ type: 'info', data: `Fetched ${resourcesArray.length} resources.` });
    } catch (error: any) {
      console.error("[DEBUG] Error listing resources via SDK:", error);
      const errorDetails = formatErrorForDisplay(error, {
        serverUrl,
        operation: 'list resources'
      });
      addLogEntry({ type: 'error', data: `Failed to list resources: ${errorDetails}` });
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

      // Process and log the content array from the tool result
      if (result?.content && Array.isArray(result.content)) {
        addLogEntry({ type: 'info', data: `--- Tool "${selectedTool.name}" Result ---` });
        result.content.forEach((contentItem: any, index: number) => {
          let contentText = '';
          if (contentItem?.type === 'text' && contentItem.text) {
            contentText = contentItem.text;
          } else if (contentItem?.type === 'resource' && contentItem.resource) {
             contentText = `Resource: ${contentItem.resource.uri || 'No URI'}`;
             // Optionally include resource text if needed/available and short enough
             // if (contentItem.resource.text) {
             //   contentText += `\n${contentItem.resource.text.substring(0, 100)}...`;
             // }
          } else {
            contentText = JSON.stringify(contentItem); // Fallback for other content types
          }
          // Use a specific type or reuse 'tool_result'/'info'
          // Add callContext here
          addLogEntry({
            type: 'tool_result',
            data: contentText,
            callContext: {
              serverUrl: serverUrl, // Use the passed serverUrl
              type: 'tool',
              name: selectedTool.name,
              params: toolParams
            }
          });
        });
         addLogEntry({ type: 'info', data: `--- End Tool "${selectedTool.name}" ---` });
      } else {
         // Log the raw result if content array is not found or result is null/undefined
         const resultText = JSON.stringify(result);
         addLogEntry({ type: 'warning', data: `Tool ${selectedTool.name} result (unexpected format): ${resultText}` });
      }

    } catch (error: any) {
      console.error(`[DEBUG] Error executing tool "${selectedTool.name}" via SDK:`, error);
      const errorDetails = formatErrorForDisplay(error, {
        serverUrl,
        operation: `execute tool ${selectedTool.name}`
      });
      addLogEntry({ type: 'error', data: `Failed to execute tool ${selectedTool.name}: ${errorDetails}` });
    }
  }, [client, selectedTool, toolParams, connectionStatus, addLogEntry, serverUrl]); // Add serverUrl dependency


  // --- Prompt Handling ---

  // List Prompts using SDK Client
  const handleListPrompts = useCallback(async () => {
    if (!client || connectionStatus !== 'Connected') {
      addLogEntry({ type: 'warning', data: 'Cannot list prompts: Not connected.' });
      return;
    }
    console.log("[DEBUG] Listing prompts via SDK client...");
    addLogEntry({ type: 'info', data: 'Listing prompts...' });
    try {
      // Use the specific schema for validation if needed, or cast
      const promptsResult = await client.listPrompts();
      console.log("[DEBUG] SDK Client: Fetched prompts:", promptsResult);
      const promptsArray = promptsResult?.prompts || [];
      setPrompts(promptsArray);
      addLogEntry({ type: 'info', data: `Fetched ${promptsArray.length} prompts.` });
    } catch (error: any) {
      console.error("[DEBUG] Error listing prompts via SDK:", error);
      const errorDetails = formatErrorForDisplay(error, {
        serverUrl,
        operation: 'list prompts'
      });
      addLogEntry({ type: 'error', data: `Failed to list prompts: ${errorDetails}` });
      setPrompts([]); // Clear prompts on error
    }
  }, [client, connectionStatus, addLogEntry, setPrompts]);

  // Execute Prompt using SDK Client
  const handleExecutePrompt = useCallback(async () => {
    if (!client || !selectedPrompt || connectionStatus !== 'Connected') {
      addLogEntry({ type: 'warning', data: 'Cannot execute prompt: Client not connected or no prompt selected.' });
      return;
    }

    console.log(`[DEBUG] Executing prompt "${selectedPrompt.name}" via SDK client with params:`, promptParams);
    addLogEntry({ type: 'info', data: `Executing prompt: ${selectedPrompt.name}...` });

    try {
      // Corrected method call to client.getPrompt
      const result = await client.getPrompt({
        name: selectedPrompt.name,
        arguments: promptParams,
      });
      console.log(`[DEBUG] SDK Client: Prompt "${selectedPrompt.name}" execution result:`, result);

      // Process and log the messages array from the prompt result according to MCP spec
      if (result?.messages && Array.isArray(result.messages)) {
        addLogEntry({ type: 'info', data: `--- Prompt "${selectedPrompt.name}" Messages ---` });
        result.messages.forEach((message: any, index: number) => {
          const role = message.role || 'unknown';
          let contentText = `[${role}] `;
          if (message.content?.type === 'text' && message.content.text) {
            contentText += message.content.text;
          } else if (message.content?.type === 'resource' && message.content.resource) {
             contentText += `Resource: ${message.content.resource.uri || 'No URI'}`;
             // Optionally include resource text if needed/available and short enough
             // if (message.content.resource.text) {
             //   contentText += `\n${message.content.resource.text.substring(0, 100)}...`;
             // }
          } else {
            contentText += JSON.stringify(message.content); // Fallback for other content types
          }
          // Use a specific type or reuse 'tool_result'/'info'
          addLogEntry({ type: 'prompt_message', data: contentText });
        });
         addLogEntry({ type: 'info', data: `--- End Prompt "${selectedPrompt.name}" ---` });
      } else {
         // Log the raw result if messages array is not found
         const resultText = JSON.stringify(result);
         addLogEntry({ type: 'warning', data: `Prompt ${selectedPrompt.name} result (unexpected format): ${resultText}` });
      }

    } catch (error: any) {
      console.error(`[DEBUG] Error executing prompt "${selectedPrompt.name}" via SDK:`, error);
      const errorDetails = formatErrorForDisplay(error, {
        serverUrl,
        operation: `execute prompt ${selectedPrompt.name}`
      });
      addLogEntry({ type: 'error', data: `Failed to execute prompt ${selectedPrompt.name}: ${errorDetails}` });
    }
  }, [client, selectedPrompt, promptParams, connectionStatus, addLogEntry]);


  // --- Parameter/Argument Handling ---

  // Combined handler for Tool and Prompt parameters
  const handleParamChange = (paramName: string, value: any, type: 'tool' | 'prompt') => {
    if (type === 'tool') {
        setToolParams(prev => ({ ...prev, [paramName]: value }));
    } else if (type === 'prompt') {
        setPromptParams(prev => ({ ...prev, [paramName]: value }));
    }
  };

  // Resource Argument Handling (no changes needed)
  const handleResourceArgChange = (argName: string, value: any) => {
    setResourceArgs(prev => ({ ...prev, [argName]: value }));
  };

  // Tool Selection (no changes needed)
  const handleSelectTool = (tool: any) => {
    setSelectedTool(tool);
    setSelectedResourceTemplate(null); // Deselect resource
    setSelectedPrompt(null); // Deselect prompt
    setResourceArgs({}); // Clear resource args
    setPromptParams({}); // Clear prompt params
    const initialParams: Record<string, any> = {};
    if (tool.inputSchema?.properties) { // Corrected schema key
      Object.entries(tool.inputSchema.properties).forEach(([name, schema]) => {
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
    setSelectedPrompt(null); // Deselect prompt
    setToolParams({}); // Clear tool params
    setPromptParams({}); // Clear prompt params
    setResourceArgs({}); // Clear resource args for new selection
    console.log("Selected resource template:", template);
    addLogEntry({ type: 'info', data: `Selected resource template: ${template.uriTemplate}` });
  };

  // Prompt Selection
  const handleSelectPrompt = (prompt: Prompt) => {
    setSelectedPrompt(prompt);
    setSelectedTool(null); // Deselect tool
    setSelectedResourceTemplate(null); // Deselect resource
    setToolParams({}); // Clear tool params
    setResourceArgs({}); // Clear resource args
    const initialParams: Record<string, any> = {};
    // Assuming prompt schema structure is similar to tool schema
    if (prompt.inputSchema?.properties) {
      Object.entries(prompt.inputSchema.properties).forEach(([name, schema]) => {
        if ((schema as any)?.default !== undefined) {
          initialParams[name] = (schema as any).default;
        }
      });
    }
    setPromptParams(initialParams);
    console.log("Selected prompt:", prompt);
    addLogEntry({ type: 'info', data: `Selected prompt: ${prompt.name}` });
  };

  return {
    tools,
    setTools, // Keep existing tool state/handlers
    resources, // Actual resource instances
    setResources,
    resourceTemplates, // Resource templates
    setResourceTemplates,
    prompts, // Add prompt state
    setPrompts,
    selectedTool,
    setSelectedTool,
    selectedResourceTemplate,
    setSelectedResourceTemplate,
    selectedPrompt, // Add selected prompt state
    setSelectedPrompt,
    toolParams,
    setToolParams,
    resourceArgs,
    setResourceArgs,
    promptParams, // Add prompt params state
    setPromptParams,
    handleListTools,
    handleListResources, // Lists actual resources
    handleListResourceTemplates, // Lists resource templates
    handleListPrompts, // Add list prompts handler
    handleExecuteTool,
    handleExecutePrompt, // Add execute prompt handler
    handleParamChange, // Updated handler
    handleResourceArgChange,
    handleSelectTool, // Updated handler
    handleSelectResourceTemplate, // Updated handler
    handleSelectPrompt // Add select prompt handler
  };
};
