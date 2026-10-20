import type { LogEntry } from '../types';
import { checkToolOutputContract, recordOutputContractResult, type OutputContractTool } from './outputContract';

/**
 * Builds the playground log entry for a tools/call result. `data` keeps the
 * content blocks so existing rendering and dashboards behave as before; the
 * full result and its output-contract verdict travel in `toolCall`.
 */
export const createToolResultLogEntry = (
  tool: OutputContractTool,
  result: Record<string, unknown> & { content: unknown[] },
  callContext: NonNullable<LogEntry['callContext']>
): LogEntry => {
  const contract = checkToolOutputContract(tool, result);
  recordOutputContractResult(callContext.serverUrl, contract);
  return {
    type: 'tool_result',
    data: result.content,
    timestamp: new Date().toLocaleTimeString(),
    callContext,
    toolCall: {
      result,
      ...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {}),
      contract,
    },
  };
};
