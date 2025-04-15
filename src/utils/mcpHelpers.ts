/**
 * Helper to generate unique IDs for JSON-RPC requests
 */
let jsonRpcId = 1;
export const nextJsonRpcId = () => jsonRpcId++;

/**
 * Helper to parse SSE lines
 */
export function processSSELine(
  line: string,
  currentEvent: { id: string | null; event: string; data: string }
) {
  if (line.startsWith('id:')) {
    currentEvent.id = line.substring(3).trim();
  } else if (line.startsWith('event:')) {
    currentEvent.event = line.substring(6).trim();
  } else if (line.startsWith('data:')) {
    const dataLine = line.substring(5).trim();
    currentEvent.data = currentEvent.data ? `${currentEvent.data}\n${dataLine}` : dataLine;
  } else if (line === '') {
    if (currentEvent.data) {
      const eventToDispatch = { ...currentEvent };
      currentEvent.data = '';
      currentEvent.event = 'message';
      return eventToDispatch;
    }
    currentEvent.event = 'message';
  }
  return null;
}

/**
 * Helper to parse URI Template arguments
 */
export function parseUriTemplateArgs(templateString: string): string[] {
  if (!templateString) return [];
  const args: Set<string> = new Set();
  const regex = /\{(\??)([^}]+)\}/g;
  let match;
  while ((match = regex.exec(templateString)) !== null) {
    const params = match[2].split(',');
    params.forEach(param => args.add(param.trim()));
  }
  return Array.from(args);
}