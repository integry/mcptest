# Remote deployment samples (content wave 3)

These files belong to the Vercel, Lambda, Cloud Run and Fly.io Learn guides.
They are intentionally outside the application's dependency and import graph.
Use Node 22.23.4 (the package selects Node 22.x). From this directory:

```bash
npm install
npm run smoke
npm start
```

The smoke runner uses ports 3000–3003, negotiates pinned MCP 2026-07-28 and
legacy initialization, lists/calls `echo`, receives SSE progress, checks no
session ID is issued, and verifies CORS, disallowed Origins/Hosts and GET 405.
Cloud Run and Fly use `node.mjs`; Vercel uses `api/mcp.mjs`. Lambda's event
adapter runs with a small AWS stream-global shim; real AWS framing and front
door streaming still require deployment verification. No cloud CLI or Docker
build was run in the authoring environment.

For local runs, leave PUBLIC_URL unset (defaults to http://localhost:3000/mcp).
For production, set PUBLIC_URL to the exact endpoint before serving clients.
For smoke on another port: PORT=4000 npm run smoke (uses 4000–4003).
The source is an unauthenticated, read-only echo demo. Add real authorization
before connecting private data, following the linked authentication guides.

## Platform entry points

- Vercel: import this directory as project root, framework Other, no build
  command; api/mcp.mjs and vercel.json route /mcp. Set PUBLIC_URL in production
  environment settings and redeploy. Test the production domain.
- Lambda: `npm install --omit=dev`, then `sam build --template-file lambda/template.yaml`
  and `sam deploy --guided`. The public function URL uses RESPONSE_STREAM.
  Set the PublicUrl stack parameter to the output endpoint and redeploy before
  testing (the placeholder deliberately fails Host validation). No IAM signing
  is expected from MCP clients. Both public invocation permissions are included.
- Cloud Run: build/deploy Dockerfile from this directory, PORT=8080, PUBLIC_URL
  set to the service's /mcp URL. The guide gives the gcloud commands.
- Fly.io: replace app, PUBLIC_URL and the health-check Host in fly.toml, create that app and deploy
  this directory. The Dockerfile listens on the internal port 8080.

JSON, YAML and TOML syntax validation does not establish cloud acceptance,
quotas, IAM permissions, DNS or TLS. Verify these in your target account.
