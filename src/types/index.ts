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
  data: string;
  timestamp: string;
  eventId?: string | null;
  event?: string;
  id?: number | string;
  method?: string;
  params?: any;
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
