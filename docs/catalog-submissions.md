# Submitting a server to the catalog

The public catalog at `/catalog` and the pages under `/servers/<id>` are built from `src/data/serverCatalog.json`. To add your remote MCP server, open a pull request against `master` that changes the files listed below.

## Eligibility

- The server must be reachable over HTTPS using Streamable HTTP or legacy SSE. Servers that only run locally over stdio are not listed.
- The endpoint must appear in the publisher's official documentation, official GitHub repository, or the official MCP Registry. The pull request must link to that page.
- Endpoints with per-user or per-tenant placeholders (for example `https://<your-subdomain>.example.com/mcp`) are not listed unless the publisher also documents a fixed shared endpoint.
- One entry per endpoint. Regional or credential-specific variants of the same server go in `alternativeEndpoints`, not in separate entries.

## What to change

1. **`src/data/serverCatalog.json`**: append one object. Follow the existing entries and the `CatalogServerSeed` type in `src/types/catalog.ts`. The required fields are:
   - `id`: a lowercase kebab-case slug. It is used in `/servers/<id>` and as the logo filename.
   - `name`, `url`, `category`, `tags`, `transport` (`streamable-http` or `legacy-sse`).
   - `description`: one or two factual sentences for a developer deciding whether to connect. Say what data or actions the server exposes and what authentication it needs. Do not use marketing copy.
   - `listingSource`: `{ "kind": "publisher", "url": "<official docs URL>" }`. Use `mcp-registry` together with `registryUrl`, `registryName`, and `registryVersion` when the official MCP Registry is the source. Use `community` only for listings that the publisher does not run.
   - `requiresOAuth` and `authType` (`none`, `oauth`, `bearer-token`, `api-token`, `api-key`). Record what validation observes, not only what the docs say.
   - For OAuth servers, an `oauthRegistration` block. Use `"mode": "unknown"` with `evidenceUrl` and `reviewedAt` unless you have tested the registration flow against hosted mcptest.
   - Optional fields: `requiredHeaders` (header templates with exactly one `<PLACEHOLDER>` and never a real credential), `alternativeAuthTypes`, `alternativeEndpoints`, `exactEndpointOnly` (set this when the documented URL is an origin root or a non-standard path that must not be rewritten to `/mcp` or `/sse`), `caveats`, `homepageUrl`, and `sourceUrl`.
   - Use an existing category where one fits. Propose a new category only when several servers need it.
2. **`public/server-logos/<id>.svg` or `.png`**: the logo file. See the logo rules below.
3. **`src/data/catalogValidation.json`** and **`src/data/catalogCapabilities.json`**: regenerate these with `npm run validate-catalog`. Do not edit them by hand.
4. **`src/utils/catalogUtils.test.ts`**: update the expected catalog size.

## Validation

Run these commands locally before you open the pull request:

```bash
npm run validate-catalog         # probes every endpoint and rewrites the validation and capability snapshots
npm run validate-catalog-assets  # checks logo files and provenance fields
npm test
npm run typecheck
npm run build                    # also generates the static /servers/<id> pages and the sitemap
```

`npm run validate-catalog` performs a real MCP handshake against the exact `url` first. Unless `exactEndpointOnly` is set, it then tries the conventional `/mcp` and `/sse` variants. For each server it records reachability, transport, protocol era and version, and the observed authentication requirement, including OAuth protected-resource metadata. For servers that complete an unauthenticated handshake, it also stores a capability snapshot (tools, resources, and prompts).

An entry is accepted only if validation reports it `online`. A server that answers with an authentication challenge counts as online. Any other failure, such as a network error, a protocol error, an unexpected response, or an intermittent session error, blocks the entry until the publisher fixes it.

`npm run import-catalog-capabilities -- --server <id> --report <public-report.json>` imports a capability inventory from a public mcptest report. Use it when the server requires authentication and you want to publish an authenticated tool list.

## Scheduled revalidation

The evidence in `src/data/catalogValidation.json` and `src/data/catalogCapabilities.json` is refreshed by the [`Catalog revalidation`](../.github/workflows/catalog-revalidation.yml) GitHub Actions workflow. Server pages and the `/badge/server/<id>.svg` badges show the timestamps from these files.

**How often.** The workflow runs every Monday at 06:17 UTC. It runs only on that schedule and on manual dispatch. Pull requests and pushes never trigger it.

**What it does.** On Node 22 it runs `npm ci`, then:

1. `npm run validate-catalog` probes every live endpoint. Each request times out after 12 seconds, and each server gets at most 120 seconds for all its probes. A server that runs out of time is recorded as `offline` with `errorCode: "timeout"`.
2. `npm run import-catalog-capabilities -- --all` checks every stored capability snapshot against the canonical schema, including authenticated inventories that were imported from public reports, and drops snapshots for servers that are no longer in the catalog.
3. `npm run validate-catalog-assets` checks the logos and provenance fields.
4. `npm run summarize-catalog-diff` compares the files before and after the run and writes the pull request body.
5. If either evidence file changed, the workflow opens a pull request from the `bot/catalog-revalidation` branch, or force-updates the one that is already open. If the evidence now matches `master` again, it closes the open bot pull request and deletes the branch.

