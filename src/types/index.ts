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

// Use 'any' for now until correct SDK types are confirmed/exported
export type SelectedTool = any;
export type ResourceTemplate = any;
