# Cloudflare Deployment Guide

This guide explains how to deploy the MCPTest State API to Cloudflare Workers.

## Deployment Methods

### Method 1: Deploy from Cloudflare Dashboard (Recommended)

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

### Method 2: Deploy from Command Line

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

## Project Structure

- `wrangler.toml` - Main Cloudflare Worker configuration (in root for UI deployment)
- `cloudflare-worker/` - Worker source code
  - `src/index.js` - Main worker entry point
  - `src/UserState.js` - Durable Object for state management
  - `wrangler.toml` - Worker configuration (used by deploy.sh script)

## Configuration

The `wrangler.toml` file in the root directory is configured to:
- Point to the worker code in `cloudflare-worker/src/index.js`
- Set up the UserState Durable Object binding
- Configure the Firebase project ID variable

## Troubleshooting

If deployment fails with "Missing entry-point" error:
- Ensure `wrangler.toml` exists in the root directory
- Verify the `main` field points to `cloudflare-worker/src/index.js`
- Check that the worker files exist in the correct location