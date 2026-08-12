// CORS Proxy Worker with Authentication
// This worker provides a CORS proxy for authenticated users only

import {
  HOSTED_GRANT_HEADER,
  HostedOAuthBroker,
  handleHostedOAuthRequest,
  resolveHostedGrant,
  type HostedOAuthEnv,
} from './hostedOAuth';

interface Env extends HostedOAuthEnv {
  FIREBASE_PROJECT_ID: string;
  /** Server-only operator OAuth configuration. Set these with `wrangler secret put`. */
  FIGMA_OAUTH_CLIENT_ID?: string;
  FIGMA_OAUTH_CLIENT_SECRET?: string;
  SLACK_OAUTH_CLIENT_ID?: string;
  SLACK_OAUTH_CLIENT_SECRET?: string;
  SLACK_OAUTH_SCOPES?: string;
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
  GITHUB_OAUTH_SCOPES?: string;
}

export type OperatorOAuthProvider = 'figma' | 'slack' | 'github';

export interface OperatorOAuthClient {
  clientId: string;
  clientSecret: string;
}

/**
 * Server-only configuration seam for approved/fixed provider applications.
 * Callers must keep the returned object inside the Worker and perform any
 * confidential token exchange there. It must never be serialized to a browser
 * response, URL, report, artifact, or log.
 */
export function getOperatorOAuthClient(
  env: Env,
  provider: OperatorOAuthProvider
): OperatorOAuthClient | undefined {
  const prefix = provider.toUpperCase() as Uppercase<OperatorOAuthProvider>;
  const clientId = env[`${prefix}_OAUTH_CLIENT_ID` as keyof Env];
  const clientSecret = env[`${prefix}_OAUTH_CLIENT_SECRET` as keyof Env];
  return typeof clientId === 'string' && clientId && typeof clientSecret === 'string' && clientSecret
    ? { clientId, clientSecret }
    : undefined;
}

export { HostedOAuthBroker };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_TARGET_REDIRECTS = 20;
export const PROXY_RESPONSE_SOURCE_HEADER = 'X-MCP-Proxy-Response-Source';
const REQUIRED_CORS_REQUEST_HEADERS = [
  'Accept',
  'Authorization',
  'Content-Type',
  'Last-Event-ID',
  'MCP-Protocol-Version',
  'Mcp-Method',
  'Mcp-Name',
  'Mcp-Session-Id',
  'X-MCP-Authorization',
  HOSTED_GRANT_HEADER,
  'x-api-key',
];
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

type ProxyResponseSource = 'proxy' | 'target';

export function getTargetRequestHeaders(requestHeaders: HeadersInit): Headers {
  const headers = new Headers(requestHeaders);
  const targetAuthorization = headers.get('X-MCP-Authorization');

  headers.delete('Authorization');
  headers.delete('X-MCP-Authorization');
  headers.delete(HOSTED_GRANT_HEADER);
  if (targetAuthorization) {
    headers.set('Authorization', targetAuthorization);
  }
  headers.delete('CF-Connecting-IP');
  headers.delete('CF-IPCountry');
  headers.delete('CF-RAY');
  headers.delete('CF-Visitor');

  return headers;
}

export async function fetchTargetRequest(
  request: Request,
  fetchImpl: (request: Request) => Promise<Response> = fetch
): Promise<Response> {
  let currentRequest = request;

  for (let redirectCount = 0; redirectCount <= MAX_TARGET_REDIRECTS; redirectCount += 1) {
    const response = await fetchImpl(currentRequest.clone());
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('Location');
    if (!location) return response;
    if (redirectCount === MAX_TARGET_REDIRECTS) {
      throw new Error('Target exceeded the maximum redirect count');
    }

    const redirectUrl = new URL(location, response.url || currentRequest.url);
    const currentUrl = new URL(currentRequest.url);
    if (redirectUrl.origin !== currentUrl.origin) {
      await response.body?.cancel().catch(() => {});
      throw new Error('Cross-origin target redirects are not allowed');
    }

    const switchToGet = response.status === 303
      ? currentRequest.method !== 'HEAD'
      : (response.status === 301 || response.status === 302) && currentRequest.method === 'POST';

    if (switchToGet) {
      const headers = new Headers(currentRequest.headers);
      headers.delete('Content-Encoding');
      headers.delete('Content-Language');
      headers.delete('Content-Length');
      headers.delete('Content-Location');
      headers.delete('Content-Type');
      currentRequest = new Request(redirectUrl, {
        method: 'GET',
        headers,
        redirect: 'manual',
      });
    } else {
      currentRequest = new Request(redirectUrl, currentRequest);
    }

    await response.body?.cancel().catch(() => {});
  }

  throw new Error('Target exceeded the maximum redirect count');
}

