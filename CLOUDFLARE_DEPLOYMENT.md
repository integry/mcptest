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
   - Set the worker name: `cors-proxy-worker` (matching `wrangler.toml`)
   - Build configuration:
     - Root directory: `cors-proxy-worker`
     - Production branch: `master`
     - Build command: `npm run typecheck`
     - Deploy command: `npm run deploy:production`
     - Non-production branch deploy command: `npm run dry-run`
   - The wrangler.toml in `cors-proxy-worker/` will be automatically detected
   - Deployment settings will use the configuration from `cors-proxy-worker/wrangler.toml`

   Configure these values in **Settings > Build** for the `cors-proxy-worker` Worker. Cloudflare's
   [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
   does not read its build and deploy commands from Wrangler's custom-build configuration.
   Keep non-production branch builds enabled only with the dry-run command above; do not use the
   default `wrangler versions upload` command for this Worker.

   The red PR check was reproduced with a real, inactive `wrangler versions upload`. Cloudflare
   returned error 10211: `Version upload failed because the Worker includes an unapplied Durable
   Object migration; migrations must be fully applied via a non-versioned deployment.` No version
   was created and no production traffic changed. This is a lifecycle constraint, not a
   TypeScript, bundle, or OAuth failure. Cloudflare documents that
   [version uploads cannot apply Durable Object lifecycle changes](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/#durable-object-migrations).

3. **Set environment variables**
   - Add `FIREBASE_PROJECT_ID` with your actual Firebase project ID (e.g., `mcp-testing`)
   - Set `PUBLIC_APP_ORIGIN` and `HOSTED_OAUTH_CALLBACK_URL` to the deployed application and proxy origins.
   - Add the `HOSTED_OAUTH_BROKER` Durable Object binding and migration from `cors-proxy-worker/wrangler.toml`.
   - Add `SLACK_OAUTH_CLIENT_ID`, `SLACK_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_CLIENT_ID`,
     `GITHUB_OAUTH_CLIENT_SECRET`, and `HOSTED_OAUTH_ENCRYPTION_KEY` as encrypted Worker secrets.
     Do not expose these bindings to the Pages/frontend build.
   - Register `https://cors-proxy-worker.livecart.workers.dev/oauth/hosted/callback` as the exact redirect URI in
     both provider applications. See `cors-proxy-worker/README.md` for provider links and token storage details.

4. **Deploy**
   - Pull requests run TypeScript and `wrangler deploy --dry-run`; they do not upload a Worker
     version or apply a Durable Object migration.
   - Cloudflare deploys production only after a commit reaches `master`. The production command
     also checks Cloudflare's `WORKERS_CI_BRANCH` before invoking Wrangler.
   - The CORS proxy will be available at: `https://cors-proxy-worker.{your-account}.workers.dev/`

   The repository-owned `cors-proxy Worker validation` GitHub workflow performs the same
   typecheck and dry run on every pull request. Cloudflare does not generate
   [preview URLs for Workers that implement Durable Objects](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/#limitations),
   so PR validation must remain a non-uploading check. Keep the `HostedOAuthBroker` binding and
   migration intact; the reviewed `master` deployment applies lifecycle changes.

#### Declarative Durable Object exports evaluation

Cloudflare's newer declarative equivalent for this new SQLite-backed class is:

```toml
[exports.HostedOAuthBroker]
type = "durable-object"
storage = "sqlite"
```

The repository-pinned Wrangler 4.120.0 schema accepts this form. Both Wrangler deploy and version
upload dry runs validate it locally. It is mutually exclusive with `[[migrations]]`, so adopting it
would require removing the existing migration. However, Cloudflare explicitly states that
`wrangler versions upload` cannot apply lifecycle changes made with either `exports` or
`migrations`; an actual upload with an `exports` entry also fails rather than provisioning the
namespace. A dry run validates configuration and bundling only, not account reconciliation.

Therefore declarative `exports` is compatible with `HostedOAuthBroker` but is not a solution for
the PR check. This branch retains the initial SQLite migration and the non-uploading PR validation
path. Only the reviewed `master` deployment may provision the namespace and apply the lifecycle
change. Do not run a production deployment from a pull-request branch.

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
- Set up the PublishedReports Durable Object binding (see below)
- Configure the Firebase project ID variable
- Mount the public routes `mcptest.io/badge/server/*`, `mcptest.io/badge/report/*`, `mcptest.io/r` and `mcptest.io/r/*` on the site

`cloudflare-worker/wrangler.toml` declares the same worker for deployments run from that directory; keep both files in sync.

### Published report permalinks

Report pages can publish the redacted public report artifact (the same JSON as the "Download JSON" action) to the main worker. Publishing is anonymous; nothing is tied to a Firebase account.

**Bindings and secrets a maintainer must create before deploy**

| Binding | Type | Purpose |
| --- | --- | --- |
| `USER_STATE` | Durable Object, class `UserState` | Existing authenticated state API |
| `PUBLISHED_REPORTS` | Durable Object, class `PublishedReports` | Published report snapshots (one instance per endpoint) and publish rate-limit counters (one instance per address and per endpoint host) |

Both bindings are declared in `wrangler.toml`; the `v2` migration creates the `PublishedReports` class (SQLite-backed). No KV namespace and no secrets are required: removal tokens are random per snapshot and only their SHA-256 hashes are stored. The app needs `VITE_CLOUDFLARE_WORKER_URL` pointing at the deployed worker; without it the "Published history" panel and the "Publish report" button are hidden.

**Routes** (served before authentication, never touching `UserState`)

| Route | Behaviour |
| --- | --- |
| `POST /r` | Publish an artifact. Body: the redacted JSON artifact, at most 512 KiB (`413 too_large` for a larger declared length, or as soon as a streamed body passes the limit; the rest is not read). Validated against `public/schemas/report/v2.schema.json` and refused (`422 unredacted_content`) if it carries `Authorization` headers, Bearer/Basic credentials, JWTs, sensitive `key=value` assignments or URL parameters, or well-known API key shapes. The redaction scans share one inspection budget per request; an artifact that exhausts it is refused (`422 uninspectable_content`) before any rate-limit work. Only public `http(s)` endpoints are accepted (no loopback, IP literals or `.local` hosts). Rate limited to 10 publishes per hour per endpoint host and 30 per hour per client address (`429` with `Retry-After`). Returns `201` with `{ id, url, reportUrl, badgeUrl, endpoint, entry, removalToken }`; identical runs (same content hash, ignoring `generatedAt` and `timings`) return `200` with `deduplicated: true` and no new token. |
| `GET /r/<id>` | The stored artifact as JSON with `X-Robots-Tag: noindex, nofollow`, cached for 5 minutes, CORS `*`. |
| `GET /r/endpoint/<encoded endpoint>` | Index of the newest 20 snapshots for the endpoint (id, timestamps, content hash, result summary). |
| `DELETE /r/<id>` | Removal; requires the `X-Removal-Token` header. `204` on success, `403` for a wrong token, `404` when gone. |
| `GET /badge/report/<encoded endpoint>.svg` | Badge for the latest published snapshot, cached for one hour; the neutral badge (cached 5 minutes) when nothing is published. `GET /badge/server/<id>.svg` is unchanged. |

**Removal flow**

1. Publishing shows the removal token once on the report page. The app also keeps it in the browser's `localStorage` (`mcpPublishedReportRemovalTokensV1`) so the same browser shows a "Remove" button next to the snapshot; the token is never sent anywhere except the delete request.
2. To remove a snapshot from any client, send the token with the id from the permalink:
   ```bash
   curl -X DELETE "https://mcptest.io/r/<id>" -H "X-Removal-Token: <token>"
   ```
3. A lost token cannot be recovered. Publishing the identical run again does not issue a new token; publishing a changed run creates a new snapshot with its own token. Endpoint owners without a token can ask a maintainer, who can delete the `endpoint:<key>` instance's data with `wrangler` (the key is the first segment of the snapshot id).

Published reports are user-generated and are not prerendered or indexed; the `/report/<endpoint>` app route stays indexable only for catalog endpoints as before.

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
