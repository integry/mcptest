import { z } from 'zod'; // Assuming Zod is available or used by the SDK
import {
  // Attempt to import potential schemas. Adjust names if needed.
  ToolSchema,
  ResourceTemplateSchema,
  PromptSchema
} from '@modelcontextprotocol/sdk/types.js';

// Define interfaces for state clarity
export interface LogEntry {
  type: string;
  data: any; // Allow any data type, display component will handle stringification
  timestamp: string;
  eventId?: string | null;
  event?: string;
  id?: number | string;
  method?: string;
  params?: any;
  // Optional context for "Add to Space" functionality
  callContext?: {
      serverUrl: string;
      type: 'tool' | 'resource';
      name: string; // Tool name or Resource URI
      params: Record<string, any>; // Input params/args
  };
}

// Infer types from SDK Schemas if they exist
// Fallback to 'any' if schemas are not found or inference fails
export type Tool = typeof ToolSchema extends z.ZodTypeAny ? z.infer<typeof ToolSchema> : any;
export type ResourceTemplate = typeof ResourceTemplateSchema extends z.ZodTypeAny ? z.infer<typeof ResourceTemplateSchema> : any;
export type Prompt = typeof PromptSchema extends z.ZodTypeAny ? z.infer<typeof PromptSchema> : any;


// Define selected types based on the actual types
export type SelectedTool = Tool | null;
export type SelectedPrompt = Prompt | null;
// SelectedResourceTemplate is used directly in the hook, no need for a separate type here unless desired

// --- Space Types ---

export interface SpaceCard {
  id: string;
  title: string; // User editable title, defaults to tool name or resource URI
  serverUrl: string; // Fixed
  type: 'tool' | 'resource'; // To know what kind of call it represents
  name: string; // Tool name or Resource URI (fixed)
  params: Record<string, any>; // Arguments/Parameters for the call
  // Transient state for execution results (not saved to localStorage)
  loading?: boolean;
  error?: any | null;
  responseData?: any | null;
  responseType?: string | null; // e.g., 'tool_result', 'resource_result', 'error'
}

export interface Space {
  id: string;
  name: string; // User editable name
  cards: SpaceCard[];
}

// --- Zod Schemas for SDK Interaction ---

// Basic content part schema (adjust if needed based on actual content types)
export const ContentPartSchema = z.object({
  type: z.string(),
}).passthrough(); // Allow other properties

// Schema for the result of resources/access (assuming similar structure to tools/call)
export const AccessResourceResultSchema = z.object({
  content: z.array(ContentPartSchema),
});

export type AccessResourceResult = z.infer<typeof AccessResourceResultSchema>;
