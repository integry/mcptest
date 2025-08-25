/**
 * Browser-compatible PKCE challenge generator for OAuth 2.1
 */

// Generate a cryptographically random string
function generateRandomString(length: number): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  const values = new Uint8Array(length);
  
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(values);
  } else {
    // Fallback for environments without crypto
    for (let i = 0; i < length; i++) {
      values[i] = Math.floor(Math.random() * 256);
    }
  }
  
  for (let i = 0; i < length; i++) {
    result += charset[values[i] % charset.length];
  }
  
  return result;
}

// Generate SHA256 hash for PKCE code challenge
async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest('SHA-256', data);
}

// Convert ArrayBuffer to base64url string
function base64urlencode(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer);
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  // Convert to base64
  const base64 = btoa(str);
  // Convert to base64url
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Generate PKCE challenge asynchronously with proper SHA256
export async function generatePKCE(): Promise<{ code_verifier: string; code_challenge: string }> {
  try {
    // Generate code verifier (43-128 characters as per RFC 7636)
    const code_verifier = generateRandomString(64);
    
    // Generate SHA256 hash of the verifier
    const hashed = await sha256(code_verifier);
    
    // Convert to base64url
    const code_challenge = base64urlencode(hashed);
    
    return {
      code_verifier,
      code_challenge
    };
  } catch (error) {
    console.error('Error generating PKCE challenge:', error);
    throw error;
  }
}

// Default export for backward compatibility (synchronous but incorrect)
// This is deprecated and should not be used
export default function pkceChallenge(): { code_verifier: string; code_challenge: string } {
  console.warn('Using synchronous PKCE generation - this is deprecated and insecure!');
  
  // Generate code verifier
  const code_verifier = generateRandomString(64);
  
  // Return a dummy challenge - this won't work with real OAuth!
  const code_challenge = generateRandomString(43);
  
  return {
    code_verifier,
    code_challenge
  };
}