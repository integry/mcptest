/**
 * Enhanced error handling utilities for better debugging
 */

export interface EnhancedErrorDetails {
  message: string;
  type: 'network' | 'cors' | 'auth' | 'server' | 'generic';
  details?: string;
  suggestions?: string[];
}

export const parseError = (error: any, context?: { serverUrl?: string, operation?: string }): EnhancedErrorDetails => {
  const serverUrl = context?.serverUrl;
  const operation = context?.operation || 'operation';
  
  // Just return the actual error message without embellishment
  return {
    type: 'generic',
    message: error.message || error.toString(),
    details: serverUrl ? `Server: ${serverUrl}` : undefined,
    suggestions: []
  };
};


export const formatErrorForDisplay = (error: any, context?: { serverUrl?: string, operation?: string }): string => {
  const parsed = parseError(error, context);
  
  let formatted = parsed.message;
  
  if (parsed.details) {
    formatted += `\n\n${parsed.details}`;
  }
  
  return formatted;
};