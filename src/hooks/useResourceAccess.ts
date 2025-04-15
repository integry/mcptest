import { useCallback } from 'react';
import { LogEntry, ResourceTemplate } from '../types';
import { parseUriTemplateArgs } from '../utils/uriUtils';

export const useResourceAccess = (
  addLogEntry: (entryData: Omit<LogEntry, 'timestamp'>) => void,
  sessionId: string | null
) => {
  // Access Resource using MCP protocol
  const handleAccessResource = useCallback((
    selectedResourceTemplate: ResourceTemplate | null,
    resourceArgs: Record<string, any>
  ) => {
    if (!selectedResourceTemplate || !sessionId) return;
    
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
        finalUri = finalUri.replace(new RegExp(`{&${arg}}`, 'g'), '');
        finalUri = finalUri.replace(new RegExp(`{\\?${arg},?`, 'g'), '?');
        finalUri = finalUri.replace(new RegExp(`,${arg}`, 'g'), '');
      }
    });
    
    finalUri = finalUri.replace(/\{\??[^}]+\}/g, '');
    finalUri = finalUri.replace(/\?&/, '?').replace(/(\?|&)$/, '');

    addLogEntry({ type: 'info', data: `Accessing resource: ${finalUri}` });
    console.log("Accessing resource:", finalUri);
    
    // Using the MCP protocol method for resource access
    addLogEntry({ 
      type: 'request', 
      method: 'resources/get', 
      params: { uri: finalUri }, 
      data: `resources/get({"uri":"${finalUri}"})` 
    });
  }, [sessionId, addLogEntry]);

  return {
    handleAccessResource
  };
};
