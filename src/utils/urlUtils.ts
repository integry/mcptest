import { Space } from '../types';

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

// Server URL utilities
export const parseServerUrl = (pathname: string): { serverUrl: string; transportMethod?: string } | null => {
  const match = pathname.match(/^\/server\/(.+)$/);
  if (!match) return null;
  
  const serverPath = match[1];
  
  // Check if transport method is specified at the end
  const transportMatch = serverPath.match(/^(.+)\/(sse|mcp)$/);
  if (transportMatch) {
    return {
      serverUrl: transportMatch[1],
      transportMethod: transportMatch[2]
    };
  }
  
  return { serverUrl: serverPath };
};

// Generate server URL for sharing
export const getServerUrl = (serverUrl: string, transportMethod?: string): string => {
  const baseUrl = `/server/${serverUrl}`;
  return transportMethod ? `${baseUrl}/${transportMethod}` : baseUrl;
};

// Generate result share URL
export const getResultShareUrl = (
  serverUrl: string,
  type: 'tool' | 'resource',
  name: string,
  params?: Record<string, any>
): string => {
  // Remove any trailing slashes from serverUrl to prevent double slashes
  const cleanServerUrl = serverUrl.replace(/\/+$/, '');
  const baseUrl = `/call/${cleanServerUrl}/${type}/${encodeURIComponent(name)}`;
  
  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      searchParams.append(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
    return `${baseUrl}?${searchParams.toString()}`;
  }
  
  return baseUrl;
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
  const match = pathOnly.match(/^\/call\/([^\/]+)\/(tool|resource)\/(.+)$/);
  if (!match) return null;
  
  const [, serverUrl, type, encodedName] = match;
  const name = decodeURIComponent(encodedName);
  
  // Parse query parameters if present
  let params: Record<string, any> | undefined;
  const queryString = search || pathname.split('?')[1];
  if (queryString) {
    const searchParams = new URLSearchParams(queryString);
    params = {};
    for (const [key, value] of searchParams.entries()) {
      try {
        // Try to parse as JSON first (for complex values)
        params[key] = JSON.parse(value);
      } catch {
        // If not valid JSON, use as string
        params[key] = value;
      }
    }
  }
  
  return {
    serverUrl,
    type: type as 'tool' | 'resource',
    name,
    ...(params && { params })
  };
};