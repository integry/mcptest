import { UserState } from "./UserState";

// Firebase public keys URL
const FIREBASE_PUBLIC_KEYS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

// Cache for Firebase public keys
let publicKeysCache = null;
let publicKeysCacheExpiry = 0;

export default {
  async fetch(request, env, ctx) {
    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "https://mcptest.io",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    };

    // Handle preflight OPTIONS requests
    if (request.method === "OPTIONS") {
      console.log("[DEBUG] Handling OPTIONS preflight request");
      return new Response(null, {
        status: 200,
        headers: corsHeaders
      });
    }

    console.log(`[DEBUG] Handling ${request.method} request`);

    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        console.log("[DEBUG] Missing or invalid Authorization header");
        return new Response(JSON.stringify({ error: "Unauthorized" }), { 
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
    }
    const token = authHeader.substring(7, authHeader.length);
    
    // Verify the JWT token
    console.log("[DEBUG] Verifying Firebase JWT token");
    const verificationResult = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
    
    if (!verificationResult.valid) {
      console.log(`[DEBUG] Token verification failed: ${verificationResult.error}`);
      return new Response(JSON.stringify({ error: verificationResult.error || "Unauthorized" }), { 
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    console.log(`[DEBUG] Token verified successfully for user: ${verificationResult.userId}`);
    const userId = verificationResult.userId;
    const id = env.USER_STATE.idFromName(userId);
    const stub = env.USER_STATE.get(id);

    console.log("[DEBUG] Forwarding request to Durable Object");
    const response = await stub.fetch(request);
    
    // Clone the response to add CORS headers
    const newResponse = new Response(response.body, response);
    Object.keys(corsHeaders).forEach(key => {
      newResponse.headers.set(key, corsHeaders[key]);
    });
    
    return newResponse;
  },
};

// Verify Firebase JWT token
async function verifyFirebaseToken(token, projectId) {
  try {
    console.log("[DEBUG] Starting JWT token verification");
    
    // Parse the token
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.log("[DEBUG] Token has invalid format - expected 3 parts, got", parts.length);
      return { valid: false, error: "Invalid token format" };
    }

    // Decode header and payload
    const header = JSON.parse(atob(parts[0]));
    const payload = JSON.parse(atob(parts[1]));
    console.log("[DEBUG] Token header:", JSON.stringify(header));
    console.log("[DEBUG] Token payload (user ID):", payload.sub || payload.user_id);
    
    // Check token expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return { valid: false, error: "Token expired" };
    }
    
    // Check token not before time
    if (payload.nbf && payload.nbf > now) {
      return { valid: false, error: "Token not yet valid" };
    }
    
    // Validate issuer
    const expectedIssuer = `https://securetoken.google.com/${projectId}`;
    if (payload.iss !== expectedIssuer) {
      return { valid: false, error: "Invalid issuer" };
    }
    
    // Validate audience
    if (payload.aud !== projectId) {
      return { valid: false, error: "Invalid audience" };
    }
    
    // Get the signing key
    const publicKeys = await getFirebasePublicKeys();
    console.log('[DEBUG] Available key IDs:', Object.keys(publicKeys));
    console.log('[DEBUG] Looking for key ID:', header.kid);
    
    const key = publicKeys[header.kid];
    if (!key) {
      console.log('[DEBUG] Key not found! Available keys:', Object.keys(publicKeys));
      return { valid: false, error: "Invalid key ID" };
    }
    console.log('[DEBUG] Found key for ID:', header.kid);
    
    // Verify the signature
    const isValid = await verifySignature(token, key);
    if (!isValid) {
      return { valid: false, error: "Invalid signature" };
    }
    
    // Extract user ID
    const userId = payload.sub || payload.user_id;
    if (!userId) {
      return { valid: false, error: "No user ID in token" };
    }
    
    return { valid: true, userId, payload };
  } catch (error) {
    console.error('Token verification error:', error);
    return { valid: false, error: "Token verification failed" };
  }
}

// Get Firebase public keys with caching
async function getFirebasePublicKeys() {
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

// Verify JWT signature using Web Crypto API
async function verifySignature(token, publicKeyPem) {
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
    console.error('[DEBUG] Error stack:', error.stack);
    return false;
  }
}

// Import PEM certificate and extract public key for Web Crypto API
async function importPublicKey(pem) {
  try {
    // Remove PEM headers and whitespace
    const pemContents = pem
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, '');
    
    const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
    
    // Import the certificate directly using Web Crypto API
    // This is supported in Cloudflare Workers and properly extracts the public key
    const publicKey = await crypto.subtle.importKey(
      'x509',
      binaryDer,
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

// Export the Durable Object class
export { UserState };