# MCP Test CORS Proxy Worker

This Cloudflare Worker provides a CORS proxy for authenticated users of the MCP Test application.

## Features

- **Authentication Required**: Only users logged in with Firebase authentication can use the proxy
- **CORS Headers**: Automatically adds appropriate CORS headers to all responses
- **Security**: Validates target URLs and only allows HTTP/HTTPS protocols
- **Preflight Handling**: Properly handles OPTIONS preflight requests

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Deploy the worker:
   ```bash
   npm run deploy
   ```

3. After deployment, update the `VITE_PROXY_URL` in your frontend `.env` file with the deployed worker URL:
   ```
   VITE_PROXY_URL=https://mcptest-cors-proxy.your-account.workers.dev
   ```

## Usage

The proxy expects:
- A `target` query parameter with the URL to proxy
- An `Authorization` header with a valid Firebase JWT token

Example:
```
GET https://mcptest-cors-proxy.workers.dev/?target=https://api.example.com/data
Authorization: Bearer <firebase-jwt-token>
```

## Development

Run the worker locally:
```bash
npm run dev
```

View logs from deployed worker:
```bash
npm run tail
```