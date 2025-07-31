import { UserState } from "./UserState";

// Firebase public keys URL
const FIREBASE_PUBLIC_KEYS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

// Cache for Firebase public keys
let publicKeysCache = null;
let publicKeysCacheExpiry = 0;

export default {
  async fetch(request, env, ctx) {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response("Unauthorized", { status: 401 });
    }
    const token = authHeader.substring(7, authHeader.length);
    
    // Verify the JWT token
    const verificationResult = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
    
    if (!verificationResult.valid) {
      return new Response(verificationResult.error || "Unauthorized", { status: 401 });
    }

    const userId = verificationResult.userId;
    const id = env.USER_STATE.idFromName(userId);
    const stub = env.USER_STATE.get(id);

    return stub.fetch(request);
  },
};

// Verify Firebase JWT token
async function verifyFirebaseToken(token, projectId) {
  try {
    // Parse the token
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: "Invalid token format" };
    }

    // Decode header and payload
    const header = JSON.parse(atob(parts[0]));
    const payload = JSON.parse(atob(parts[1]));
    
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
    const key = publicKeys[header.kid];
    if (!key) {
      return { valid: false, error: "Invalid key ID" };
    }
    
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
    
    // Convert base64url to base64
    const signature = Uint8Array.from(atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    
    // Convert PEM to crypto key
    const publicKey = await importPublicKey(publicKeyPem);
    
    // Verify the signature
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    
    return await crypto.subtle.verify(
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      publicKey,
      signature,
      data
    );
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

// Import PEM certificate and extract public key for Web Crypto API
async function importPublicKey(pem) {
  try {
    // For Cloudflare Workers, we'll use a more reliable approach
    // by importing the full certificate first
    const pemContents = pem
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, '');
    
    const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
    
    // Use a simplified approach for extracting the public key
    // This works with Firebase's certificates
    const publicKey = await extractAndImportPublicKey(binaryDer);
    
    return publicKey;
  } catch (error) {
    console.error('Failed to import public key:', error);
    throw new Error('Failed to import public key from certificate');
  }
}

// Extract and import public key from X.509 certificate
async function extractAndImportPublicKey(certDer) {
  // For Firebase certificates, we can use a more direct approach
  // The public key info typically starts after a specific pattern
  
  try {
    // First, try to find the SubjectPublicKeyInfo section
    // Look for the RSA encryption OID (1.2.840.113549.1.1.1) followed by NULL
    const rsaOidPattern = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
    
    let spkiStart = -1;
    for (let i = 0; i < certDer.length - rsaOidPattern.length; i++) {
      let match = true;
      for (let j = 0; j < rsaOidPattern.length; j++) {
        if (certDer[i + j] !== rsaOidPattern[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        // Found the pattern, now backtrack to find the SEQUENCE start
        // The SPKI SEQUENCE typically starts a few bytes before the OID
        for (let k = i - 1; k >= Math.max(0, i - 20); k--) {
          if (certDer[k] === 0x30 && certDer[k + 1] === 0x82) {
            spkiStart = k;
            break;
          }
        }
        if (spkiStart !== -1) break;
      }
    }
    
    if (spkiStart === -1) {
      // Fallback: Try a different approach for the public key
      // Look for a BIT STRING (tag 0x03) with substantial length
      for (let i = 100; i < certDer.length - 300; i++) {
        if (certDer[i] === 0x03 && certDer[i + 1] === 0x82) {
          const length = (certDer[i + 2] << 8) | certDer[i + 3];
          if (length > 250 && length < 300) {
            // This might be the public key bit string
            // The actual key starts at i + 5 (skip tag, length, and unused bits)
            const keyData = certDer.slice(i + 5);
            
            // Try to import it
            try {
              const key = await crypto.subtle.importKey(
                'spki',
                keyData,
                {
                  name: 'RSASSA-PKCS1-v1_5',
                  hash: 'SHA-256',
                },
                false,
                ['verify']
              );
              return key;
            } catch (e) {
              // Continue searching if this wasn't the right key
            }
          }
        }
      }
      
      throw new Error('Could not find public key in certificate');
    }
    
    // Extract the SPKI data
    const spkiData = certDer.slice(spkiStart);
    
    // Import the public key
    const publicKey = await crypto.subtle.importKey(
      'spki',
      spkiData,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      false,
      ['verify']
    );
    
    return publicKey;
  } catch (error) {
    console.error('Failed to extract public key:', error);
    throw new Error('Failed to extract public key from certificate');
  }
}

// Export the Durable Object class
export { UserState };