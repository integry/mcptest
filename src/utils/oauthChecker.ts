/** Read-only OAuth readiness probe. No storage, registration, authorization or token requests.
 * Fetch injection keeps this usable in a browser, a scheduled job and recorded-fixture tests.
 * Discovery and resource matching use the same SDK routines as oauthFlow/the sweep.
 */
import {
  checkResourceAllowed, discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata, extractWWWAuthenticateParams,
  resourceUrlFromServerUrl, type FetchLike,
} from '@modelcontextprotocol/client';
import type { DiscoveryFetch } from './mcpDiscovery';
import { getOAuthProviderDiagnosis, getOAuthProviderPolicy } from './oauthProviderPolicy';
import { sanitizeOAuthTraceUrl } from './oauthTrace';

export type OAuthCheckStatus = 'pass' | 'fail' | 'unknown' | 'skipped';
export interface OAuthCheckRow {
  id: string;
  title: string;
  status: OAuthCheckStatus;
  url: string;
  evidence: string;
  fix?: string;
}
export interface OAuthCheckReport {
  endpoint: string;
  classification: 'pre-login success' | 'unsupported client mode' | 'server non-compliance' | 'transient';
  verdict: string;
  rows: OAuthCheckRow[];
  providerNote?: string;
}

/** Query parameters can carry credentials; this tool accepts a clean endpoint only. */
export function normalizeOAuthCheckEndpoint(value: string): string {
  const url = new URL(value.trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    || url.username || url.password || url.search || url.hash) {
    throw new Error('Enter an HTTPS MCP endpoint without credentials, query parameters or a fragment (HTTP is allowed for localhost).');
  }
  return url.href;
}

const message = (error: unknown) => error instanceof Error && /HTTP \d{3}|does not implement|issuer.*match/i.test(error.message) ? error.message.slice(0, 250) : 'Metadata is missing, malformed, blocked or has an issuer mismatch; check the request evidence.';
const safeUrl = (url: string) => sanitizeOAuthTraceUrl(url);

