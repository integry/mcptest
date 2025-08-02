// CORS Proxy Worker with Authentication
// This worker provides a CORS proxy for authenticated users only

interface Env {
  FIREBASE_PROJECT_ID: string;
}

// Cache for Firebase public keys
const PUBLIC_KEYS_CACHE_KEY = 'firebase-public-keys';
const PUBLIC_KEYS_CACHE_TTL = 3600; // 1 hour

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
 * Verifies a Firebase JWT token (copied from existing worker implementation)
 */
async function verifyFirebaseToken(token: string, projectId: string): Promise<string | null> {
  try {
    // Decode the token
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.error('Invalid token format');
      return null;
    }

    // Decode header and payload
    let header, payload;
    try {
      header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
      payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch (e) {
      console.error('Failed to decode token parts:', e);
      return null;
    }

    // Verify token claims
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      console.error('Token expired');
      return null;
    }

    if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
      console.error('Invalid issuer');
      return null;
    }

    if (payload.aud !== projectId) {
      console.error('Invalid audience');
      return null;
    }

    // Get the public key
    const publicKey = await getFirebasePublicKey(header.kid);
    if (!publicKey) {
      console.error('Public key not found for kid:', header.kid);
      return null;
    }

    // Verify the signature
    const encoder = new TextEncoder();
    const data = encoder.encode(parts[0] + '.' + parts[1]);
    let signature;
    try {
      signature = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    } catch (e) {
      console.error('Failed to decode signature:', e);
      return null;
    }

    const cryptoKey = await crypto.subtle.importKey(
      'spki',
      publicKey,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      false,
      ['verify']
    );

    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      signature,
      data
    );

    if (!valid) {
      console.error('Invalid signature');
      return null;
    }

    return payload.sub; // Return the user ID
  } catch (error) {
    console.error('Token verification error:', error);
    return null;
  }
}

/**
 * Fetches Firebase public keys (with caching)
 */
async function getFirebasePublicKey(kid: string): Promise<ArrayBuffer | null> {
  try {
    // Try to get from cache first
    const cache = caches.default;
    const cacheKey = new Request(`https://cache.local/${PUBLIC_KEYS_CACHE_KEY}`);
    const cachedResponse = await cache.match(cacheKey);

    let publicKeys: Record<string, string>;
    if (cachedResponse) {
      publicKeys = await cachedResponse.json();
    } else {
      // Fetch from Google
      const response = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
      if (!response.ok) {
        throw new Error('Failed to fetch public keys');
      }
      
      publicKeys = await response.json();
      
      // Cache the response
      const cacheResponse = new Response(JSON.stringify(publicKeys), {
        headers: {
          'Cache-Control': `max-age=${PUBLIC_KEYS_CACHE_TTL}`,
          'Content-Type': 'application/json',
        },
      });
      await cache.put(cacheKey, cacheResponse);
    }

    const publicKeyPem = publicKeys[kid];
    if (!publicKeyPem) {
      return null;
    }

    // Convert PEM to ArrayBuffer
    const pemHeader = '-----BEGIN CERTIFICATE-----';
    const pemFooter = '-----END CERTIFICATE-----';
    
    // Find the positions of header and footer
    const headerIndex = publicKeyPem.indexOf(pemHeader);
    const footerIndex = publicKeyPem.indexOf(pemFooter);
    
    if (headerIndex === -1 || footerIndex === -1) {
      console.error('Invalid PEM format');
      return null;
    }
    
    // Extract the base64 content between header and footer
    const pemContents = publicKeyPem
      .substring(headerIndex + pemHeader.length, footerIndex)
      .replace(/\r?\n/g, '') // Remove line breaks
      .replace(/\s/g, ''); // Remove any remaining whitespace
    
    let binaryString;
    try {
      binaryString = atob(pemContents);
    } catch (e) {
      console.error('Failed to decode PEM certificate:', e);
      console.error('PEM contents length:', pemContents.length);
      console.error('First 100 chars:', pemContents.substring(0, 100));
      return null;
    }
    
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Extract the public key from the certificate
    const cert = bytes;
    const publicKeyInfo = extractPublicKeyFromCert(cert);
    
    return publicKeyInfo;
  } catch (error) {
    console.error('Error fetching public key:', error);
    return null;
  }
}

/**
 * Extracts the public key from an X.509 certificate
 */
function extractPublicKeyFromCert(cert: Uint8Array): ArrayBuffer {
  // This is a simplified extraction - in production, use a proper ASN.1 parser
  // For Firebase certs, the public key info typically starts around byte 280-300
  // and has a specific pattern we can search for
  
  // Look for the SPKI pattern (SubjectPublicKeyInfo)
  const spkiPattern = [0x30, 0x82]; // SEQUENCE tag for SPKI
  
  for (let i = 200; i < cert.length - 300; i++) {
    if (cert[i] === spkiPattern[0] && cert[i + 1] === spkiPattern[1]) {
      // Found potential SPKI start
      const length = (cert[i + 2] << 8) | cert[i + 3];
      if (length > 250 && length < 500) { // Reasonable length for RSA public key
        // Extract the SPKI
        return cert.slice(i, i + 4 + length).buffer;
      }
    }
  }
  
  throw new Error('Could not extract public key from certificate');
}