The job times out after 30 minutes. A concurrency group ensures that two runs never overlap. A failure in any step, including a validator crash, fails the run, and GitHub reports it in the Actions tab. The job's token can only write repository contents and pull requests.

The output is deterministic. Fields are written in a fixed order, and servers keep their catalog order. A server keeps its previous `checkedAt`, and a capability snapshot keeps its previous `observedAt`, unless something observable about it changed. A run in which nothing changed therefore produces no diff and no pull request. As a result, `checkedAt` records when the current evidence was first observed, not when it was last confirmed.

**Run it manually.** Go to **Actions → Catalog revalidation → Run workflow** and choose `master`, or use the CLI:

```bash
gh workflow run catalog-revalidation.yml --ref master
gh run watch "$(gh run list --workflow catalog-revalidation.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

To run the same steps locally without opening a pull request:

```bash
cp src/data/catalogValidation.json /tmp/before-validation.json
cp src/data/catalogCapabilities.json /tmp/before-capabilities.json
npm run validate-catalog
npm run import-catalog-capabilities -- --all
npm run validate-catalog-assets
npm run summarize-catalog-diff -- \
  --before-validation /tmp/before-validation.json --after-validation src/data/catalogValidation.json \
  --before-capabilities /tmp/before-capabilities.json --after-capabilities src/data/catalogCapabilities.json \
  --catalog src/data/serverCatalog.json
```

With [`act`](https://github.com/nektos/act), `act workflow_dispatch -W .github/workflows/catalog-revalidation.yml -s GITHUB_TOKEN="$(gh auth token)"` runs the whole job, and the last step opens a real pull request. Add `--container-architecture linux/amd64` on Apple silicon.

**Review the bot pull request.**

1. Read the summary table and its sections. They list servers that went online or offline (with the error code), protocol version or era changes, transport changes, authentication changes (auth type and authorization servers), and tool count changes with the names of added and removed tools. Protocol, transport and auth changes are listed only for servers that were online in both runs, because a status change already explains the rest.
2. For each server that went offline, check whether it is a transient failure, such as a `timeout`, or a real outage. Re-run the workflow or run `npm run validate-catalog` locally to confirm. A server that stays offline for several runs needs a catalog change in a separate pull request: an updated `url`, a caveat, or removal.
3. If a server's observed authentication no longer matches the `authType` declared in `serverCatalog.json`, update the seed in a separate pull request.
4. The diff should touch only the two evidence files. Then merge. If the evidence looks wrong, close the pull request; the next run opens a new one.

Pull requests created with the workflow's `GITHUB_TOKEN` do not trigger the `CI` workflow. To run CI on the bot pull request, close and reopen it, or push an empty commit to `bot/catalog-revalidation`.

## Logo requirements

Each entry needs a local logo file, a provenance record, and a license note. `npm run validate-catalog-assets` enforces the following:

- The file lives in `public/server-logos/`, is named `<id>.svg` or `<id>.png`, and is under 256 KB. SVGs must have a `viewBox` and must not contain scripts, event handlers, external references, or embedded data URLs. PNGs must be square, 128–512 px, and transparent.
- `logoSourceKind` is one of:
  - `official-brand`: from the publisher's brand or press-kit page.
  - `official-site`: an icon served from the publisher's own site.
  - `publisher-repository`: from the publisher's official source repository.
  - `simple-icons`: from [Simple Icons](https://github.com/simple-icons/simple-icons). Pin the release tag in the URL (for example `.../blob/16.35.0/icons/<slug>.svg`, with no leading `v`).
  - `generated-fallback`: a locally generated monogram. Leave out `logoSourceUrl`, and say in the note that the monogram is generated and is not an official mark.
- Every logo except a generated fallback needs `logoSourceUrl` (HTTPS). Every logo needs `logoRetrievedAt` (`YYYY-MM-DD`).
- `logoLicenseNote` states where the mark came from and that trademark rights stay with the owner. Example: `"Acme mark from Simple Icons version 16.35.0; trademark rights remain with Acme."`
- Prefer the publisher's official brand assets. If no clearly licensed mark exists, use a generated monogram. Do not copy images from arbitrary third-party sites.

## Review checklist

- [ ] The endpoint is linked from official publisher documentation.
- [ ] `npm run validate-catalog` reports the server `online`, and the declared `authType` matches what it observed.
- [ ] The description is factual and names the authentication method.
- [ ] The logo provenance and license note are complete.
- [ ] `npm test`, `npm run typecheck`, `npm run validate-catalog-assets`, and `npm run build` pass.
