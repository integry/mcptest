import { useCallback } from 'react';
import { LogEntry, ResourceTemplate } from '../types';
import { parseUriTemplateArgs } from '../utils/uriUtils';
import { Client } from '@modelcontextprotocol/sdk/client/index.js'; // Import Client type
import { formatErrorForDisplay } from '../utils/errorHandling';

export const useResourceAccess = (
  client: Client | null,
  addLogEntry: (entryData: Omit<LogEntry, 'timestamp'>) => void,
  serverUrl: string // Add serverUrl prop
) => {
  // Access Resource using MCP protocol via SDK Client
  const handleAccessResource = useCallback(async ( // Make async
    selectedResourceTemplate: ResourceTemplate | null,
    resourceArgs: Record<string, any>
  ): Promise<LogEntry | null> => {
    // Check for client and template
    if (!client || !selectedResourceTemplate) {
       const warningLog: LogEntry = { type: 'warning', data: 'Cannot access resource: Client not connected or no resource selected.', timestamp: new Date().toLocaleTimeString() };
       addLogEntry(warningLog);
       return warningLog;
    }

    let finalUri = selectedResourceTemplate.uriTemplate;
    const templateArgs = parseUriTemplateArgs(finalUri);
    let queryParamsStarted = false;

    templateArgs.forEach(arg => {
      const value = resourceArgs[arg];
      if (value !== undefined && value !== null && value !== '') {
        const pathRegex = new RegExp(`\\{${arg}\\}`, 'g');
        if (finalUri.match(pathRegex)) {
          finalUri = finalUri.replace(pathRegex, encodeURIComponent(String(value)));
        } else {
          finalUri += (queryParamsStarted ? '&' : '?') + `${encodeURIComponent(arg)}=${encodeURIComponent(String(value))}`;
          queryParamsStarted = true;
        }
      } else {
        // Remove optional template parts if arg is missing
        finalUri = finalUri.replace(new RegExp(`{&${arg}}`, 'g'), '');
        finalUri = finalUri.replace(new RegExp(`{\\?${arg},?`, 'g'), '?');
        finalUri = finalUri.replace(new RegExp(`,${arg}`, 'g'), '');
      }
    });

    // Clean up remaining template placeholders and trailing characters
    finalUri = finalUri.replace(/\{\??[^}]+\}/g, '');
    finalUri = finalUri.replace(/\?&/, '?').replace(/(\?|&)$/, '');

    console.log("[DEBUG] Accessing resource:", finalUri);
    addLogEntry({ type: 'info', data: `Accessing resource: ${finalUri}` });

    // Using the SDK client method for resource access
    try {
      addLogEntry({
        type: 'request', // Log the intent
        method: 'resources/read', // SDK uses 'read'
        params: { uri: finalUri },
        data: `client.readResource({ uri: "${finalUri}" })`
      });

      const resourceResult = await client.readResource({ uri: finalUri });
      console.log("[DEBUG] SDK Client: Resource result:", resourceResult);

      // Log the received resource content
      const resultLogEntry: LogEntry = {
        type: 'resource_result',
        data: resourceResult?.contents, // Log the actual content array (McpResponseDisplay will stringify)
        timestamp: new Date().toLocaleTimeString(),
        callContext: {
          serverUrl: serverUrl,
          type: 'resource',
          name: finalUri,
          params: resourceArgs // Pass the original args used
        }
      };
      addLogEntry(resultLogEntry);
      return resultLogEntry;

    } catch (error: any) {
       console.error("[DEBUG] Error accessing resource via SDK:", error);
       const errorDetails = formatErrorForDisplay(error, {
         serverUrl,
         operation: `access resource ${finalUri}`
       });
       const errorLogEntry: LogEntry = { type: 'error', data: `Failed to access resource ${finalUri}: ${errorDetails}`, timestamp: new Date().toLocaleTimeString() };
       addLogEntry(errorLogEntry);
       return errorLogEntry;
    }
    return null;

  }, [client, addLogEntry, serverUrl]); // Update dependencies

  return {
    handleAccessResource
  };
};