export function withCorsResponseHeaders(
  response: Response,
  source: ProxyResponseSource
): Response {
  const mutableResponse = new Response(response.body, response);
  const corsHeaders = getCorsHeaders(source);
  for (const [key, value] of Object.entries(corsHeaders)) {
    mutableResponse.headers.set(key, value);
  }

  const exposedHeaders = Array.from(mutableResponse.headers.keys()).join(', ');
  mutableResponse.headers.set('Access-Control-Expose-Headers', exposedHeaders);
  return mutableResponse;
}

// Firebase public keys URL
const FIREBASE_PUBLIC_KEYS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

// Cache for Firebase public keys
let publicKeysCache: Record<string, string> | null = null;
let publicKeysCacheExpiry = 0;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    const url = new URL(request.url);
    const isHostedCallbackOrAuthorize = url.pathname === '/oauth/hosted/callback'
      || url.pathname === '/oauth/hosted/authorize';
    let hostedUid: string | null = null;
    if (!isHostedCallbackOrAuthorize && url.pathname.startsWith('/oauth/hosted/')) {
      hostedUid = await authenticatedUid(request, env);
    }
    const hostedResponse = await handleHostedOAuthRequest(request, env, hostedUid);
    if (hostedResponse) return withCorsResponseHeaders(hostedResponse, 'proxy');

    // Extract the target URL from query string
    const targetUrl = url.searchParams.get('target');

    if (!targetUrl) {
      return new Response('Error: Missing "target" query parameter.', { 
        status: 400,
        headers: getCorsHeaders()
      });
    }

    // Validate the target URL
    let target: URL;
    try {
      target = new URL(targetUrl);
    } catch (e) {
      return new Response('Error: Invalid "target" URL provided.', { 
        status: 400,
        headers: getCorsHeaders()
      });
    }

    // Security: Only allow http and https protocols
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return new Response('Error: Target URL must use http or https protocol.', { 
        status: 400,
        headers: getCorsHeaders()
      });
    }

    // Verify authentication - check both Authorization header and query parameter
    let token: string | null = null;
    let tokenFromQueryParam = false;
    
    // First check Authorization header
    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
    
    // If no header, check query parameter (for SSE support)
    if (!token) {
      const authParam = url.searchParams.get('auth');
      if (authParam) {
        // URL decode the token since it's passed as a query parameter
        token = decodeURIComponent(authParam);
        tokenFromQueryParam = true;
        console.log('Using auth token from query parameter');
      }
    }
    
    if (!token) {
      return new Response('Error: Authentication required. Please login to use the proxy.', { 
        status: 401,
        headers: getCorsHeaders()
      });
    }
    
    try {
      // Verify the Firebase JWT token
      const uid = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
      if (!uid) {
        return new Response('Error: Invalid authentication token. Please login again.', { 
          status: 401,
          headers: getCorsHeaders()
        });
      }

      // Create a new request to the target URL
      const inboundHeaders = new Headers(request.headers);
      const hostedGrant = inboundHeaders.get(HOSTED_GRANT_HEADER);
      if (hostedGrant) {
        const targetAuthorization = await resolveHostedGrant(env, hostedGrant, uid, target.toString());
        inboundHeaders.set('X-MCP-Authorization', targetAuthorization);
      }
      const headers = getTargetRequestHeaders(inboundHeaders);

      const newRequest = new Request(target.toString(), {
        method: request.method,
        headers: headers,
        body: request.body,
        redirect: 'manual',
      });

      // Make the actual request to the target server
      const response = await fetchTargetRequest(newRequest);

      return withCorsResponseHeaders(response, 'target');

    } catch (error) {
      console.error('Proxy error:', error);
      if (error instanceof Response) {
        return withCorsResponseHeaders(error, 'proxy');
      }
      return new Response('Error: Could not complete the proxy request.', { 
        status: 502,
        headers: getCorsHeaders()
      });
    }
  },
};

async function authenticatedUid(request: Request, env: Env): Promise<string | null> {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  return verifyFirebaseToken(authorization.slice(7), env.FIREBASE_PROJECT_ID);
}

/**
 * Handles CORS preflight (OPTIONS) requests
 */
function handleOptions(request: Request): Response {
  let allowedHeaders: string;
  try {
    allowedHeaders = getAllowedRequestHeaders(
      request.headers.get('Access-Control-Request-Headers')
    );
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : 'Invalid CORS request headers.',
      {
        status: 400,
        headers: {
          ...getCorsHeaders(),
          'Vary': 'Access-Control-Request-Headers',
        },
      }
    );
  }

  return new Response(null, { 
    headers: {
      ...getCorsHeaders('proxy', allowedHeaders),
      'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
      'Vary': 'Access-Control-Request-Headers',
    }
  });
}

