import type { Space } from '../types';

// Shared with published-report redaction so connection links follow the same
// credential-key policy without pulling the report/evaluation graph into routes.
const MAX_URL_COMPONENT_DECODE_PASSES = 4;
const EXACT_SENSITIVE_KEYS = new Set([
  'key',
  'accesskey',
  'subscriptionkey',
  'authorization',
  'proxyauthorization',
  'xmcpauthorization',
  'cookie',
  'setcookie',
  'cookies',
  'password',
  'passwd',
  'secret',
  'secrets',
  'clientsecret',
  'credential',
  'credentials',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'jwt',
  'idtokenhint',
  'clientassertion',
  'devicecode',
  'usercode',
  'apikey',
  'xapikey',
  'authorizationcode',
  'authorizationcodes',
  'oauthcode',
  'oauthcodes',
  'code',
  'token',
  'tokens',
  'sid',
  'sessionid',
  'phpsessid',
  'connectsid',
  'signature',
  'sig',
  'privatekey',
  'auth',
  'codeverifier',
  'state',
  'nonce',
  'csrf',
]);

export const canonicalKey = (key: string): string => (
  key.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
);

const SENSITIVE_KEY_COMPONENTS = new Set([
  'auth',
  'authorization',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'passwd',
  'password',
  'secret',
  'secrets',
  'token',
  'tokens',
  'signature',
]);

const NON_SENSITIVE_COMPOUND_KEYS = new Set([
  'codechallengemethodssupported',
  'estimatedcontexttokens',
]);

const WRAPPED_CREDENTIAL_KEY = /(?:api|private)key(?:value|header)$/;
const SESSION_CREDENTIAL_KEY = /(?:session|sessionid|sessionkey|sessiontoken)s?$/;

const keyComponents = (key: string): string[] => key
  .trim()
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter(Boolean);

const isSensitiveKey = (key: string): boolean => {
  const canonical = canonicalKey(key);
  if (NON_SENSITIVE_COMPOUND_KEYS.has(canonical)) return false;
  const components = keyComponents(key);
  if (components.some((component) => SENSITIVE_KEY_COMPONENTS.has(component))) {
    return true;
  }
  return EXACT_SENSITIVE_KEYS.has(canonical)
    || /(?:tokens?|secrets?|password|passwd|credentials?|authorizationcodes?|oauthcodes?|apikey|privatekey)$/.test(canonical)
    || WRAPPED_CREDENTIAL_KEY.test(canonical)
    || SESSION_CREDENTIAL_KEY.test(canonical)
    || components.includes('code')
      && components.some((component) => component === 'authorization' || component === 'oauth');
};

const decodeFormComponent = (value: string): string => (
  decodeURIComponent(value.replace(/\+/g, ' '))
);

export const isSensitiveQueryKey = (key: string): boolean => {
  let decoded = key;

  for (let pass = 0; pass <= MAX_URL_COMPONENT_DECODE_PASSES; pass += 1) {
    if (isSensitiveKey(decoded)) return true;

    let next: string;
    try {
      next = decodeFormComponent(decoded);
    } catch {
      return true;
    }
    if (next === decoded) return false;
    if (pass === MAX_URL_COMPONENT_DECODE_PASSES) return true;
    decoded = next;
  }

  return true;
};

