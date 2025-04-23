import React, { useRef, useEffect, memo } from 'react';
import showdown from 'showdown';
import { LogEntry } from '../types'; // Import the full LogEntry type

interface McpResponseDisplayProps {
  logEntry: Partial<LogEntry>; // Accept partial LogEntry, as cards won't have all fields
  className?: string; // Optional additional class names
  showTimestamp?: boolean; // Add flag to control timestamp visibility
}

const McpResponseDisplay: React.FC<McpResponseDisplayProps> = memo(({
  logEntry,
  className = '',
  showTimestamp = true, // Default to showing timestamp
}) => {
  const converter = useRef<showdown.Converter | null>(null);

  useEffect(() => {
    if (!converter.current) {
      converter.current = new showdown.Converter();
      converter.current.setFlavor('github');
      converter.current.setOption('ghCompatibleHeaderId', true);
      converter.current.setOption('simpleLineBreaks', true);
      converter.current.setOption('ghCodeBlocks', true);
      converter.current.setOption('tables', true);
      converter.current.setOption('strikethrough', true);
      converter.current.setOption('tasklists', true);
    }
  }, []);

  let textContent = ''; // Holds the plain text representation IF HTML fails or isn't used
  let htmlContent: string | null = null; // Holds Showdown output
  let entryClassName = `response-entry ${className}`;
  let title = logEntry.type || 'Unknown Entry';
  const itemType = logEntry.type?.toLowerCase() ?? '';
  const isResultType = itemType === 'tool_result' || itemType === 'resource_result';
  let dataForDisplay = logEntry.data; // Start with the original data

  // --- Extract primary text content if applicable ---
  if (isResultType && Array.isArray(logEntry.data) && logEntry.data.length > 0) {
      const firstPart = logEntry.data[0];
      if (firstPart && firstPart.type === 'text' && typeof firstPart.text === 'string') {
          dataForDisplay = firstPart.text; // Use only the text content for display
      }
      // Add checks for other types like 'image' if needed later
  }

  // Stringify data *after* potential extraction, handle null/undefined
  const dataString = typeof dataForDisplay === 'string' ? dataForDisplay : JSON.stringify(dataForDisplay ?? '', null, 2);

  try {
    // --- Determine Base Content and Class (for non-HTML display or titles) ---
    // (This part mostly sets up textContent as a fallback)
    if (itemType === 'sse_parsed' || itemType === 'sse_raw' || itemType === 'sse_event') {
         textContent = `[Server Message${logEntry.event ? ` (${logEntry.event})`:''}${logEntry.eventId ? ` #${logEntry.eventId}`:''}] ${dataString}`;
         title = `Server Message ${logEntry.event || ''} ${logEntry.eventId || ''}`;
         if (itemType === 'sse_raw') entryClassName += ' text-muted';
         if (itemType === 'sse_parsed') {
             try {
                 const parsed = typeof logEntry.data === 'string' ? JSON.parse(logEntry.data) : logEntry.data;
                 if (parsed?.error) entryClassName += ' error-message';
             } catch { /* ignore */ }
         }
    } else if (itemType === 'request') {
        textContent = `[SENT #${logEntry.id ?? 'N/A'}] ${logEntry.method}(${JSON.stringify(logEntry.params || {})})`;
        title = `Request ${logEntry.id ?? 'N/A'}`;
        entryClassName += ' text-muted';
    } else if (itemType === 'response') {
        let responseData = typeof logEntry.data === 'string' ? {} : logEntry.data;
        try { if(typeof logEntry.data === 'string') responseData = JSON.parse(logEntry.data); } catch { /* ignore */ }
        textContent = `[RECV #${(responseData as any)?.id ?? logEntry.id ?? 'N/A'}] ${dataString}`;
        if ((responseData as any)?.error) entryClassName += ' error-message';
        title = `Response ${(responseData as any)?.id ?? logEntry.id ?? 'N/A'}`;
        entryClassName += ' success-message';
    } else if (isResultType) {
        entryClassName += ' success-message';
        title = `${logEntry.type} Result`;
        // Fallback text content is the extracted/stringified data
        textContent = dataString;
    } else if (itemType === 'error') {
        entryClassName += ' error-message';
        textContent = `[ERROR] ${dataString}`;
        title = 'Error';
    } else if (itemType === 'warning') {
        entryClassName += ' warning-message';
        textContent = `[WARN] ${dataString}`;
        title = 'Warning';
    } else if (itemType === 'info' || itemType.startsWith('notification')) {
         entryClassName += ' info-message';
         textContent = `[INFO] ${dataString}`;
         title = 'Info/Notification';
    } else {
         textContent = `[${logEntry.type?.toUpperCase() ?? 'UNKNOWN'}] ${dataString}`;
    }

    // --- Attempt Showdown Conversion (using extracted/prepared dataString) ---
    if (isResultType && converter.current) {
        try {
            // Pass the potentially extracted text content to Showdown
            // No prefix or code fences needed here if we just want the text rendered as markdown
            htmlContent = converter.current.makeHtml(dataString);
        } catch (e) {
            console.error("Error converting markdown to HTML:", e);
            htmlContent = null; // Ensure fallback to textContent
            entryClassName += ' error-message'; // Mark as error if conversion fails
            textContent = `[Render Error] Failed to convert markdown for [${logEntry.type?.toUpperCase()}]:\n${dataString}`;
        }
    } else if (itemType === 'error') {
        // Ensure errors are displayed plainly, not converted
        htmlContent = null;
    }


  } catch (e) {
      console.error("Error processing log entry data:", e);
      textContent = "[Render Error]";
      entryClassName += ' error-message';
      htmlContent = null;
  }

  // Determine badge class based on type
  let badgeClass = 'bg-secondary';
  if (itemType === 'error') badgeClass = 'bg-danger';
  else if (isResultType || itemType === 'response') badgeClass = 'bg-success';
  else if (itemType === 'warning') badgeClass = 'bg-warning text-dark';
  else if (itemType === 'info' || itemType.startsWith('notification')) badgeClass = 'bg-info text-dark';
  else if (itemType === 'request' || itemType.includes('sse')) badgeClass = 'bg-light text-dark border';


  // --- Final Rendering ---
  return (
    <div className={entryClassName} title={title}>
      <div className="d-flex align-items-start"> {/* Flex container for timestamp and content */}
        {showTimestamp && logEntry.timestamp && <span className="event-timestamp me-2">{logEntry.timestamp}</span>}
        <div className="event-data-wrapper flex-grow-1">
          {htmlContent !== null ? (
            <span className="event-data" dangerouslySetInnerHTML={{ __html: htmlContent }} />
          ) : (
            <span className="event-data" style={{ whiteSpace: 'pre-wrap' }}>{textContent}</span>
          )}
        </div>
      </div>
       {/* Display Type Badge Below Content */}
       {logEntry.type && (
         <div className="mt-1">
            <span className={`badge rounded-pill ${badgeClass} small`}>{logEntry.type}</span>
         </div>
       )}
    </div>
  );
});

export default McpResponseDisplay;