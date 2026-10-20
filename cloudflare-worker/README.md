# MCP Test Cloudflare Worker

This Cloudflare Worker provides data persistence for the MCP Test application using Durable Objects.

## Features

- Stores user data in Durable Objects indexed by Firebase user ID
- Validates Firebase JWT tokens from the Authorization header
- Provides GET endpoint to retrieve user data
- Provides POST endpoint to update user data
- Serves public catalog badges (`/badge/server/<id>.svg`) without authentication
- Stores anonymously published, redacted report artifacts (`POST /r`, `GET /r/<id>`,
  `DELETE /r/<id>`, `GET /r/endpoint/<encoded endpoint>`) in the `PublishedReports`
  Durable Object and serves live badges for them (`/badge/report/<encoded endpoint>.svg`).
  See `../CLOUDFLARE_DEPLOYMENT.md` for the validation rules, rate limits and removal flow.

## Catalog submissions

`src/submissions.js` serves `POST /api/catalog/submissions` for the app's `/submit` page. It is public (no Firebase token), validates the body against `public/schemas/catalog-submission/v1.schema.json`, rate limits per client address and per endpoint host with the `SubmissionRateLimiter` Durable Object, and triggers the `catalog-submission` `repository_dispatch` event that runs `.github/workflows/catalog-submission.yml`.

- `GITHUB_DISPATCH_TOKEN` (secret, required): fine-grained token for the repository with **Contents: Read and write**. Without it the route answers `503`.
- `TURNSTILE_SECRET` (secret, optional): when set, a valid Cloudflare Turnstile token is required; when unset, the check is skipped. Pair it with `VITE_TURNSTILE_SITE_KEY` in the app build.
- `GITHUB_DISPATCH_REPOSITORY` (var, optional): defaults to `integry/mcptest`.

```bash
npx wrangler secret put GITHUB_DISPATCH_TOKEN
npx wrangler secret put TURNSTILE_SECRET   # optional
```

See `docs/catalog-submissions.md` for the full flow.

## Configuration

Before deployment, update the `FIREBASE_PROJECT_ID` in `wrangler.toml` with your actual Firebase project ID:

```toml
[vars]
FIREBASE_PROJECT_ID = "your-actual-firebase-project-id"
```

## Deployment

1. Install Wrangler CLI:
   ```bash
   npm install -g wrangler
   ```

2. Login to Cloudflare:
   ```bash
   wrangler login
   ```

3. Deploy the worker:
   ```bash
   wrangler deploy
   ```

4. Copy the worker URL and add it to your `.env` file:
   ```
   VITE_CLOUDFLARE_WORKER_URL=https://mcptest-state-api.your-subdomain.workers.dev
   ```

## Development

To run the worker locally:

```bash
wrangler dev
```

## JWT Validation

The worker now includes proper Firebase JWT validation that:

1. **Verifies JWT signatures** using Firebase's public keys fetched from Google's servers
2. **Validates token expiration** to ensure the token hasn't expired
3. **Checks issuer and audience claims** to ensure the token was issued by Firebase for your project
4. **Caches public keys** to minimize API calls to Google's servers

The implementation uses the Web Crypto API available in Cloudflare Workers for cryptographic operations.

### Security Features

- **Signature Verification**: Uses RSA-SHA256 to verify the JWT signature against Firebase's public keys
- **Token Expiration**: Rejects expired tokens based on the `exp` claim
- **Issuer Validation**: Ensures the token was issued by `https://securetoken.google.com/{projectId}`
- **Audience Validation**: Ensures the token was issued for your specific Firebase project
- **Key Caching**: Caches Firebase public keys with proper expiration based on HTTP cache headers

### Error Handling

The worker returns specific error messages for different validation failures:
- "Invalid token format" - Token doesn't have three parts
- "Token expired" - Token's expiration time has passed
- "Invalid issuer" - Token wasn't issued by Firebase for your project
- "Invalid audience" - Token wasn't issued for your project
- "Invalid signature" - Token signature verification failed