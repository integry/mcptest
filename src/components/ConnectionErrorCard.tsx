import React, { useState } from 'react';

interface ConnectionErrorDetails {
  error: string;
  serverUrl: string;
  timestamp: Date;
  details?: string;
  suggestions?: string[];
}

interface ConnectionErrorCardProps {
  errorDetails: ConnectionErrorDetails;
  onRetry?: () => void;
  onDismiss?: () => void;
}

const ConnectionErrorCard: React.FC<ConnectionErrorCardProps> = ({
  errorDetails,
  onRetry,
  onDismiss
}) => {
  const [httpCurlCopied, setHttpCurlCopied] = useState(false);
  const [sseCurlCopied, setSseCurlCopied] = useState(false);

  const formatTimestamp = (date: Date): string => {
    return date.toLocaleTimeString();
  };

  const getErrorType = (error: string): string => {
    if (error.toLowerCase().includes('cors')) return 'CORS';
    if (error.toLowerCase().includes('network')) return 'Network';
    if (error.toLowerCase().includes('timeout')) return 'Timeout';
    if (error.toLowerCase().includes('refused')) return 'Connection Refused';
    return 'Connection Error';
  };

  const generateHttpCurlCommand = (serverUrl: string): string => {
    // Use the same logic as the connection code
    const baseUrl = new URL(serverUrl);
    const basePath = baseUrl.pathname.replace(/\/(mcp|sse)\/?$/, '').replace(/\/$/, '');
    const mcpUrl = `${baseUrl.origin}${basePath}/mcp/`;
    
    return `curl -X POST "${mcpUrl}" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {
        "name": "test-client",
        "version": "1.0.0"
      }
    }
  }' \\
  -L \\
  -v`;
  };

  const generateSseCurlCommand = (serverUrl: string): string => {
    // Use the same logic as the connection code
    const baseUrl = new URL(serverUrl);
    const basePath = baseUrl.pathname.replace(/\/(mcp|sse)\/?$/, '').replace(/\/$/, '');
    const sseUrl = `${baseUrl.origin}${basePath}/sse`; // No trailing slash for SSE
    
    return `curl -X GET "${sseUrl}" \\
  -H "Accept: text/event-stream" \\
  -H "Cache-Control: no-cache" \\
  -N \\
  -L \\
  -v`;
  };

  const copyToClipboard = async (text: string, type: 'http' | 'sse') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'http') {
        setHttpCurlCopied(true);
        setTimeout(() => setHttpCurlCopied(false), 2000);
      } else {
        setSseCurlCopied(true);
        setTimeout(() => setSseCurlCopied(false), 2000);
      }
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const getDebuggingSteps = (error: string): string[] => {
    const steps = [];
    
    if (error.toLowerCase().includes('cors')) {
      steps.push('CORS Issue: The server does not allow browser requests from this origin');
      steps.push('Try running the app over HTTPS if the server is HTTPS');
      steps.push('Contact the server administrator to add CORS headers');
      steps.push('For development: Use curl commands below (they work without CORS)');
      steps.push('Alternative: Use a CORS proxy or browser extension');
    } else if (error.toLowerCase().includes('refused')) {
      steps.push('Verify the server is running');
      steps.push('Check if the URL and port are correct');
      steps.push('Ensure no firewall blocking the connection');
    } else if (error.toLowerCase().includes('timeout')) {
      steps.push('Check network connectivity');
      steps.push('Verify the server is responding');
      steps.push('Try increasing timeout settings');
    } else {
      steps.push('Verify the server URL is correct');
      steps.push('Check server logs for issues');
      steps.push('Ensure the MCP server is running');
    }
    
    return steps;
  };

  const errorType = getErrorType(errorDetails.error);
  const debuggingSteps = getDebuggingSteps(errorDetails.error);
  const httpCurlCommand = generateHttpCurlCommand(errorDetails.serverUrl);
  const sseCurlCommand = generateSseCurlCommand(errorDetails.serverUrl);

  return (
    <div className="alert alert-danger border-danger mb-3" role="alert">
      <div className="d-flex justify-content-between align-items-start">
        <div className="flex-grow-1">
          <div className="d-flex align-items-center mb-2">
            <span className="badge bg-danger me-2">{errorType}</span>
            <small className="text-muted">{formatTimestamp(errorDetails.timestamp)}</small>
          </div>
          
          <h6 className="alert-heading">MCP Server Connection Failed</h6>
          
          <div className="mb-3">
            <strong>Server:</strong> <code>{errorDetails.serverUrl}</code>
          </div>
          
          <div className="mb-3">
            <strong>Error:</strong>
            <div className="mt-1 p-2 bg-light border rounded">
              <code className="text-danger">{errorDetails.error}</code>
            </div>
          </div>

          {errorDetails.details && (
            <div className="mb-3">
              <strong>Details:</strong>
              <div className="mt-1 p-2 bg-light border rounded">
                <small>{errorDetails.details}</small>
              </div>
            </div>
          )}

          <div className="mb-3">
            <strong>Debugging Steps:</strong>
            <ol className="mt-1 mb-0">
              {debuggingSteps.map((step, index) => (
                <li key={index} className="small">{step}</li>
              ))}
              <li className="small">
                <strong>Check browser developer console</strong> (F12 → Console tab) for additional error details
              </li>
            </ol>
          </div>

          <div className="mb-3">
            <strong>Test Connection via Terminal:</strong>
            <div className="row mt-2">
              <div className="col-md-6">
                <div className="mb-2">
                  <strong className="small">Streamable HTTP (POST):</strong>
                </div>
                <div className="p-2 bg-light border rounded position-relative">
                  <pre className="mb-2 small"><code>{httpCurlCommand}</code></pre>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => copyToClipboard(httpCurlCommand, 'http')}
                    disabled={httpCurlCopied}
                  >
                    {httpCurlCopied ? 'Copied!' : 'Copy HTTP curl'}
                  </button>
                </div>
              </div>
              <div className="col-md-6">
                <div className="mb-2">
                  <strong className="small">SSE (GET):</strong>
                </div>
                <div className="p-2 bg-light border rounded position-relative">
                  <pre className="mb-2 small"><code>{sseCurlCommand}</code></pre>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => copyToClipboard(sseCurlCommand, 'sse')}
                    disabled={sseCurlCopied}
                  >
                    {sseCurlCopied ? 'Copied!' : 'Copy SSE curl'}
                  </button>
                </div>
              </div>
            </div>
            <small className="text-muted">
              Run either command in your terminal to test the MCP server connection directly. 
              If you get a redirect (307), try with/without trailing slash in the URL.
              The app automatically tries both variations for each transport.
            </small>
          </div>
        </div>
        
        {onDismiss && (
          <button
            type="button"
            className="btn-close"
            aria-label="Close"
            onClick={onDismiss}
          />
        )}
      </div>
      
      {onRetry && (
        <div className="mt-3">
          <button
            type="button"
            className="btn btn-outline-danger btn-sm"
            onClick={onRetry}
          >
            Retry Connection
          </button>
        </div>
      )}
    </div>
  );
};

export default ConnectionErrorCard;