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