const hasSecretContext = (value: string, depth = 0): boolean => {
  if (!value) return false;
  if (depth > 4) return true;
  if (/\b(?:Bearer|Basic)\s+\S+|\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i.test(value)) return true;
  // Includes nested URLs, JSON-shaped values and assignments in fragments.
  const assignments = value.matchAll(/(?:^|[?&;\s{"',])([^?&;\s{"',:=]+)["']?\s*[:=]/g);
  for (const match of assignments) if (isSensitiveQueryKey(match[1])) return true;
  for (const [key] of new URLSearchParams(value)) if (isSensitiveQueryKey(key)) return true;
  try {
    const decoded = decodeURIComponent(value.replace(/\+/g, ' '));
    return decoded !== value && hasSecretContext(decoded, depth + 1);
  } catch { return true; }
};

// Generate URL-safe slug from space title
export const generateSpaceSlug = (spaceName: string): string => {
  return spaceName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .trim()
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
};

// Find space by slug
export const findSpaceBySlug = (spaces: Space[], slug: string): Space | undefined => {
  return spaces.find(space => generateSpaceSlug(space.name) === slug);
};

// Generate full space URL
export const getSpaceUrl = (spaceName: string): string => {
  return `/space/${generateSpaceSlug(spaceName)}`;
};

// Extract slug from URL path
export const extractSlugFromPath = (pathname: string): string | null => {
  const match = pathname.match(/^\/space\/(.+)$/);
  return match ? match[1] : null;
};

// Connection paths retain literal endpoint slashes. HTTPS is implicit; other
// schemes use `http:host:port/path`, never `//` (proxies may merge slashes).
const encodeEndpoint = (endpoint: string): { path: string; queryOmitted: boolean } => {
  const url = new URL(/^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported endpoint scheme');
  url.username = '';
  url.password = '';
  const queryOmitted = hasSecretContext(url.search.slice(1)) || hasSecretContext(url.hash.slice(1));
  if (queryOmitted) { url.search = ''; url.hash = ''; }
  const path = `${url.protocol === 'https:' ? '' : url.protocol}${url.host}${url.pathname.replace(/\/+$/, '')}`;
  // Keep endpoint query separate from the inspector's transport query.
  const query = new URLSearchParams();
  if (url.search) query.set('query', url.search.slice(1));
  return { path: `${path}${query.size ? `?${query}` : ''}${url.hash}`, queryOmitted };
};

const decodeEndpoint = (path: string): string => {
  // Also accept historical links containing a literal scheme or its encoded form.
  const decoded = /^(?:https?%3A|https?:)/i.test(path) && !/^https?:/i.test(path)
    ? decodeURIComponent(path) : path;
  const endpoint = /^https?:\/\//i.test(decoded) ? decoded
    : /^(https?):/i.test(decoded) ? decoded.replace(/^(https?):/i, '$1://')
      : `https://${decoded}`;
  const url = new URL(endpoint);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported endpoint scheme');
  url.username = ''; url.password = '';
  return url.href.replace(/\/$/, '');
};

export const parseServerUrl = (pathname: string, search = '', hash = ''): { serverUrl: string; transportMethod?: string } | null => {
  const match = pathname.split('?')[0].match(/^\/server\/(.+)$/);
  if (!match) return null;
  try {
    const url = new URL(decodeEndpoint(match[1]));
    const params = new URLSearchParams(search || pathname.split('?')[1]);
    url.search = params.get('query') || '';
    url.hash = hash;
    const transport = params.get('transport');
    return {
      serverUrl: url.href.replace(/\/$/, ''),
      ...(transport === 'sse' || transport === 'http' ? { transportMethod: transport } : {}),
    };
  } catch { return null; }
};

export const getConnectionShareUrl = (serverUrl: string, transportMethod?: string): { url: string; queryOmitted: boolean } => {
  const encoded = encodeEndpoint(serverUrl);
  const url = new URL(`/server/${encoded.path}`, 'https://mcptest.io');
  if (transportMethod) url.searchParams.set('transport', transportMethod === 'sse' || transportMethod === 'legacy-sse' ? 'sse' : 'http');
  return { url: `${url.pathname}${url.search}${url.hash}`, queryOmitted: encoded.queryOmitted };
};

export const getServerUrl = (serverUrl: string, transportMethod?: string): string => getConnectionShareUrl(serverUrl, transportMethod).url;

// Old /server/host/mcp and /sse links are ambiguous. Always attempt the literal
// endpoint first; only a readable 404/405 permits trying the shorter legacy
// endpoint with the suffix interpreted as transport. Never retry auth/CORS errors.
export const getLegacyServerFallback = (serverUrl: string, error: unknown): { serverUrl: string; transport: 'streamable-http' | 'legacy-sse' } | null => {
  const failures = (error as { candidateFailures?: { observedRequests?: { status?: number; url?: string }[] }[] })?.candidateFailures;
  const url = new URL(serverUrl);
  const suffix = url.pathname.match(/\/(mcp|sse)$/);
  if (!suffix || url.search || url.hash) return null;
  const literalRequests = failures?.flatMap(f => f.observedRequests || []).filter(r => r.url === serverUrl);
  if (!literalRequests?.some(r => r.status === 404 || r.status === 405)
    || literalRequests.some(r => r.status === 401 || r.status === 403)) return null;
  url.pathname = url.pathname.replace(/\/(mcp|sse)$/, '') || '/';
  return { serverUrl: url.href.replace(/\/$/, ''), transport: suffix[1] === 'sse' ? 'legacy-sse' : 'streamable-http' };
};

// Generate result share URL
export const getResultShareUrl = (
  serverUrl: string,
  type: 'tool' | 'resource',
  name: string,
  params?: Record<string, any>
): string => {
  // Remove any trailing slashes from serverUrl to prevent double slashes
  const endpoint = encodeEndpoint(serverUrl);
  const encoded = new URL(`/server/${endpoint.path}`, 'https://mcptest.io');
  const cleanServerUrl = encoded.pathname.slice('/server/'.length);
  const baseUrl = `/call/${cleanServerUrl}/${type}/${encodeURIComponent(name)}`;
  
  const searchParams = new URLSearchParams();
    if (encoded.searchParams.has('query')) searchParams.set('__endpointQuery', encoded.searchParams.get('query')!);
    if (encoded.hash) searchParams.set('__endpointHash', encoded.hash.slice(1));
    for (const [key, value] of Object.entries(params || {})) {
      searchParams.append(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  return `${baseUrl}${searchParams.size ? `?${searchParams}` : ''}`;
};

// Parse result share URL
export const parseResultShareUrl = (pathname: string, search?: string): {
  serverUrl: string;
  type: 'tool' | 'resource';
  name: string;
  params?: Record<string, any>;
} | null => {
  // Extract path and query separately
  const pathOnly = pathname.split('?')[0];
  
  // Updated regex to handle URLs like: /call/{server}/{path1}/{path2}/tool/{tool_name}
  // This matches everything between /call/ and /tool/ or /resource/ as the server URL
  const match = pathOnly.match(/^\/call\/(.+)\/(tool|resource)\/(.+)$/);
  if (!match) return null;
  
  const [, serverUrl, type, encodedName] = match;
  let name: string;
  try { name = decodeURIComponent(encodedName); } catch { return null; }
  
  // Parse query parameters if present
  let params: Record<string, any> | undefined;
  const queryString = search || pathname.split('?')[1];
  if (queryString) {
    const searchParams = new URLSearchParams(queryString);
    params = {};
    for (const [key, value] of searchParams.entries()) {
      if (key === '__endpointQuery' || key === '__endpointHash') continue;
      try {
        // Try to parse as JSON first (for complex values)
        params[key] = JSON.parse(value);
      } catch {
        // If not valid JSON, use as string
        params[key] = value;
      }
    }
  }
  
  let endpoint: URL;
  try { endpoint = new URL(decodeEndpoint(serverUrl)); } catch { return null; }
  const endpointParams = new URLSearchParams(queryString);
  endpoint.search = endpointParams.get('__endpointQuery') || '';
  endpoint.hash = endpointParams.get('__endpointHash') || '';
  return {
    serverUrl: endpoint.href.replace(/\/$/, ''),
    type: type as 'tool' | 'resource',
    name,
    ...(params && { params })
  };
};