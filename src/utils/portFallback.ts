// Common ports used by MCP servers
export const COMMON_MCP_PORTS = [
  3000,  // Common Node.js default
  3033,  // MCP default
  8080,  // Common alternative HTTP port
  8000,  // Python default
  5000,  // Flask default
  4000,  // Alternative Node.js port
  3001,  // Common dev port
  8888,  // Jupyter default
];

/**
 * Generates URLs with different ports to try as fallbacks
 * @param originalUrl The original URL that failed
 * @param excludePort Optional port to exclude (usually the original port)
 * @returns Array of URLs with different ports to try
 */
export function generatePortFallbackUrls(originalUrl: string, excludePort?: number): string[] {
  try {
    const url = new URL(originalUrl);
    const originalPort = url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80);
    
    // Filter out the original port and any excluded port
    const portsToTry = COMMON_MCP_PORTS.filter(port => 
      port !== originalPort && port !== excludePort
    );
    
    // Generate URLs with different ports
    return portsToTry.map(port => {
      const newUrl = new URL(originalUrl);
      newUrl.port = port.toString();
      return newUrl.toString();
    });
  } catch (error) {
    console.error('Error generating port fallback URLs:', error);
    return [];
  }
}

/**
 * Checks if an error might be resolved by trying a different port
 */
export function isPortRelatedError(error: Error): boolean {
  const message = error.message?.toLowerCase() || '';
  
  const portErrorPatterns = [
    'econnrefused',
    'connection refused',
    'connect econnrefused',
    'failed to fetch',
    'network request failed',
    'unable to connect',
  ];
  
  // Don't treat CORS errors as port-related
  const nonPortPatterns = [
    'cors',
    'cross-origin',
    'access-control',
  ];
  
  if (nonPortPatterns.some(pattern => message.includes(pattern))) {
    return false;
  }
  
  return portErrorPatterns.some(pattern => message.includes(pattern));
}