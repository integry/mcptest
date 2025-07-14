import { useState, useEffect, useRef, useCallback } from 'react';
import { LogEntry } from '../types';

export interface SSEConfig {
  url: string;
  sessionId?: string;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
}

export interface SSEConnection {
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  lastEventId: string | null;
  reconnectAttempts: number;
  connect: () => void;
  disconnect: () => void;
  sendMessage: (data: any, event?: string) => Promise<boolean>;
}

export const useSSE = (
  config: SSEConfig,
  addLogEntry: (entryData: Omit<LogEntry, 'timestamp'>) => void
): SSEConnection => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isRealUnmount = useRef(false);
  const strictModeRenderCount = useRef(0);

  // Strict mode detection
  useEffect(() => {
    strictModeRenderCount.current += 1;
    return () => { 
      if (strictModeRenderCount.current > 1) isRealUnmount.current = true; 
    };
  }, []);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      console.log('[SSE] Cleaning up EventSource connection');
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  const connect = useCallback(() => {
    if (isConnecting || (isConnected && eventSourceRef.current)) {
      console.log('[SSE] Connect called but already connecting or connected');
      return;
    }

    setIsConnecting(true);
    setConnectionError(null);

    try {
      const url = new URL(config.url, window.location.origin);
      
      // Add session ID as query parameter since EventSource doesn't support custom headers
      if (config.sessionId) {
        url.searchParams.set('session_id', config.sessionId);
      }
      
      // Add Last-Event-ID if we have one (for reconnection)
      if (lastEventId) {
        url.searchParams.set('last_event_id', lastEventId);
      }
      
      const eventSourceUrl = url.toString();
      
      console.log(`[SSE] Connecting to: ${eventSourceUrl}`);
      addLogEntry({ type: 'info', data: `Connecting to SSE stream: ${eventSourceUrl}` });

      const eventSource = new EventSource(eventSourceUrl);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('[SSE] Connection opened');
        setIsConnected(true);
        setIsConnecting(false);
        setConnectionError(null);
        setReconnectAttempts(0);
        addLogEntry({ 
          type: 'info', 
          data: 'SSE connection established successfully' 
        });
      };

      eventSource.onmessage = (event) => {
        console.log('[SSE] Received message:', event.data);
        setLastEventId(event.lastEventId);
        
        try {
          const data = JSON.parse(event.data);
          addLogEntry({
            type: 'sse_parsed',
            data,
            eventId: event.lastEventId,
            event: 'message'
          });
        } catch (e) {
          addLogEntry({
            type: 'sse_raw',
            data: event.data,
            eventId: event.lastEventId,
            event: 'message'
          });
        }
      };

      eventSource.onerror = (event) => {
        console.error('[SSE] Connection error:', event);
        
        if (eventSource.readyState === EventSource.CLOSED) {
          setIsConnected(false);
          setIsConnecting(false);
          setConnectionError('Connection closed by server');
          addLogEntry({ 
            type: 'error', 
            data: 'SSE connection closed by server' 
          });

          // Auto-reconnect if enabled
          if (config.autoReconnect && reconnectAttempts < (config.maxReconnectAttempts || 5)) {
            const delay = (config.reconnectDelay || 1000) * Math.pow(2, reconnectAttempts);
            console.log(`[SSE] Attempting reconnect in ${delay}ms (attempt ${reconnectAttempts + 1})`);
            
            setReconnectAttempts(prev => prev + 1);
            reconnectTimeoutRef.current = setTimeout(() => {
              if (!isRealUnmount.current) {
                connect();
              }
            }, delay);
          }
        } else {
          setConnectionError('Connection error occurred');
          addLogEntry({ 
            type: 'error', 
            data: 'SSE connection error occurred' 
          });
        }
      };

      // Listen for custom event types
      const eventTypes = ['tool_response', 'tool_error', 'tool_list', 'notification'];
      eventTypes.forEach(eventType => {
        eventSource.addEventListener(eventType, (event: any) => {
          console.log(`[SSE] Received ${eventType} event:`, event.data);
          setLastEventId(event.lastEventId);
          
          try {
            const data = JSON.parse(event.data);
            addLogEntry({
              type: 'sse_parsed',
              data,
              eventId: event.lastEventId,
              event: eventType
            });
          } catch (e) {
            addLogEntry({
              type: 'sse_raw',
              data: event.data,
              eventId: event.lastEventId,
              event: eventType
            });
          }
        });
      });

    } catch (error) {
      console.error('[SSE] Failed to create EventSource:', error);
      setIsConnecting(false);
      setConnectionError(`Failed to connect: ${error}`);
      addLogEntry({ 
        type: 'error', 
        data: `Failed to create SSE connection: ${error}` 
      });
    }
  }, [config, isConnecting, isConnected, reconnectAttempts, addLogEntry]);

  const disconnect = useCallback(() => {
    console.log('[SSE] Manually disconnecting');
    addLogEntry({ type: 'info', data: 'Disconnecting from SSE stream' });
    cleanup();
  }, [cleanup, addLogEntry]);

  const sendMessage = useCallback(async (data: any, event = 'message'): Promise<boolean> => {
    try {
      const response = await fetch('/sse/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: config.sessionId || '*',
          data,
          event
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log(`[SSE] Message sent to ${result.connectionsSent} connections`);
        return true;
      } else {
        console.error('[SSE] Failed to send message:', response.statusText);
        return false;
      }
    } catch (error) {
      console.error('[SSE] Error sending message:', error);
      return false;
    }
  }, [config.sessionId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isRealUnmount.current) {
        cleanup();
      }
    };
  }, [cleanup]);

  return {
    isConnected,
    isConnecting,
    connectionError,
    lastEventId,
    reconnectAttempts,
    connect,
    disconnect,
    sendMessage
  };
};