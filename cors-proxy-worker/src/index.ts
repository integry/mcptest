// CORS Proxy Worker with Authentication
// This worker provides a CORS proxy for authenticated users only

interface Env {
  FIREBASE_PROJECT_ID: string;
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

    // Extract the target URL from query string
    const url = new URL(request.url);
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
      const headers = new Headers(request.headers);
      // Remove the Authorization header to avoid forwarding it to the target
      headers.delete('Authorization');
      // Remove CF-specific headers
      headers.delete('CF-Connecting-IP');
      headers.delete('CF-IPCountry');
      headers.delete('CF-RAY');
      headers.delete('CF-Visitor');

      const newRequest = new Request(target.toString(), {
        method: request.method,
        headers: headers,
        body: request.body,
        redirect: 'follow',
      });

      // Make the actual request to the target server
      const response = await fetch(newRequest);

      // Create a mutable copy of the response with CORS headers
      const mutableResponse = new Response(response.body, response);
      
      // Set CORS headers
      const corsHeaders = getCorsHeaders();
      for (const [key, value] of Object.entries(corsHeaders)) {
        mutableResponse.headers.set(key, value);
      }

      // Allow the client to access any headers from the proxied response
      const exposedHeaders = Array.from(mutableResponse.headers.keys()).join(', ');
      mutableResponse.headers.set('Access-Control-Expose-Headers', exposedHeaders);
      
      return mutableResponse;

    } catch (error) {
      console.error('Proxy error:', error);
      if (error instanceof Response) {
        return error;
      }
      return new Response('Error: Could not complete the proxy request.', { 
        status: 502,
        headers: getCorsHeaders()
      });
    }
  },
};

/**
 * Handles CORS preflight (OPTIONS) requests
 */
function handleOptions(request: Request): Response {
  return new Response(null, { 
    headers: {
      ...getCorsHeaders(),
      'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
    }
  });
}

/**
 * Returns standard CORS headers
 */
function getCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
}

/**
 * Verifies a Firebase JWT token
 */
async function verifyFirebaseToken(token: string, projectId: string): Promise<string | null> {
  try {
    console.log("[DEBUG] Starting JWT token verification");
    
    // Parse the token
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.log("[DEBUG] Token has invalid format - expected 3 parts, got", parts.length);
      return null;
    }

    // Decode header and payload
    const header = JSON.parse(atob(parts[0]));
    const payload = JSON.parse(atob(parts[1]));
    console.log("[DEBUG] Token header:", JSON.stringify(header));
    console.log("[DEBUG] Token payload (user ID):", payload.sub || payload.user_id);
    
    // Check token expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      console.log("[DEBUG] Token expired");
      return null;
    }
    
    // Check token not before time
    if (payload.nbf && payload.nbf > now) {
      console.log("[DEBUG] Token not yet valid");
      return null;
    }
    
    // Validate issuer
    const expectedIssuer = `https://securetoken.google.com/${projectId}`;
    if (payload.iss !== expectedIssuer) {
      console.log("[DEBUG] Invalid issuer");
      return null;
    }
    
    // Validate audience
    if (payload.aud !== projectId) {
      console.log("[DEBUG] Invalid audience");
      return null;
    }
    
    // Get the signing key
    const publicKeys = await getFirebasePublicKeys();
    console.log('[DEBUG] Available key IDs:', Object.keys(publicKeys));
    console.log('[DEBUG] Looking for key ID:', header.kid);
    
    const key = publicKeys[header.kid];
    if (!key) {
      console.log('[DEBUG] Key not found! Available keys:', Object.keys(publicKeys));
      return null;
    }
    console.log('[DEBUG] Found key for ID:', header.kid);
    
    // Verify the signature
    const isValid = await verifySignature(token, key);
    if (!isValid) {
      console.log('[DEBUG] Invalid signature');
      return null;
    }
    
    // Extract user ID
    const userId = payload.sub || payload.user_id;
    if (!userId) {
      console.log('[DEBUG] No user ID in token');
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
  
  const keys = await response.json();
  
  // Cache the keys with expiry from cache-control header
  const cacheControl = response.headers.get('cache-control');
  const maxAgeMatch = cacheControl?.match(/max-age=(\d+)/);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]) : 3600; // Default 1 hour
  
  publicKeysCache = keys;
  publicKeysCacheExpiry = now + (maxAge * 1000);
  
  return keys;
}

/**
 * Verify JWT signature using Web Crypto API
 */
async function verifySignature(token: string, publicKeyPem: string): Promise<boolean> {
  try {
    const [headerB64, payloadB64, signatureB64] = token.split('.');
    const message = `${headerB64}.${payloadB64}`;
    
    console.log('[DEBUG] Verifying signature for token with header:', headerB64);
    
    // Convert base64url to base64
    const signature = Uint8Array.from(atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    console.log('[DEBUG] Signature length:', signature.length);
    
    // Convert PEM to crypto key
    const publicKey = await importPublicKey(publicKeyPem);
    console.log('[DEBUG] Successfully imported public key');
    
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
    
    console.log('[DEBUG] Signature verification result:', isValid);
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