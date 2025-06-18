import React, { useRef, useEffect, useState } from 'react';
import showdown from 'showdown';
import { LogEntry } from '../types'; // Import the full LogEntry type

interface McpResponseDisplayProps {
  logEntry: Partial<LogEntry>; // Accept partial LogEntry, as cards won't have all fields
  className?: string; // Optional additional class names
  showTimestamp?: boolean; // Add flag to control timestamp visibility
  addToSpaceButton?: React.ReactNode; // Optional add to space button
  spacesMode?: boolean; // Flag to enable spaces mode (simplified display)
  toolName?: string; // Optional tool name override for spaces mode
}

const McpResponseDisplay: React.FC<McpResponseDisplayProps> = ({
  logEntry,
  className = '',
  showTimestamp = true, // Default to showing timestamp
  addToSpaceButton,
  spacesMode = false, // Default to regular mode
  toolName: propToolName,
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

  // Force re-render with state to ensure fresh processing
  const [, forceUpdate] = useState({});
  
  useEffect(() => {
    // Force a re-render when logEntry data changes
    forceUpdate({});
  }, [logEntry.data, logEntry.type]);

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
        textContent = `[SENT #${logEntry.id ?? 'N/A'}] ${logEntry.method}(${JSON.stringify(logEntry.params || {})}`;
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
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);
  const [isContentExpanded, setIsContentExpanded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  const toolName = propToolName || logEntry.callContext?.name || 'Unknown Tool';
  const serverUrl = logEntry.callContext?.serverUrl || 'Unknown Server';
  const params = logEntry.callContext?.params || {};
  const executionTime = logEntry.callContext?.executionTime || 'Unknown';
  
  // Spaces mode: simplified display with only content and controls
  if (spacesMode && isResultType) {
    return (
      <div className={`${entryClassName} spaces-mode`} title={title}>
        {/* Content section with expand/collapse and fullscreen controls */}
        <div className="tool-result-content">
          <div className="d-flex align-items-center justify-content-end">
            <div className="btn-group" role="group">
              <button
                className="btn btn-sm btn-outline-secondary"
                style={{ fontSize: '0.7rem', padding: '0.1rem 0.3rem' }}
                onClick={() => setIsContentExpanded(!isContentExpanded)}
                title={isContentExpanded ? 'Collapse' : 'Expand'}
              >
                <i className={`bi bi-arrows-${isContentExpanded ? 'collapse' : 'expand'}`}></i>
              </button>
              <button
                className="btn btn-sm btn-outline-secondary"
                style={{ fontSize: '0.7rem', padding: '0.1rem 0.3rem' }}
                onClick={() => setIsFullscreen(true)}
                title="Fullscreen"
              >
                <i className="bi bi-arrows-fullscreen"></i>
              </button>
            </div>
          </div>
          <div 
            className="event-data-wrapper"
            style={{ 
              maxHeight: isContentExpanded ? 'none' : '300px', 
              overflowY: isContentExpanded ? 'visible' : 'auto'
            }}
          >
            {htmlContent !== null ? (
              <span className="event-data" dangerouslySetInnerHTML={{ __html: htmlContent }} />
            ) : (
              <span className="event-data" style={{ whiteSpace: 'pre-wrap' }}>{textContent}</span>
            )}
          </div>
        </div>
        
        {/* Fullscreen modal */}
        {isFullscreen && (
          <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}>
            <div className="modal-dialog modal-fullscreen">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">{toolName} - Output</h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => setIsFullscreen(false)}
                  ></button>
                </div>
                <div className="modal-body p-3" style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                  {htmlContent !== null ? (
                    <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
                  ) : (
                    <pre style={{ whiteSpace: 'pre-wrap' }}>{textContent}</pre>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
  
  // Regular mode: full display with timestamps, badges, details, etc.
  return (
    <div className={entryClassName} title={title}>
      {/* First row: timestamp, type badge with tool name, details button, and add to space button */}
      <div className="d-flex align-items-center justify-content-between mb-1">
        <div className="d-flex align-items-center">
          {showTimestamp && logEntry.timestamp && <span className="event-timestamp me-2">{logEntry.timestamp}</span>}
          {logEntry.type && (
            <div className="d-flex align-items-center">
              <span className={`badge rounded-pill ${badgeClass} small me-2`}>{logEntry.type}</span>
              {isResultType && (
                <>
                  <span className="text-muted small me-2">{toolName}</span>
                  <button
                    className="btn btn-sm btn-outline-secondary me-2"
                    style={{ fontSize: '0.7rem', padding: '0.1rem 0.3rem' }}
                    onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
                    title="Show/hide details"
                  >
                    <i className={`bi bi-chevron-${isDetailsExpanded ? 'up' : 'down'}`}></i>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {addToSpaceButton && (
          <div className="flex-shrink-0">
            {addToSpaceButton}
          </div>
        )}
      </div>
      
      {/* Details section (expandable for tool results) */}
      {isResultType && isDetailsExpanded && (
        <div className="details-section mb-2 p-2 bg-light border rounded small">
          <div className="row g-2">
            <div className="col-md-6">
              <strong>Server:</strong> <span className="text-muted">{serverUrl}</span>
            </div>
            <div className="col-md-6">
              <strong>Execution Time:</strong> <span className="text-muted">{executionTime}</span>
            </div>
            {Object.keys(params).length > 0 && (
              <div className="col-12">
                <strong>Parameters:</strong>
                <pre className="mt-1 mb-0 p-2 bg-white border rounded" style={{ fontSize: '0.7rem' }}>
                  {JSON.stringify(params, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Content section with expand/collapse and fullscreen for tool results */}
      {isResultType ? (
        <div className="tool-result-content">
          <div className="d-flex align-items-center justify-content-between mb-1">
            <span className="small text-muted">Output</span>
            <div className="btn-group" role="group">
              <button
                className="btn btn-sm btn-outline-secondary"
                style={{ fontSize: '0.7rem', padding: '0.1rem 0.3rem' }}
                onClick={() => setIsContentExpanded(!isContentExpanded)}
                title={isContentExpanded ? 'Collapse' : 'Expand'}
              >
                <i className={`bi bi-arrows-${isContentExpanded ? 'collapse' : 'expand'}`}></i>
              </button>
              <button
                className="btn btn-sm btn-outline-secondary"
                style={{ fontSize: '0.7rem', padding: '0.1rem 0.3rem' }}
                onClick={() => setIsFullscreen(true)}
                title="Fullscreen"
              >
                <i className="bi bi-arrows-fullscreen"></i>
              </button>
            </div>
          </div>
          <div 
            className="event-data-wrapper border rounded p-2"
            style={{ 
              maxHeight: isContentExpanded ? 'none' : '300px', 
              overflowY: isContentExpanded ? 'visible' : 'auto'
            }}
          >
            {htmlContent !== null ? (
              <span className="event-data" dangerouslySetInnerHTML={{ __html: htmlContent }} />
            ) : (
              <span className="event-data" style={{ whiteSpace: 'pre-wrap' }}>{textContent}</span>
            )}
          </div>
        </div>
      ) : (
        /* Regular content for non-result types */
        <div className="event-data-wrapper">
          {htmlContent !== null ? (
            <span className="event-data" dangerouslySetInnerHTML={{ __html: htmlContent }} />
          ) : (
            <span className="event-data" style={{ whiteSpace: 'pre-wrap' }}>{textContent}</span>
          )}
        </div>
      )}
      
      {/* Fullscreen modal */}
      {isFullscreen && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}>
          <div className="modal-dialog modal-fullscreen">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{toolName} - Output</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setIsFullscreen(false)}
                ></button>
              </div>
              <div className="modal-body p-3" style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                {htmlContent !== null ? (
                  <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
                ) : (
                  <pre style={{ whiteSpace: 'pre-wrap' }}>{textContent}</pre>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default McpResponseDisplay;