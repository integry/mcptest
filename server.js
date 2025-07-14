const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Store active SSE connections
const sseConnections = new Map();
let eventIdCounter = 0;

// Enable JSON parsing for POST requests
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname)));

// SSE endpoint for streaming server messages
app.get('/sse', (req, res) => {
  const sessionId = req.query.session_id || req.headers['mcp-session-id'] || 'default';
  const lastEventId = req.query.last_event_id || req.headers['last-event-id'];
  
  console.log(`[SSE] New connection for session: ${sessionId}, Last-Event-ID: ${lastEventId || 'none'}`);
  
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control, Last-Event-ID, Mcp-Session-Id',
  });
  
  // Create connection object
  const connectionId = `${sessionId}_${Date.now()}`;
  const connection = {
    id: connectionId,
    sessionId,
    response: res,
    lastEventId: lastEventId ? parseInt(lastEventId) : 0,
    connected: true
  };
  
  // Store connection
  sseConnections.set(connectionId, connection);
  
  // Send initial connection event
  sendSSEEvent(connection, { sessionId, connectionId, message: 'connected' }, null, 'message');
  
  // Handle client disconnect
  req.on('close', () => {
    console.log(`[SSE] Client disconnected: ${connectionId}`);
    connection.connected = false;
    sseConnections.delete(connectionId);
  });
  
  req.on('error', (err) => {
    console.error(`[SSE] Connection error for ${connectionId}:`, err);
    connection.connected = false;
    sseConnections.delete(connectionId);
  });
});

// Helper function to send SSE events
function sendSSEEvent(connection, data, id = null, event = 'message') {
  if (!connection.connected || connection.response.destroyed) {
    return false;
  }
  
  try {
    const eventId = id || ++eventIdCounter;
    const eventData = typeof data === 'string' ? data : JSON.stringify(data);
    
    connection.response.write(`id: ${eventId}\n`);
    if (event !== 'message') {
      connection.response.write(`event: ${event}\n`);
    }
    connection.response.write(`data: ${eventData}\n\n`);
    
    connection.lastEventId = eventId;
    return true;
  } catch (error) {
    console.error(`[SSE] Error sending event to ${connection.id}:`, error);
    connection.connected = false;
    sseConnections.delete(connection.id);
    return false;
  }
}

// Broadcast SSE event to all connections for a session
function broadcastSSEEvent(sessionId, data, event = 'message') {
  let sent = 0;
  for (const [connectionId, connection] of sseConnections) {
    if (connection.sessionId === sessionId || sessionId === '*') {
      if (sendSSEEvent(connection, data, null, event)) {
        sent++;
      }
    }
  }
  console.log(`[SSE] Broadcasted ${event} event to ${sent} connections for session: ${sessionId}`);
  return sent;
}

// Test endpoint to send SSE events (for debugging)
app.post('/sse/send', (req, res) => {
  const { sessionId = '*', data, event = 'message' } = req.body;
  const sent = broadcastSSEEvent(sessionId, data, event);
  res.json({ success: true, connectionsSent: sent });
});

// Serve index.html for root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`MCP SSE Tester server running at http://localhost:${PORT}`);
  console.log(`Access the tester by opening the above URL in your browser`);
});
