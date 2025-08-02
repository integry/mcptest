# Cloudflare Deployment Guide

This guide explains how to deploy the MCPTest State API and CORS Proxy to Cloudflare Workers.

## Deployment Methods

### Method 1: Deploy from Cloudflare Dashboard (Recommended)

#### A. Deploy the Main Application (Durable Objects Worker)

1. **Connect your GitHub repository** to Cloudflare Pages/Workers
   - Go to your Cloudflare dashboard
   - Navigate to Workers & Pages
   - Click "Create application" > "Pages" > "Connect to Git"
   - Select your GitHub repository

2. **Configure build settings**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - For the Worker deployment, the wrangler.toml in the root will be automatically detected

3. **Set environment variables**
   - Add `FIREBASE_PROJECT_ID` with your actual Firebase project ID

4. **Deploy**
   - Cloudflare will automatically deploy when you push to your connected branch

#### B. Deploy the CORS Proxy Worker

1. **Create a second Worker application** in Cloudflare Dashboard
   - Go to your Cloudflare dashboard
   - Navigate to Workers & Pages
   - Click "Create application" > "Workers" > "Connect to Git"
   - Select the same GitHub repository

2. **Configure the CORS Proxy Worker**
   - Set the worker name: `mcptest-cors-proxy`
   - Build configuration:
     - Root directory: `cors-proxy-worker`
     - Build command: `npm install`
   - The wrangler.toml in `cors-proxy-worker/` will be automatically detected
   - Deployment settings will use the configuration from `cors-proxy-worker/wrangler.toml`

3. **Set environment variables**
   - Add `FIREBASE_PROJECT_ID` with your actual Firebase project ID (e.g., `mcp-testing`)

4. **Deploy**
   - Cloudflare will automatically deploy when you push to your connected branch
   - The CORS proxy will be available at: `https://mcptest-cors-proxy.{your-account}.workers.dev/`

### Method 2: Deploy from Command Line

#### A. Deploy the Main Application

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure Firebase Project ID**
   Edit `wrangler.toml` and replace `your-firebase-project-id` with your actual Firebase project ID:
   ```toml
   [vars]
   FIREBASE_PROJECT_ID = "your-actual-project-id"
   ```

3. **Deploy the Worker**
   ```bash
   npm run deploy-worker
   ```
   or
   ```bash
   npx wrangler deploy
   ```

#### B. Deploy the CORS Proxy Worker

1. **Navigate to the CORS proxy directory**
   ```bash
   cd cors-proxy-worker
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Firebase Project ID**
   Edit `cors-proxy-worker/wrangler.toml` and set your Firebase project ID if needed:
   ```toml
   [vars]
   FIREBASE_PROJECT_ID = "your-actual-project-id"
   ```

4. **Deploy the CORS Proxy Worker**
   ```bash
   npm run deploy
   ```
   or
   ```bash
   npx wrangler deploy
   ```

5. **Update your environment configuration**
   After deployment, update your `.env` file with the CORS proxy URL:
   ```
   VITE_PROXY_URL=https://mcptest-cors-proxy.{your-account}.workers.dev/
   ```

## Project Structure

- `wrangler.toml` - Main Cloudflare Worker configuration (in root for UI deployment)
- `cloudflare-worker/` - Main worker source code
  - `src/index.js` - Main worker entry point
  - `src/UserState.js` - Durable Object for state management
  - `wrangler.toml` - Worker configuration (used by deploy.sh script)
- `cors-proxy-worker/` - CORS proxy worker
  - `src/index.ts` - CORS proxy implementation with authentication
  - `wrangler.toml` - CORS proxy worker configuration
  - `package.json` - Dependencies and scripts for the CORS proxy

## Configuration

### Main Worker Configuration
The `wrangler.toml` file in the root directory is configured to:
- Point to the worker code in `cloudflare-worker/src/index.js`
- Set up the UserState Durable Object binding
- Configure the Firebase project ID variable

### CORS Proxy Configuration
The `cors-proxy-worker/wrangler.toml` file is configured to:
- Deploy as a separate worker named `mcptest-cors-proxy`
- Point to the TypeScript source in `cors-proxy-worker/src/index.ts`
- Configure the Firebase project ID for authentication

## Troubleshooting

### Main Worker Issues
If deployment fails with "Missing entry-point" error:
- Ensure `wrangler.toml` exists in the root directory
- Verify the `main` field points to `cloudflare-worker/src/index.js`
- Check that the worker files exist in the correct location

### CORS Proxy Worker Issues
If CORS proxy deployment fails:
- Ensure you've created a separate Worker application in Cloudflare dashboard
- Verify the root directory is set to `cors-proxy-worker` in the build configuration
- Check that `cors-proxy-worker/wrangler.toml` exists
- Ensure TypeScript source file exists at `cors-proxy-worker/src/index.ts`

### Automatic Deployment Issues
If automatic deployment from GitHub doesn't trigger:
- Verify your GitHub repository is properly connected in Cloudflare dashboard
- Check that you have the correct branch selected for automatic deployments
- Ensure build configurations are set correctly for each worker
- Both workers need to be set up separately in the Cloudflare dashboard