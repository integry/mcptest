import { z } from 'zod'; // Assuming Zod is available or used by the SDK
import {
  // Attempt to import potential schemas. Adjust names if needed.
  ToolSchema,
  ResourceSchema,
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
  // Optional context for "Add to Dashboard" functionality
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
export type Resource = typeof ResourceSchema extends z.ZodTypeAny ? z.infer<typeof ResourceSchema> : any;
export type ResourceTemplate = typeof ResourceTemplateSchema extends z.ZodTypeAny ? z.infer<typeof ResourceTemplateSchema> : any;
export type Prompt = typeof PromptSchema extends z.ZodTypeAny ? z.infer<typeof PromptSchema> : any;


// Define selected types based on the actual types
export type SelectedTool = Tool | null;
export type SelectedPrompt = Prompt | null;
// SelectedResourceTemplate is used directly in the hook, no need for a separate type here unless desired

// --- Dashboard Types ---

export interface SpaceCard {
  id: string;
  title: string; // User editable title, defaults to tool name or resource URI
  serverUrl: string; // Fixed
  type: 'tool' | 'resource'; // To know what kind of call it represents
  name: string; // Tool name or Resource URI (fixed)
  params: Record<string, any>; // Arguments/Parameters for the call
  useProxy?: boolean; // Whether to use proxy for this connection
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
  columns?: number; // Number of columns for card layout (1-4), default to 2
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

// --- Transport Types ---
export type TransportType = 'streamable-http' | 'legacy-sse' | 'stdio';

// --- Connection Tab Types ---
export interface ConnectionTab {
  id: string;
  title: string;
  serverUrl: string;
  connectionStatus: 'Disconnected' | 'Connecting' | 'Connected' | 'Error';
  transportType?: TransportType | null;
  useProxy?: boolean; // Whether to use proxy for this connection
  // Capabilities for this specific connection
  tools?: Tool[];
  resources?: Resource[];
  resourceTemplates?: ResourceTemplate[];
  prompts?: Prompt[];
  // Selected items for this tab
  selectedTool?: Tool | null;
  selectedResourceTemplate?: ResourceTemplate | null;
  selectedPrompt?: Prompt | null;
  // Parameters for this tab
  toolParams?: Record<string, any>;
  resourceArgs?: Record<string, any>;
  promptParams?: Record<string, any>;
  // Result share data for auto-execution
  resultShareData?: {
    type: 'tool' | 'resource';
    name: string;
    params?: Record<string, any>;
  };
  // Note: The client instance will be managed in a separate, non-serializable state
}