const MAX_CORS_REQUEST_HEADER_VALUE_LENGTH = 2048;
const MAX_CORS_REQUEST_HEADER_COUNT = 64;
const MAX_CORS_REQUEST_HEADER_NAME_LENGTH = 128;

function getAllowedRequestHeaders(requestedHeaders: string | null): string {
  const allowedHeaders = new Map(
    REQUIRED_CORS_REQUEST_HEADERS.map(header => [header.toLowerCase(), header])
  );

  if (requestedHeaders) {
    if (requestedHeaders.length > MAX_CORS_REQUEST_HEADER_VALUE_LENGTH) {
      throw new Error('Error: Access-Control-Request-Headers value is too large.');
    }

    const requestedHeaderList = requestedHeaders.split(',');
    if (requestedHeaderList.length > MAX_CORS_REQUEST_HEADER_COUNT) {
      throw new Error('Error: Too many Access-Control-Request-Headers values.');
    }

    for (const requestedHeader of requestedHeaderList) {
      const header = requestedHeader.trim();
      if (
        !header
        || header.length > MAX_CORS_REQUEST_HEADER_NAME_LENGTH
        || !HTTP_HEADER_NAME_PATTERN.test(header)
      ) {
        throw new Error('Error: Invalid Access-Control-Request-Headers value.');
      }
      allowedHeaders.set(header.toLowerCase(), header);
    }
  }

  return Array.from(allowedHeaders.values()).join(', ');
}

/**
 * Returns standard CORS headers
 */
function getCorsHeaders(
  source: ProxyResponseSource = 'proxy',
  allowedHeaders = REQUIRED_CORS_REQUEST_HEADERS.join(', ')
): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': allowedHeaders,
    'Access-Control-Expose-Headers': PROXY_RESPONSE_SOURCE_HEADER,
    [PROXY_RESPONSE_SOURCE_HEADER]: source,
  };
}

/**
 * Verifies a Firebase JWT token
 */
async function verifyFirebaseToken(token: string, projectId: string): Promise<string | null> {
  try {
    // Parse the token
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // Decode header and payload
    const header = JSON.parse(atob(parts[0]));
    const payload = JSON.parse(atob(parts[1]));
    
    // Check token expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }
    
    // Check token not before time
    if (payload.nbf && payload.nbf > now) {
      return null;
    }
    
    // Validate issuer
    const expectedIssuer = `https://securetoken.google.com/${projectId}`;
    if (payload.iss !== expectedIssuer) {
      return null;
    }
    
    // Validate audience
    if (payload.aud !== projectId) {
      return null;
    }
    
    // Get the signing key
    const publicKeys = await getFirebasePublicKeys();
    const key = publicKeys[header.kid];
    if (!key) {
      return null;
    }
    
    // Verify the signature
    const isValid = await verifySignature(token, key);
    if (!isValid) {
      return null;
    }
    
    // Extract user ID
    const userId = payload.sub || payload.user_id;
    if (!userId) {
      return null;
    }
    
    return userId;
  } catch (error) {
    console.error('Token verification error:', error);
    return null;
  }
}

/**
 * Get Firebase public keys with caching
 */
async function getFirebasePublicKeys(): Promise<Record<string, string>> {
  const now = Date.now();
  
  // Check if we have cached keys that haven't expired
  if (publicKeysCache && now < publicKeysCacheExpiry) {
    return publicKeysCache;
  }
  
  // Fetch new keys
  const response = await fetch(FIREBASE_PUBLIC_KEYS_URL);
  if (!response.ok) {
    throw new Error('Failed to fetch Firebase public keys');
  }
  
  const keys: unknown = await response.json();
  if (
    !keys ||
    typeof keys !== 'object' ||
    Array.isArray(keys) ||
    !Object.values(keys).every((value) => typeof value === 'string')
  ) {
    throw new Error('Firebase public-key response had an invalid shape');
  }
  const publicKeys = keys as Record<string, string>;
  
  // Cache the keys with expiry from cache-control header
  const cacheControl = response.headers.get('cache-control');
  const maxAgeMatch = cacheControl?.match(/max-age=(\d+)/);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]) : 3600; // Default 1 hour
  
  publicKeysCache = publicKeys;
  publicKeysCacheExpiry = now + (maxAge * 1000);
  
  return publicKeys;
}

/**
 * Verify JWT signature using Web Crypto API
 */
