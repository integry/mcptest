/**
 * Helper to generate unique IDs for JSON-RPC requests
 */
let jsonRpcId = 1;
export const nextJsonRpcId = () => jsonRpcId++;

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