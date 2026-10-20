import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../types';
import {
  clearAllCallHistory,
  clearCallHistory,
  createCallHistoryEntry,
  loadCallHistory,
  recordCallHistoryEntry,
  replayArguments,
  type CallHistoryEntry,
} from '../utils/callHistory';
import {
  confirmedInterfaceSnapshot,
  createInterfaceSnapshot,
  INTERFACE_SECTIONS,
  loadPreviousInterfaceSnapshot,
  storeInterfaceSnapshot,
} from '../utils/interfaceSnapshot';
import { diffInterfaceSnapshots, type InterfaceDiff } from '../utils/reportDiff';
import type { DiscoveryStatus } from './useToolsAndResources';

interface PlaygroundHistoryInput {
  serverUrl: string;
  isConnected: boolean;
  tools: readonly any[];
  resources: readonly unknown[];
  resourceTemplates: readonly unknown[];
  prompts: readonly unknown[];
  /** Outcome of each list request; only `complete` lists prove membership. */
  discovery: DiscoveryStatus;
  protocolVersion?: string | null;
  transportType?: string | null;
  selectedTool: { name?: string } | null;
  toolParams: Record<string, unknown>;
  selectTool: (tool: any) => void;
  setToolParams: (params: Record<string, any>) => void;
  executeTool: () => void | Promise<void>;
}

const sameValue = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

export const usePlaygroundHistory = ({
  serverUrl,
  isConnected,
  tools,
  resources,
  resourceTemplates,
  prompts,
  discovery,
  protocolVersion,
  transportType,
  selectedTool,
  toolParams,
  selectTool,
  setToolParams,
  executeTool,
}: PlaygroundHistoryInput) => {
  const [calls, setCalls] = useState<CallHistoryEntry[]>(() => (serverUrl ? loadCallHistory(serverUrl) : []));
  const [interfaceDiff, setInterfaceDiff] = useState<InterfaceDiff | null>(null);
  const [diffDismissed, setDiffDismissed] = useState(false);
  const [pendingReplay, setPendingReplay] = useState<{ toolName: string; params: Record<string, unknown> } | null>(null);
  const executeRef = useRef(executeTool);
  executeRef.current = executeTool;

  useEffect(() => {
    setCalls(serverUrl ? loadCallHistory(serverUrl) : []);
  }, [serverUrl]);

  const recordCall = useCallback((
    toolName: string,
    args: Record<string, unknown>,
    result: LogEntry | null,
    durationMs: number
  ) => {
    if (!serverUrl) return;
    const entry = createCallHistoryEntry({ toolName, arguments: args, result, durationMs });
    setCalls(recordCallHistoryEntry(serverUrl, entry));
  }, [serverUrl]);

  const clearServerHistory = useCallback(() => {
    if (serverUrl) clearCallHistory(serverUrl);
    setCalls([]);
  }, [serverUrl]);

  const clearAllHistory = useCallback(() => {
    clearAllCallHistory();
    setCalls([]);
  }, []);

  /** Refills the form; runs the call too unless redaction removed argument values. */
  const replayCall = useCallback((entry: CallHistoryEntry, run = !entry.argumentsRedacted) => {
    const tool = tools.find((candidate) => candidate?.name === entry.toolName);
    if (!tool) return false;
    const params = replayArguments(entry);
    selectTool(tool);
    setToolParams(params);
    if (run) setPendingReplay({ toolName: entry.toolName, params });
    return true;
  }, [selectTool, setToolParams, tools]);

  // Run once the selection and refilled arguments have rendered, so the
  // executor reads the replayed state rather than the previous closure.
  useEffect(() => {
    if (!pendingReplay || selectedTool?.name !== pendingReplay.toolName) return;
    const refilled = Object.entries(pendingReplay.params)
      .every(([key, value]) => sameValue(toolParams[key], value));
    if (!refilled) return;
    setPendingReplay(null);
    void executeRef.current();
  }, [pendingReplay, selectedTool, toolParams]);

  // The baseline is read once per connection, before this visit overwrites it.
  const baselineRef = useRef<{ key: string; snapshot: ReturnType<typeof loadPreviousInterfaceSnapshot> } | null>(null);
  useEffect(() => {
    if (!isConnected || !serverUrl) {
      baselineRef.current = null;
      setInterfaceDiff(null);
      setDiffDismissed(false);
      return;
    }
    if (baselineRef.current?.key !== serverUrl) {
      baselineRef.current = { key: serverUrl, snapshot: loadPreviousInterfaceSnapshot(serverUrl) };
    }
    // Snapshot only once every list request has finished, from the lists that
    // completed; a failed or paginated list cannot prove what was removed.
    if (INTERFACE_SECTIONS.some((section) => discovery[section] === 'idle' || discovery[section] === 'loading')) return;
    const confirmed = new Set(INTERFACE_SECTIONS.filter((section) => discovery[section] === 'complete'));
    if (confirmed.size === 0) return;
    const baseline = baselineRef.current?.snapshot;
    const current = confirmedInterfaceSnapshot(createInterfaceSnapshot({
      tools, resources, resourceTemplates, prompts, protocolVersion, transport: transportType,
    }), confirmed, baseline);
    setInterfaceDiff(baseline ? diffInterfaceSnapshots(baseline, current) : null);
    storeInterfaceSnapshot(serverUrl, current);
  }, [isConnected, serverUrl, tools, resources, resourceTemplates, prompts, discovery, protocolVersion, transportType]);

  // Dismissal lasts for this connection; list refreshes keep the diff current underneath.
  const dismissInterfaceDiff = useCallback(() => setDiffDismissed(true), []);

  return {
    calls,
    recordCall,
    clearServerHistory,
    clearAllHistory,
    replayCall,
    interfaceDiff: diffDismissed ? null : interfaceDiff,
    dismissInterfaceDiff,
  };
};