async function verifySignature(token: string, publicKeyPem: string): Promise<boolean> {
  try {
    const [headerB64, payloadB64, signatureB64] = token.split('.');
    const message = `${headerB64}.${payloadB64}`;
    
    
    // Convert base64url to base64
    const signature = Uint8Array.from(atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    
    // Convert PEM to crypto key
    const publicKey = await importPublicKey(publicKeyPem);
    
    // Verify the signature
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    
    const isValid = await crypto.subtle.verify(
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      publicKey,
      signature,
      data
    );
    
    return isValid;
  } catch (error) {
    console.error('Signature verification error:', error);
    if (error instanceof Error) {
      console.error('[DEBUG] Error stack:', error.stack);
    }
    return false;
  }
}

/**
 * Import PEM certificate and extract public key for Web Crypto API
 */
async function importPublicKey(pem: string): Promise<CryptoKey> {
  try {
    // Remove PEM headers and whitespace
    const pemContents = pem
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, '');
    
    const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
    
    // Parse the certificate to extract the public key
    // Since Cloudflare Workers doesn't support 'x509' format directly,
    // we need to manually extract the RSA public key from the certificate
    const publicKeyInfo = extractPublicKeyFromCertificate(binaryDer);
    
    // Import the extracted public key
    const publicKey = await crypto.subtle.importKey(
      'spki',
      publicKeyInfo,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      false,
      ['verify']
    );
    
    return publicKey;
  } catch (error) {
    console.error('Failed to import public key:', error);
    throw new Error('Failed to import public key from certificate');
  }
}

/**
 * Extract the public key from an X.509 certificate
 */
function extractPublicKeyFromCertificate(certDer: Uint8Array): ArrayBuffer {
  // This is a simplified ASN.1 parser to extract the SubjectPublicKeyInfo
  // from an X.509 certificate
  let offset = 0;
  
  // Helper function to read ASN.1 length
  function readLength(data: Uint8Array, pos: number): { length: number; bytesRead: number } {
    let length = data[pos];
    let bytesRead = 1;
    
    if (length & 0x80) {
      const numBytes = length & 0x7f;
      length = 0;
      for (let i = 0; i < numBytes; i++) {
        length = (length << 8) | data[pos + 1 + i];
      }
      bytesRead += numBytes;
    }
    
    return { length, bytesRead };
  }
  
  // Helper function to find a sequence
  function findSequence(data: Uint8Array, startPos: number): { pos: number; length: number; totalBytes: number } | null {
    let pos = startPos;
    while (pos < data.length - 1) {
      if (data[pos] === 0x30) { // SEQUENCE tag
        const { length, bytesRead } = readLength(data, pos + 1);
        return { pos, length, totalBytes: 1 + bytesRead + length };
      }
      pos++;
    }
    return null;
  }
  
  // The certificate is a SEQUENCE
  const cert = findSequence(certDer, 0);
  if (!cert) throw new Error('Invalid certificate format');
  
  // TBSCertificate is the first element in the certificate SEQUENCE
  const tbsCert = findSequence(certDer, cert.pos + 1);
  if (!tbsCert) throw new Error('Invalid certificate format');
  
  // Skip through the TBSCertificate fields to find SubjectPublicKeyInfo
  // Fields: version, serialNumber, signature, issuer, validity, subject
  let currentPos = tbsCert.pos + 1;
  
  // Skip version (if present - it's optional and tagged [0])
  if (certDer[currentPos] === 0xa0) {
    const { length, bytesRead } = readLength(certDer, currentPos + 1);
    currentPos += 1 + bytesRead + length;
  }
  
  // Skip serialNumber (INTEGER)
  if (certDer[currentPos] === 0x02) {
    const { length, bytesRead } = readLength(certDer, currentPos + 1);
    currentPos += 1 + bytesRead + length;
  }
  
  // Skip signature (SEQUENCE)
  const sig = findSequence(certDer, currentPos);
  if (sig) currentPos = sig.pos + sig.totalBytes;
  
  // Skip issuer (SEQUENCE)
  const issuer = findSequence(certDer, currentPos);
  if (issuer) currentPos = issuer.pos + issuer.totalBytes;
  
  // Skip validity (SEQUENCE)
  const validity = findSequence(certDer, currentPos);
  if (validity) currentPos = validity.pos + validity.totalBytes;
  
  // Skip subject (SEQUENCE)
  const subject = findSequence(certDer, currentPos);
  if (subject) currentPos = subject.pos + subject.totalBytes;
  
  // Now we should be at SubjectPublicKeyInfo (SEQUENCE)
  const spki = findSequence(certDer, currentPos);
  if (!spki) throw new Error('SubjectPublicKeyInfo not found');
  
  // Extract the SubjectPublicKeyInfo
  return certDer.slice(spki.pos, spki.pos + spki.totalBytes).buffer;
}
