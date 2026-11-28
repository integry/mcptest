// Public OAuth test issuer. All grants authorize only the fixture's echo tools.
export const RESOURCE_PATH = '/fixtures/oauth/mcp';
export const RESOURCE_METADATA = '/.well-known/oauth-protected-resource' + RESOURCE_PATH;
export const ISSUER_METADATA = '/.well-known/oauth-authorization-server/fixtures/oauth';

function safeRedirect(value) {
  if (typeof value !== 'string' || !URL.canParse(value)) return false;
  const url = new URL(value);
  return !url.username && !url.password && !value.includes('#') &&
    (value === 'https://mcptest.io/oauth/callback' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
}

export function seconds(value, fallback) {
  if (value === null) return fallback;
  const n = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(n) && n >= 1 && n <= 3600 ? n : undefined;
}

const challengeFor = async verifier => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

export function oauthAccess(request, store) {
  const token = /^Bearer (\S+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
  const access = token && store.get('access:' + token);
  const client = access && store.get('client:' + access.clientId);
  if (client && access.expiry > Date.now()) return access.clientId;
  const session = store.get('session:' + request.headers.get('Mcp-Session-Id'));
  const clientId = session?.clientId ?? access?.clientId;
  if (clientId) {
    const owner = store.get('client:' + clientId);
    if (owner) store.set('client:' + clientId, { ...owner, last401: new Date(Date.now()).toISOString() });
  }
}

export async function oauthEndpoint(request, store, readBody, respond) {
  const url = new URL(request.url);
  const issuer = url.origin + '/fixtures/oauth';
  const resource = url.origin + RESOURCE_PATH;
  const path = url.pathname;
  const fail = (error, description) => respond(400, { error, error_description: description });
  const allow = method => respond(405, undefined, { Allow: method + ', OPTIONS' });
  if ([RESOURCE_METADATA, ISSUER_METADATA].includes(path)) {
    if (request.method !== 'GET') return allow('GET');
    if (path === RESOURCE_METADATA) return respond(200, {
      resource: resource + url.search, authorization_servers: [issuer], bearer_methods_supported: ['header'],
    });
    return respond(200, {
      issuer, authorization_endpoint: issuer + '/authorize', registration_endpoint: issuer + '/register',
      token_endpoint: issuer + '/token', revocation_endpoint: issuer + '/revoke',
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
    });
  }

  if (path === '/fixtures/oauth/authorize') {
    if (request.method !== 'GET') return allow('GET');
    const p = url.searchParams;
    const clientId = p.get('client_id');
    const client = store.get('client:' + clientId);
    const redirect = p.get('redirect_uri');
    if (!safeRedirect(redirect) || !client?.redirects.includes(redirect)) return fail('invalid_request', 'Unregistered redirect URI');
    const challenge = p.get('code_challenge') ?? '';
    if (p.get('response_type') !== 'code' || p.get('code_challenge_method') !== 'S256' || !/^[\w-]{43}$/.test(challenge)) {
      return fail('invalid_request', 'Authorization code with S256 PKCE required');
    }
    const target = p.get('resource') ?? resource;
    if (!URL.canParse(target) || new URL(target).origin !== url.origin || new URL(target).pathname !== RESOURCE_PATH || new URL(target).hash) {
      return fail('invalid_target', 'Expected the OAuth fixture resource URL');
    }
    const ttl = seconds(new URL(target).searchParams.get('access_ttl'), 300);
    if (!ttl) return fail('invalid_request', 'access_ttl must be 1 to 3600 seconds');
    const code = crypto.randomUUID();
    store.set('code:' + code, { clientId, redirect, challenge, target, ttl }, Date.now() + 60_000);
    const location = new URL(redirect);
    location.searchParams.set('code', code);
    if (p.has('state')) location.searchParams.set('state', p.get('state'));
    return respond(302, undefined, { Location: location.href });
  }

  if (!['/fixtures/oauth/register', '/fixtures/oauth/token', '/fixtures/oauth/revoke'].includes(path)) return undefined;
  if (request.method !== 'POST') return allow('POST');
  const body = await readBody(request);
  if (path.endsWith('/register')) {
    let registration;
    try { registration = JSON.parse(body); } catch { return fail('invalid_client_metadata', 'Expected JSON'); }
    const redirects = registration?.redirect_uris;
    if (!Array.isArray(redirects) || !redirects.length || !redirects.every(safeRedirect)) {
      return fail('invalid_redirect_uri', 'Use an HTTP loopback callback or https://mcptest.io/oauth/callback');
    }
    if ((registration.token_endpoint_auth_method ?? 'none') !== 'none') return fail('invalid_client_metadata', 'Public clients use none');
    const clientId = crypto.randomUUID();
    store.set('client:' + clientId, { redirects, refreshCount: 0, last401: null });
    return respond(201, { client_id: clientId, redirect_uris: redirects, token_endpoint_auth_method: 'none' });
  }

  const p = new URLSearchParams(body);
  if (path.endsWith('/revoke')) {
    store.delete('refresh:' + p.get('token'));
    return respond(200);
  }
  const clientId = p.get('client_id');
  const refresh = p.get('grant_type') === 'refresh_token';
  if (!refresh && p.get('grant_type') !== 'authorization_code') return fail('unsupported_grant_type', 'Unknown grant type');
  const key = refresh ? 'refresh:' + p.get('refresh_token') : 'code:' + p.get('code');
  // Hash before reading the one-use grant. No await between lookup and consumption.
  const verifier = p.get('code_verifier') ?? '';
  const challenge = !refresh && /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) && await challengeFor(verifier);
  const grant = store.get(key);
  const client = store.get('client:' + clientId);
  if (!grant || !client || grant.clientId !== clientId || (p.has('resource') && p.get('resource') !== grant.target)
      || (!refresh && (challenge !== grant.challenge || p.get('redirect_uri') !== grant.redirect))) {
    return fail('invalid_grant', 'Invalid or expired grant');
  }
  store.delete(key);
  if (refresh) store.set('client:' + clientId, { ...client, refreshCount: client.refreshCount + 1 });
  const access = crypto.randomUUID();
  const refreshToken = crypto.randomUUID();
  store.set('access:' + access, { clientId, expiry: Date.now() + 1000 * grant.ttl });
  store.set('refresh:' + refreshToken, { clientId, ttl: grant.ttl, target: grant.target });
  return respond(200, { access_token: access, token_type: 'Bearer', expires_in: grant.ttl, refresh_token: refreshToken });
}
