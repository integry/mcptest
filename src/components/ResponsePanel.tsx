import React, { useRef, useEffect } from 'react';
import showdown from 'showdown';

interface LogEntry {
  type: string;
  data: string;
  timestamp: string;
  eventId?: string | null;
  event?: string;
  id?: number | string;
  method?: string;
  params?: any;
}

interface ResponsePanelProps {
  responses: LogEntry[];
  autoScroll: boolean;
  setAutoScroll: (autoScroll: boolean) => void;
  handleClearResponse: () => void;
  isConnected: boolean; // Add isConnected prop
}

const ResponsePanel: React.FC<ResponsePanelProps> = ({
  responses,
  autoScroll,
  setAutoScroll,
  handleClearResponse,
  isConnected, // Destructure isConnected
}) => {
  const responseAreaRef = useRef<HTMLDivElement>(null);
  // Create converter instance and set flavor/options
  const converter = useRef<showdown.Converter>(new showdown.Converter());
  useEffect(() => {
    converter.current.setFlavor('github'); // Explicitly set GitHub flavor
    // Re-apply options just in case flavor doesn't cover all
    converter.current.setOption('ghCompatibleHeaderId', true);
    converter.current.setOption('simpleLineBreaks', true);
    converter.current.setOption('ghCodeBlocks', true);
    converter.current.setOption('tables', true);
    converter.current.setOption('strikethrough', true);
    converter.current.setOption('tasklists', true);
  }, []); // Run only once on mount


  // Auto-scroll effect
  useEffect(() => {
    if (autoScroll && responseAreaRef.current) {
      responseAreaRef.current.scrollTop = responseAreaRef.current.scrollHeight;
    }
  }, [responses, autoScroll]); // Depend on responses and autoScroll state

  // --- Render Helper for Responses/Logs ---
  const renderResponseItem = (item: LogEntry, index: number) => {
    let content = '';
    let className = 'event-entry';
    let title = item.type;

    try {
        // Handle legacy SSE types generically if they appear
        if (item.type === 'sse_parsed' || item.type === 'sse_raw' || item.type === 'sse_event') {
             content = `[Server Message${item.event ? ` (${item.event})`:''}${item.eventId ? ` #${item.eventId}`:''}] ${item.data}`;
             title = `Server Message ${item.event || ''} ${item.eventId || ''}`;
             if (item.type === 'sse_raw') className += ' text-muted'; // Keep raw messages muted
             if (item.type === 'sse_parsed') {
                 try {
                     const parsed = JSON.parse(item.data);
                     if (parsed?.error) className += ' error-message';
                 } catch { /* ignore */ }
             }
        } else if (item.type === 'request') {
            content = `[SENT #${item.id}] ${item.method}(${JSON.stringify(item.params || {})})`;
            title = `Request ${item.id}`;
            className += ' text-muted';
        } else if (item.type === 'response') {
            let responseData = item.data;
            try { responseData = JSON.parse(item.data); } catch { /* ignore */ }
            content = `[RECV #${(responseData as any)?.id}] ${item.data}`;
            if ((responseData as any)?.error) className += ' error-message';
            title = `Response ${(responseData as any)?.id}`;
            className += ' success-message';
        } else if (item.type.toLowerCase() === 'tool_result' || item.type.toLowerCase() === 'resource_result') {
            // Handle tool/resource results specifically for Showdown conversion
            // The 'content' variable will be unused; we'll construct the input for Showdown later.
            // className remains 'event-entry' as seen in the DOM.
            // title is already set from item.type at the beginning.
            ; // No specific action needed here, logic is handled below.
        }
        else {
             // Fallback for other/unknown types
             content = `[${item.type.toUpperCase()}] ${item.data}`; // Default content format
             if (item.type === 'error') className += ' error-message';
             else if (item.type === 'warning') className += ' warning-message';
             else if (item.type === 'info' || item.type.startsWith('notification')) className += ' info-message';
        }

    } catch (e) {
        content = "[Render Error]";
        className += ' error-message';
    }

    // Determine if Showdown should be used based on item.type
    const shouldRenderHtml = item.type.toLowerCase() === 'tool_result' || item.type.toLowerCase() === 'resource_result';
    let finalHtmlContent: string | null = null;

    if (shouldRenderHtml) {
        try {
            // Construct the full string: Prefix + NEWLINE + Original Data
            const markdownInput = `[${item.type.toUpperCase()}]\n${item.data}`; // Added \n here
            // Convert the constructed string using Showdown
            finalHtmlContent = converter.current.makeHtml(markdownInput);
             // --- DEBUG LOG ---
             console.log("Showdown Input:", markdownInput);
             console.log("Showdown Output HTML:", finalHtmlContent);
             // --- END DEBUG LOG ---
        } catch (e) {
            console.error("Error converting markdown to HTML:", e);
            // Fallback to raw data (with prefix) in a pre tag if conversion fails
            finalHtmlContent = `<pre>[${item.type.toUpperCase()}] ${item.data}</pre>`;
            className += ' error-message'; // Add error class to the entry div
        }
    }
    // If not rendering HTML, the 'content' variable holds the correct string.

    return (
      <div key={index} className={className} title={title}> {/* Use original title */}
        <span className="event-timestamp">{item.timestamp}</span>
        {shouldRenderHtml && finalHtmlContent !== null ? (
           // Render the Showdown-converted HTML directly
           <span className="event-data" dangerouslySetInnerHTML={{ __html: finalHtmlContent }} />
        ) : (
           // Default rendering for other types (uses the 'content' variable)
          <span className="event-data">{content}</span>
        )}
      </div>
    );
  };


  return (
      // Add conditional class for deactivated state
      <div className={`card mb-3 ${!isConnected ? 'panel-deactivated' : ''}`}>
        <div className="card-header d-flex justify-content-between">
          <h5>Logs & Events</h5>
          <div className="form-check form-switch">
          <input
            className="form-check-input"
            type="checkbox"
            id="autoScrollSwitch"
            checked={autoScroll}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAutoScroll(e.target.checked)}
          />
          <label className="form-check-label" htmlFor="autoScrollSwitch">Auto-scroll</label>
        </div>
      </div>
      <div className="card-body p-0">
        <div
          id="responseArea"
          ref={responseAreaRef}
          className="response-area p-2"
          style={{ height: 'calc(100vh - 250px)', overflowY: 'auto', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6', fontFamily: 'monospace', fontSize: '0.85rem' }}
        >
          {responses.length === 0 ? (
            <p className="text-muted p-2">Logs and events will appear here...</p>
          ) : (
            responses.map(renderResponseItem)
          )}
        </div>
      </div>
      <div className="card-footer">
        <button
          id="clearResponseBtn"
          className="btn btn-sm btn-outline-secondary"
          onClick={handleClearResponse}
          disabled={responses.length === 0}
        >
          Clear Logs
        </button>
      </div>
    </div>
  );
};

export default ResponsePanel;