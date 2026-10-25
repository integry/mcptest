/** Manual, sequential live probe. Run with Node 22: npm run oauth-sweep -- --report docs/oauth-sweep-2026-10.md */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { extractWWWAuthenticateParams, type FetchLike } from '@modelcontextprotocol/client';
import { beginOAuthFlow, getOAuthPrerequisite, type OAuthStorage } from '../src/utils/oauthFlow';
import { createOAuthFlightRecorder } from '../src/utils/oauthTrace';
import { sanitizeAuthenticationChallenge } from '../src/utils/transportDetection';
import { redactExcerpt as redact, publicClientCache, authorizationPageProblem, sweepUrl as sanitizeOAuthTraceUrl } from './oauth-sweep-support';
import catalog from '../src/data/serverCatalog.json';
import validation from '../src/data/catalogValidation.json';

const { values } = parseArgs({ options: {
  report: { type: 'string', default: 'docs/oauth-sweep-2026-10.md' },
  only: { type: 'string' },
  cache: { type: 'string', default: join(homedir(), '.cache/mcptest/oauth-sweep-clients.json') },
  delay: { type: 'string', default: '300' },
} });
const delay = Number(values.delay);
if (!Number.isFinite(delay) || delay < 100) throw new Error('--delay must be at least 100 milliseconds');
const sleep = () => new Promise(resolve => setTimeout(resolve, delay));
const callback = 'https://mcptest.io/oauth/callback';
let cache: Record<string, string> = {};
try { cache = publicClientCache(JSON.parse(await readFile(values.cache, 'utf8'))); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const storage: OAuthStorage = {
  sessionOnly: true,
  getItem: key => cache[key] ?? null,
  setItem: (key, value) => { cache[key] = value; },
  removeItem: key => { delete cache[key]; },
};
// Only public client registrations survive a run. Never persist tokens, PKCE,
// states, discovery, traces, registration access tokens, or client secrets.
async function saveClients() {
  const clients = publicClientCache(cache);
  await mkdir(dirname(values.cache), { recursive: true });
  await writeFile(values.cache, JSON.stringify(clients, null, 2), { mode: 0o600 });
}
type Result = { id: string; endpoint: string; stage: string; classification: string; detail: string; requests: string[] };
const results: Result[] = [];
const selected = validation.filter(row => row.requiresOAuth || row.authType === 'oauth')
  .filter(row => !values.only || values.only.split(',').includes(row.serverId));
if (!selected.length) throw new Error('No catalog OAuth entries matched --only');
const started = new Date().toISOString();
async function report() {
  const counts = Object.fromEntries([...new Set(results.map(r => r.classification))].map(key => [key, results.filter(r => r.classification === key).length]));
  const escape = (s: string) => s.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  await mkdir(dirname(values.report), { recursive: true });
  await writeFile(values.report, `# OAuth pre-login sweep — October 2026\n\nStarted: ${started}. Completed ${results.length}/${selected.length} catalog OAuth entries.\n\nRun manually with Node 22: \`npm run oauth-sweep -- --report ${values.report}\`. Sequential requests, ${delay} ms between requests, 12-second timeout per request. Uses the real \`beginOAuthFlow\`, SDK discovery, provider policies, PKCE and redirect construction. Redirect URI: ${callback}. No login, credentials, callback completion or token exchange. Public registrations are reused from a local, untracked cache; at most one registration POST per server per run. This Node probe cannot establish browser CORS compatibility. A responding HTML page is only a pre-login result, never proof of end-to-end authorization.\n\nCounts: ${JSON.stringify(counts)}.\n\n| Server / endpoint | Last step | Classification | Evidence / exact failure |\n| --- | --- | --- | --- |\n${results.map(r => `| ${escape(r.id)} (${escape(r.endpoint)}) | ${escape(r.stage)} | ${escape(r.classification)} | ${escape(r.detail)} |`).join('\n')}\n\n## Request evidence\n\nNon-success response excerpts are bounded and credentials redacted. Successful metadata and registration bodies are deliberately omitted. Discovery fallbacks that fail before a later successful request are retained here.\n\n${results.map(r => `### ${r.id}\n\n${r.requests.map(r => `- ${r}`).join('\n')}\n`).join('\n')}`);
}
for (const row of selected) {
  const server = catalog.find(server => server.id === row.serverId);
  if (!server) throw new Error(`Missing catalog server: ${row.serverId}`);
  const endpoint = row.validatedUrl || server.browserUrl || server.url;
  const result: Result = { id: row.serverId, endpoint, stage: 'MCP challenge', classification: 'server non-compliance', detail: '', requests: [] };
  const trace = createOAuthFlightRecorder({ targetUrl: endpoint });
  let registrations = 0;
  let authUrl: URL | undefined;
  let rateLimited = false;
  const liveFetch: FetchLike = async (input, init) => {
    const request = new Request(input, init);
    if (request.headers.has('authorization') || request.headers.has('cookie')) throw new Error('Sweep refuses credential-bearing requests');
    if (request.method === 'POST' && !request.headers.get('content-type')?.startsWith('application/json')) throw new Error('Sweep permits only anonymous MCP initialize and JSON client registration POSTs');
    if (rateLimited) throw new Error('Stopped after HTTP 429; retry in a later run according to Retry-After');
    if (request.method === 'POST' && new URL(request.url).pathname.includes('token')) throw new Error('Sweep refuses token exchange');
    if (request.method === 'POST' && result.stage === 'OAuth discovery / client establishment' && ++registrations > 1) throw new Error('Sweep refuses a second client registration');
    await sleep();
    let response: Response;
    try {
      response = await fetch(request, { signal: AbortSignal.timeout(12_000), redirect: 'manual', credentials: 'omit' });
    } catch (error) {
      result.requests.push(`${request.method} ${sanitizeOAuthTraceUrl(request.url)} → no HTTP response: ${redact(error instanceof Error ? `${error.name}: ${error.message}` : String(error))}`);
      throw error;
    }
    const body = response.ok || response.status === 302 || response.status === 303 ? '' : redact(await response.clone().text());
    result.requests.push(`${request.method} ${sanitizeOAuthTraceUrl(request.url)} → HTTP ${response.status}${body ? `: ${body}` : ''}${response.headers.get('retry-after') ? `; Retry-After: ${response.headers.get('retry-after')}` : ''}`);
    if (response.ok && request.method === 'POST' && result.stage === 'OAuth discovery / client establishment') {
      try {
        const registered = await response.clone().json();
        const facts = Object.fromEntries(['token_endpoint_auth_method', 'grant_types', 'response_types', 'application_type', 'redirect_uris']
          .filter(key => registered[key] !== undefined).map(key => [key, registered[key]]));
        result.requests.push(`Registration response metadata: ${redact(JSON.stringify({ ...facts, client_secret_present: typeof registered.client_secret === 'string', client_secret_empty: registered.client_secret === '' }))}`);
      } catch { /* The real app reports a malformed registration response. */ }
    }
    if (response.status === 429) rateLimited = true;
    return response;
  };
  try {
    const initialize = { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'mcptest-oauth-sweep', version: '1.0.0' } } }) };
    let challenge = await liveFetch(endpoint, initialize);
    let challengeUrl = endpoint;
    for (let redirects = 0; redirects < 5 && [307, 308].includes(challenge.status); redirects++) {
      const location = challenge.headers.get('location');
      if (!location) break;
      challengeUrl = new URL(location, challengeUrl).toString();
      challenge = await liveFetch(challengeUrl, initialize);
    }
    const header = challenge.headers.get('www-authenticate');
    result.requests.push(`WWW-Authenticate: ${header ? sanitizeAuthenticationChallenge(header) : '(absent)'}`);
    if (challenge.status !== 401 && challenge.status !== 403 && !challenge.ok) {
      result.classification = 'transient';
      throw new Error(`No HTTP OAuth challenge observed; HTTP ${challenge.status}. OAuth requirement remains unverified; see request evidence.`);
    }
    if (challenge.ok) result.requests.push('Initialize returned success without an HTTP challenge. Continue OAuth discovery because authorization may be enforced on later MCP operations; this does not disprove the catalog auth requirement.');
    const params = extractWWWAuthenticateParams(challenge);
    result.stage = 'OAuth discovery / client establishment';
    await beginOAuthFlow(endpoint, { storage, redirectUrl: callback, trace, fetchFn: liveFetch,
      resourceMetadataUrl: params.resourceMetadataUrl, scope: params.scope,
      redirect: url => { authUrl = url; },
    });
    if (!authUrl) {
      result.classification = 'mcptest bug';
      throw new Error('App did not construct an authorization URL');
    }
    result.stage = 'Authorization URL';
    if (authUrl.searchParams.get('code_challenge_method') !== 'S256' || !authUrl.searchParams.get('resource')) {
      result.classification = 'mcptest bug';
      throw new Error('Authorization URL missing PKCE S256 or resource');
    }
    // Follow only GET redirects, never callbacks or credential submissions.
    let next = authUrl;
    for (let redirects = 0; redirects < 6; redirects++) {
      if (next.origin === 'https://mcptest.io' && next.pathname === '/oauth/callback') throw new Error(`Authorization error callback: ${redact(next.search)}`);
      const response = await liveFetch(next, { headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) { next = new URL(location, next); continue; }
      const body = await response.text();
      const problem = authorizationPageProblem(response.status, response.headers.get('content-type') || '', body);
      if (problem) {
        result.classification = problem.classification;
        throw new Error(`${problem.reason}. HTTP ${response.status}: ${redact(body)}`);
      }
      result.stage = 'Login page (no login attempted)';
      result.classification = 'pre-login success';
      result.detail = `HTTP ${response.status} HTML; PKCE S256, resource and scopes constructed by app. Scope: ${authUrl.searchParams.get('scope') || '(none advertised)'}`;
      break;
    }
    if (!result.detail) throw new Error('Authorization redirect limit reached');
  } catch (error) {
    const prerequisite = getOAuthPrerequisite(error);
    const events = trace.snapshot().events;
    if (result.stage !== 'Authorization URL') result.stage = [...events].reverse().find(event => event.type !== 'terminal_outcome')?.type || result.stage;
    result.detail = redact(error instanceof Error ? error.message : String(error));
    if (prerequisite) {
      result.classification = ['pre_registered_client_required', 'provider_approval_required', 'operator_client_not_configured', 'provider_callback_incompatible'].includes(prerequisite.kind)
        ? 'unsupported client mode' : prerequisite.kind === 'transient_discovery_failure' ? 'transient' : 'server non-compliance';
      result.detail = `${prerequisite.kind}: ${result.detail}`;
    } else if (/no hosted token relay|token authentication method|unsupported.*authentication method|unsupported (?:grant_types|response_types|application_type)/i.test(result.detail)) result.classification = 'unsupported client mode';
    if (rateLimited || /fetch failed|timeout|aborted|HTTP (?:429|5\d\d)/i.test(result.detail)) result.classification = 'transient';
    if (result.classification === 'server non-compliance' && result.requests.some(line => /HTTP 403:.*(?:request blocked|cloudfront|just a moment)/i.test(line))) result.classification = 'transient';
    const failure = [...result.requests].reverse().find(line => /HTTP [45]\d\d/.test(line));
    if (failure) result.detail += ` Last HTTP failure: ${failure}`;
  } finally {
    results.push(result);
    await saveClients();
    await report();
    console.log(`${results.length}/${selected.length} ${result.id}: ${result.classification} (${result.stage})`);
    // Preserve client registrations only between resources/runs.
    cache = JSON.parse(await readFile(values.cache, 'utf8'));
  }
}
