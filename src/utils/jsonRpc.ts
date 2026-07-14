// Helper to generate unique IDs for JSON-RPC requests
let jsonRpcId = 1;

export const nextJsonRpcId = () => jsonRpcId++;
