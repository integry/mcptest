declare const workerCapabilities: {
  capabilitiesPath: string;
  workerCapabilitiesPath: string;
  projectWorkerCapabilities(capabilities: Record<string, unknown>): Record<string, unknown>;
  serializeWorkerCapabilities(capabilities: Record<string, unknown>): string;
  writeWorkerCapabilities(capabilities: Record<string, unknown>, outputPath?: string): void;
};
export = workerCapabilities;
