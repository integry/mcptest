/**
 * Test CORS compatibility before attempting MCP connection
 */

export const testCorsCompatibility = async (serverUrl: string): Promise<{
  success: boolean;
  error?: string;
  supportsMcpHeaders: boolean;
}> => {
  try {
    // First test: Basic OPTIONS request without MCP headers
    const basicTest = await fetch(serverUrl, {
      method: 'OPTIONS',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      }
    });
    
    if (!basicTest.ok) {
      return {
        success: false,
        error: `Server returned ${basicTest.status}: ${basicTest.statusText}`,
        supportsMcpHeaders: false
      };
    }
    
    // Check if server allows MCP headers
    const allowedHeaders = basicTest.headers.get('Access-Control-Allow-Headers');
    const supportsMcpHeaders = allowedHeaders?.includes('mcp-protocol-version') ?? false;
    
    // Second test: Try with MCP headers if server supports them
    if (supportsMcpHeaders) {
      const mcpTest = await fetch(serverUrl, {
        method: 'OPTIONS',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-03-26'
        }
      });
      
      return {
        success: mcpTest.ok,
        error: mcpTest.ok ? undefined : `MCP headers rejected: ${mcpTest.status}`,
        supportsMcpHeaders: true
      };
    }
    
    return {
      success: true,
      supportsMcpHeaders: false
    };
    
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      supportsMcpHeaders: false
    };
  }
};