import { useState, useCallback } from 'react';
import { LogEntry } from '../types';

export const useLogEntries = () => {
  const [responses, setResponses] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);

  // Add response/log entry to state
  const addLogEntry = useCallback((entryData: Omit<LogEntry, 'timestamp'>) => {
    let displayData = entryData.data;
    if (typeof displayData === 'object' && displayData !== null) {
      try { 
        displayData = JSON.stringify(displayData); 
      } catch (e) { 
        displayData = "[Unserializable Object]"; 
      }
    }
    setResponses(prev => [...prev.slice(-200), { 
      ...entryData, 
      data: displayData, 
      timestamp: new Date().toLocaleTimeString() 
    }]);
  }, []);

  // Clear responses
  const handleClearResponse = useCallback(() => {
    setResponses([]);
  }, []);

  return {
    responses,
    setResponses,
    autoScroll,
    setAutoScroll,
    addLogEntry,
    handleClearResponse
  };
};