export async function checkOAuthReadiness(
  input: string,
  { fetchDocument, probeEndpoint = fetchDocument }: { fetchDocument: DiscoveryFetch; probeEndpoint?: DiscoveryFetch }
): Promise<OAuthCheckReport> {
  const endpoint = normalizeOAuthCheckEndpoint(input);
  const rows: OAuthCheckRow[] = [];
  const report: OAuthCheckReport = { endpoint, rows, classification: 'server non-compliance', verdict: '' };
  let transient = false;
  const row = (id: string, title: string, status: OAuthCheckStatus, url: string, evidence: string, fix?: string) => {
    rows.push({ id, title, status, url: safeUrl(url), evidence, fix });
  };
  let resourceMetadataUrl: URL | undefined;
  try {
    const response = await probeEndpoint(endpoint, { accept: 'application/json' });
    transient = response.status === 429 || response.status >= 500;
    const header = response.wwwAuthenticate;
    resourceMetadataUrl = extractWWWAuthenticateParams(new Response(null, {
      headers: header ? { 'WWW-Authenticate': header } : {},
    })).resourceMetadataUrl;
    row('challenge', 'Unauthenticated MCP request / WWW-Authenticate',
      transient ? 'unknown' : response.status === 401 && header ? 'pass' : 'unknown', endpoint,
      `POST initialize HTTP ${response.status}. WWW-Authenticate: ${header ? safeUrlHeader(header) : 'absent or not exposed to this browser'}.`,
      'Return 401 with a Bearer resource_metadata URL. Expose WWW-Authenticate through CORS. A successful initialize response may mean OAuth is optional for this endpoint.');
  } catch {
    row('challenge', 'Unauthenticated MCP request / WWW-Authenticate', 'unknown', endpoint,
      'Browser could not read the unauthenticated response (CORS, network failure or timeout). Metadata discovery continues.',
      'Allow cross-origin reads and expose WWW-Authenticate. The restricted discovery proxy cannot fetch arbitrary MCP endpoints.');
  }

  // Record every SDK fallback, including unsuccessful candidates. No arbitrary bodies are retained.
  let phase = 'resource';
  let sourceUrl = endpoint;
  const fetchFn: FetchLike = async (input, init) => {
    if (init?.method && init.method !== 'GET') throw new Error('Read-only checker only permits GET');
    const url = String(input);
    // Reject credential-bearing metadata URLs before sending them, even to the proxy.
    normalizeOAuthCheckEndpoint(url);
    try {
      const response = await fetchDocument(url);
      const blocked = response.status === 401 || response.status === 403 || response.status === 429 || response.status >= 500;
      if (blocked) transient = true;
      sourceUrl = url;
      row(`${phase}-${rows.length}`, phase === 'resource' ? 'Protected resource metadata request (RFC 9728)' : 'Authorization server metadata request (RFC 8414 / OIDC)',
        response.status === 200 ? 'pass' : blocked ? 'unknown' : 'fail', url,
        `GET HTTP ${response.status}, ${response.contentType ?? 'no Content-Type'}, via ${response.route}${response.url !== url ? `; final URL ${safeUrl(response.url)}` : ''}.`,
        response.status !== 200 ? 'Serve public JSON at this well-known path. A failed candidate can be superseded by a successful fallback below.' : undefined);
      return new Response(response.body, { status: response.status, headers: { 'Content-Type': response.contentType ?? 'application/json' } });
    } catch (error) {
      transient = true;
      row(`${phase}-${rows.length}`, 'Metadata request', 'unknown', url, 'Could not read this metadata URL.', 'Check network reachability, CORS and proxy limits. Retry before concluding metadata is missing.');
      throw error;
    }
  };
  let resource: Awaited<ReturnType<typeof discoverOAuthProtectedResourceMetadata>> | undefined;
  try {
    resource = await discoverOAuthProtectedResourceMetadata(endpoint, { resourceMetadataUrl }, fetchFn);
    row('resource', 'Protected resource metadata validation', 'pass', sourceUrl,
      `resource: ${safeUrl(resource.resource)}; authorization_servers: ${(resource.authorization_servers ?? []).map(safeUrl).join(', ') || '(none)'}.`);
  } catch (error) {
    row('resource', 'Protected resource metadata validation', transient ? 'unknown' : 'fail', sourceUrl,
      message(error).slice(0, 500), 'Publish RFC 9728 JSON with resource and authorization_servers. Path-suffixed metadata precedes the root fallback; a challenge URL is authoritative.');
  }
  phase = 'issuer';
  let metadata: Awaited<ReturnType<typeof discoverAuthorizationServerMetadata>>;
  let metadataUrl = '';
  if (resource) {
    for (const issuer of (resource.authorization_servers ?? []).slice(0, 8)) {
      try {
        metadata = await discoverAuthorizationServerMetadata(issuer, { fetchFn });
        if (metadata) { metadataUrl = sourceUrl; break; }
      } catch (error) {
        row(`issuer-validation-${rows.length}`, 'Authorization server metadata validation', 'fail', issuer,
          message(error).slice(0, 500), 'The issuer must match authorization_servers exactly; publish valid authorization_endpoint, token_endpoint and response_types_supported.');
      }
    }
  }
  row('issuer', 'Authorization server discovery', metadata ? 'pass' : transient ? 'unknown' : 'fail', metadataUrl || sourceUrl,
    metadata ? `Validated issuer: ${safeUrl(metadata.issuer)}; authorization_endpoint: ${safeUrl(metadata.authorization_endpoint)}; token_endpoint: ${safeUrl(metadata.token_endpoint)}.` : 'Failed to discover OAuth metadata from the advertised authorization servers.',
    !metadata ? 'Publish RFC 8414 metadata at /.well-known/oauth-authorization-server<issuer-path>, or OIDC metadata at <issuer>/.well-known/openid-configuration.' : undefined);

  const requested = resourceUrlFromServerUrl(endpoint);
  const resourceMatches = resource && checkResourceAllowed({ requestedResource: requested, configuredResource: resource.resource });
  row('audience', 'Resource indicator and URL match (RFC 8707)', resource ? resourceMatches ? 'pass' : 'fail' : 'skipped', endpoint,
    resource ? `Expected ${requested}; published resource ${safeUrl(resource.resource)}. ${resourceMatches ? `Use resource=${safeUrl(resource.resource)} in authorization and token requests.` : 'Protected resource does not match expected URL (or origin).'}` : 'Requires protected resource metadata.',
    'Publish the canonical MCP URL (or an allowed parent resource) as resource; use that same audience in authorization and token requests. Metadata alone cannot prove token audience enforcement.');

  const policy = metadata ? getOAuthProviderPolicy(endpoint, metadata.issuer) : undefined;
  const diagnosis = getOAuthProviderDiagnosis(endpoint, metadata?.issuer);
  report.providerNote = diagnosis?.note;
  const methods = metadata?.token_endpoint_auth_methods_supported;
  const confidential = policy?.registrationMode === 'operator-confidential' || (methods && !methods.includes('none'));
  const restricted = confidential || diagnosis?.requiresApproval;
  const advertised = Boolean(metadata?.registration_endpoint || metadata?.client_id_metadata_document_supported);
  row('registration', 'Client registration options (RFC 7591 / CIMD)', !metadata ? 'skipped' : restricted || !advertised ? 'unknown' : 'pass', metadataUrl || endpoint,
    metadata ? `DCR: ${metadata.registration_endpoint ? safeUrl(metadata.registration_endpoint) : 'not advertised'}; client_id_metadata_document_supported: ${metadata.client_id_metadata_document_supported === true}; token auth: ${methods?.join(', ') ?? 'not advertised (OAuth default: client_secret_basic)'}. ${confidential ? 'Confidential client configuration required. ' : ''}Advertisement does not prove registration is accepted; no registration was attempted.` : 'Requires authorization server metadata.',
    'Advertise public client authentication (none), PKCE and DCR or CIMD, or document pre-registration/provider approval. Never put a client secret in a browser.');
  const pkce = metadata?.code_challenge_methods_supported?.includes('S256');
  row('pkce', 'PKCE S256', !metadata ? 'skipped' : pkce ? 'pass' : 'fail', metadataUrl || endpoint,
    metadata ? `code_challenge_methods_supported: ${metadata.code_challenge_methods_supported?.join(', ') || '(not advertised)'}.` : 'Requires authorization server metadata.',
    !pkce ? 'Support PKCE S256 and advertise code_challenge_methods_supported: ["S256"].' : undefined);
  const code = metadata?.response_types_supported.includes('code') && (!metadata.grant_types_supported || metadata.grant_types_supported.includes('authorization_code'));
  row('code', 'Authorization code flow', !metadata ? 'skipped' : code ? 'pass' : 'fail', metadataUrl || endpoint,
    metadata ? `response_types_supported: ${metadata.response_types_supported.join(', ')}; grant_types_supported: ${metadata.grant_types_supported?.join(', ') ?? '(default)'}.` : 'Requires authorization server metadata.',
    !code ? 'Enable response_type=code and grant_type=authorization_code for MCP clients.' : undefined);
  row('redirects', 'Redirect URI expectations', 'unknown', metadataUrl || endpoint,
    'Metadata does not expose per-client redirect allow-lists. Compare the client callbacks below with your provider configuration; exact-match acceptance is only tested by a real inspector connection.',
    'Register each client’s exact callback. Respect loopback variable-port rules; do not substitute localhost for 127.0.0.1 or omit the vscode.dev bridge callback.');

  if (!resource || !metadata) {
    report.classification = transient ? 'transient' : 'server non-compliance';
    report.verdict = transient ? 'Discovery blocked: retry or check access policy' : `Discovery broken: fix ${!resource ? 'protected resource metadata' : 'authorization server metadata'}`;
  } else if (!resourceMatches || !pkce || !code) {
    report.verdict = `Discovery broken: fix ${!resourceMatches ? 'resource URL match' : !pkce ? 'PKCE S256' : 'authorization code flow'}`;
  } else if (restricted || !advertised) {
    report.classification = 'unsupported client mode';
    report.verdict = confidential ? 'Confidential client required' : 'Only pre-registered clients or provider-approved clients';
  } else if (transient) {
    report.classification = 'transient';
    report.verdict = 'Metadata checks passed; MCP endpoint unavailable, retry';
  } else {
    report.classification = 'pre-login success';
    report.verdict = 'Clients can start OAuth (metadata checks passed)';
  }
  return report;
}

// Only return the discovery fields from a challenge, never arbitrary auth error descriptions.
function safeUrlHeader(header: string): string {
  const parsed = extractWWWAuthenticateParams(new Response(null, { headers: { 'WWW-Authenticate': header } }));
  return `${/^Bearer\b/i.test(header) ? 'Bearer' : '(other scheme)'}${parsed.resourceMetadataUrl ? ` resource_metadata="${safeUrl(parsed.resourceMetadataUrl.href)}"` : ''}`;
}
