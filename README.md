# MCP HTTP Stream Transport Tester

A web-based testing tool for Model Context Protocol (MCP) servers using the HTTP Stream Transport protocol.

## Features

- Connect to MCP servers using the HTTP Stream Transport protocol
- Session management with Mcp-Session-Id header
- Stream resumability with Last-Event-ID tracking
- List available tools on the server
- Execute tools with dynamic parameter forms
- View real-time responses in both batch and streaming modes
- Proper JSON-RPC 2.0 message formatting

## Installation

1. Clone this repository
2. Install dependencies with `npm install`
3. Configure environment variables (see Configuration section below)
4. Start the development server with `npm run dev`
5. Open your browser to `http://localhost:5173`

## Configuration

### Firebase Authentication (Optional)

The application supports optional Firebase authentication for Google sign-in. To enable it:

1. Create a `.env` file in the root directory (copy from `.env.example`)
2. Set `VITE_FIREBASE_AUTH_ENABLED=true`
3. Add your Firebase configuration values:
   ```
   VITE_FIREBASE_API_KEY=your-api-key
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
   VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
   VITE_FIREBASE_APP_ID=your-app-id
   VITE_FIREBASE_MEASUREMENT_ID=your-measurement-id
   ```

**Note**: If Firebase authentication is enabled but not properly configured, you will see authentication errors. Make sure to use valid Firebase project credentials from your Firebase console.

### OAuth 2.1 Support

The application includes OAuth 2.1 authorization code flow with PKCE for secure authentication with MCP servers, using a Cloudflare Worker for OAuth endpoints.

#### OAuth Configuration

1. Deploy the OAuth worker:
   ```bash
   cd oauth-worker
   npm install
   ./deploy.sh
   ```

2. Update your `.env` file with your worker URL:
   ```
   VITE_OAUTH_WORKER_URL=https://your-oauth-worker.workers.dev
   ```

3. Follow the setup instructions in [oauth-worker/README.md](oauth-worker/README.md) to create the KV namespace and initialize the client

#### OAuth Features

- OAuth 2.1 compliant authorization code flow
- PKCE (Proof Key for Code Exchange) for enhanced security
- Automatic token management
- Cloudflare Worker-based OAuth server using @cloudflare/workers-oauth-provider

For detailed OAuth worker setup instructions, see [oauth-worker/README.md](oauth-worker/README.md).

## HTTP Stream Transport Protocol

The HTTP Stream Transport is the recommended transport mechanism for web-based MCP applications, implementing the Streamable HTTP transport protocol from the MCP specification.

### Key Features

- **Single Endpoint**: Uses a single HTTP endpoint (`/mcp`) for all MCP communication
- **Multiple Response Modes**: Support for both batch (JSON) and streaming (SSE) responses
- **Session Management**: Built-in session tracking and management via the `Mcp-Session-Id` header
- **Resumability**: Support for resuming broken SSE connections using the `Last-Event-ID` header
- **Authentication**: Comprehensive authentication support
- **CORS**: Flexible CORS configuration for web applications

### HTTP Methods

- **POST**: For sending client requests, notifications, and responses
- **GET**: For establishing SSE streams for receiving server messages
- **DELETE**: For terminating sessions

## Usage

1. Enter the base URL of your MCP server (e.g., `http://localhost:8080`)
2. Click "Connect" to initialize a session with the `/mcp` endpoint
3. Click "List Available Tools" to retrieve the tools from the server
4. Select a tool from the list to view its parameters
5. Fill in the required parameters
6. Click "Execute Tool" to run the selected tool
7. View the responses in the right panel

## MCP API Endpoints

The MCP Tester implements the Model Context Protocol specification with HTTP Stream Transport and expects the following endpoint on the MCP server:

- `/mcp` - Single endpoint for all MCP communication (initialization, tool listing, tool execution, and SSE)

## JSON-RPC Methods

The tester uses the following JSON-RPC 2.0 methods:

- `initialize` - Initialize a session with the server
- `list_tools` - Retrieve available tools from the server
- `execute_tool` - Execute a tool with parameters

## Event Types

The tester listens for the following SSE event types:

- `message` (default) - General messages
- `tool_response` - Tool execution responses
- `tool_error` - Tool execution errors
- `tool_list` - Tool discovery responses

## Session Management

The tester implements session management using the `Mcp-Session-Id` header:

1. The server generates a session ID during initialization
2. The tester includes this session ID in all subsequent requests
3. The tester can terminate the session with a DELETE request

## Stream Resumability

The tester supports resuming broken SSE connections:

1. Each SSE event includes a unique ID
2. The tester tracks the last received event ID
3. When reconnecting, the tester includes the `Last-Event-ID` header
4. The server can replay missed messages since that event ID

## Error Handling

The tester handles various error scenarios:

- Connection errors with automatic reconnection
- HTTP errors with appropriate error messages
- JSON-RPC errors with detailed information
- Streaming errors with graceful fallback

## Development

To modify the tester:

1. Edit `index.html` for UI changes
2. Edit `script.js` for client-side logic
3. Edit OAuth worker in `oauth-worker/src/index.js` for OAuth customization
4. Edit `styles.css` for styling

## License

MIT
