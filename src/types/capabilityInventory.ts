export const CAPABILITY_INVENTORY_VERSION = 1 as const;

export type CapabilityInventoryStatus =
  | 'complete'
  | 'partial'
  | 'unsupported'
  | 'unavailable';

export interface CapabilityInventoryArgumentV1 {
  name: string;
  type?: string;
  description?: string;
  required: boolean;
}

export interface CapabilityInventoryToolV1 {
  name: string;
  description?: string;
  input?: CapabilityInventoryArgumentV1[];
}

export interface CapabilityInventoryResourceV1 {
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface CapabilityInventoryPromptV1 {
  name: string;
  description?: string;
  arguments?: CapabilityInventoryArgumentV1[];
}

export interface CapabilityInventorySectionV1<T> {
  status: CapabilityInventoryStatus;
  observedCount: number;
  retainedCount: number;
  omittedCount: number;
  paginationComplete: boolean;
  items: T[];
}

/** A deliberately small, public-safe projection of MCP discovery responses. */
export interface CapabilityInventoryV1 {
  version: typeof CAPABILITY_INVENTORY_VERSION;
  observedAt: string;
  provenance: {
    testedEndpoint: string;
    route: 'direct' | 'authenticated-proxy';
  };
  authentication: 'authenticated' | 'unauthenticated';
  tools: CapabilityInventorySectionV1<CapabilityInventoryToolV1>;
  resources: CapabilityInventorySectionV1<CapabilityInventoryResourceV1>;
  resourceTemplates: CapabilityInventorySectionV1<CapabilityInventoryResourceV1>;
  prompts: CapabilityInventorySectionV1<CapabilityInventoryPromptV1>;
}

export type CapabilityInventoryCategory =
  | 'tools'
  | 'resources'
  | 'resourceTemplates'
  | 'prompts';
