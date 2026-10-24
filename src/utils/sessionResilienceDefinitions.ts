import type { TransportDiagnosticRemediation } from '../types/transportDiagnostics';

export const SESSION_RESILIENCE_IDS = [
  'session.unknown-id', 'session.reinitialize', 'session.stickiness', 'session.delete',
] as const;
export type SessionResilienceId = typeof SESSION_RESILIENCE_IDS[number];

const remediation: TransportDiagnosticRemediation = {
  summary: 'Return HTTP 404 for unknown or expired session ids, allow a fresh initialize without an id, and keep session ownership durable across replicas. Use stateless HTTP when session state is unnecessary. DELETE may return 405; if accepted, invalidate the id.',
  hints: [
    { stack: 'TypeScript SDK', code: "// In your stateful /mcp router, before dispatching to a transport:\nconst id = req.headers['mcp-session-id'];\nif (id && !transports.has(id)) return res.status(404).end();\n// No id + initialize: create a NEW StreamableHTTPServerTransport.\n// A Map is process-local: use durable routing across replicas, or:\n// new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })" },
    { stack: 'Python SDK', code: '# If your tools do not require sessions:\nmcp = FastMCP("server", stateless_http=True, json_response=True)\napp = mcp.streamable_http_app()\n# Stateful deployments: preserve session ownership across workers.\n# Unknown/expired Mcp-Session-Id must return HTTP 404, not 400/401/500.' },
    { stack: 'Cloudflare Workers', code: "// Route a session consistently to its owning Durable Object.\n// McpAgent.serve('/mcp') from agents/mcp manages stateful transport.\n// In a custom router, distinguish unknown sessions from auth failures:\nif (sessionId && !knownSession) return new Response(null, { status: 404 });\n// Accepting DELETE must invalidate that session's durable state." },
  ],
};
const recoveryRemediation: TransportDiagnosticRemediation = {
  summary: 'Handle an initialize request without a session id as a fresh connection, even after another session has expired. Expose the new Mcp-Session-Id to browser clients.',
  hints: [
    { stack: 'TypeScript SDK', code: "// In the initialize branch, allocate a new transport and server instance:\nconst transport = new StreamableHTTPServerTransport({\n  sessionIdGenerator: () => randomUUID(),\n});\nawait server.connect(transport);\nawait transport.handleRequest(req, res, req.body);\n// Register its id in your router on session initialization." },
    { stack: 'Python SDK', code: '# Delegate initialization and session lifecycle to the SDK app:\nmcp = FastMCP("server")\napp = mcp.streamable_http_app()\n# Do not require an existing Mcp-Session-Id for initialize.\n# CORS: expose_headers=["Mcp-Session-Id", "MCP-Protocol-Version"]' },
    { stack: 'Cloudflare Workers', code: "// MyMCP extends McpAgent from agents/mcp.\nexport default MyMCP.serve('/mcp');\n// In a custom router, an id-free initialize allocates fresh durable\n// ownership; do not look it up using the previous expired id." },
  ],
};
const deletionRemediation: TransportDiagnosticRemediation = {
  summary: 'If DELETE is supported, invalidate session ownership and return 404 on later requests carrying the terminated id. Otherwise return the permitted 405 response.',
  hints: [
    { stack: 'TypeScript SDK', code: "app.delete('/mcp', async (req, res) => {\n  const id = req.headers['mcp-session-id'];\n  const transport = transports.get(id);\n  if (!transport) return res.status(404).end();\n  await transport.handleRequest(req, res);\n  if (res.statusCode >= 200 && res.statusCode < 300) transports.delete(id);\n});" },
    { stack: 'Python SDK', code: '# Let FastMCP manage HTTP DELETE and the session manager lifecycle:\napp = mcp.streamable_http_app()\n# For a custom app intentionally lacking termination support:\nif request.method == "DELETE":\n    return Response(status_code=405)' },
    { stack: 'Cloudflare Workers', code: "// In a custom handler, either invalidate durable ownership or\n// explicitly decline this optional operation:\nif (request.method === 'DELETE') {\n  return new Response(null, { status: 405, headers: { Allow: 'POST' } });\n}" },
  ],
};

export const SESSION_RESILIENCE_DEFINITIONS = {
  'session.unknown-id': { title: 'Unknown session id returns HTTP 404', explanation: 'Clients must re-initialize after HTTP 404. Other status codes can leave real clients retrying a dead session instead of creating a usable replacement.', remediation },
  'session.reinitialize': { title: 'Fresh initialize recovers after HTTP 404', explanation: 'Recovery requires initialize without Mcp-Session-Id to succeed and issue a fresh session id. Reusing stale ownership prevents clients from recovering after redeploys.', remediation: recoveryRemediation },
  'session.stickiness': { title: 'Session survives a small request burst', explanation: 'Eight sequential then four parallel ping requests sample session continuity. Loss is consistent with process-local sessions behind replicas or instance recycling; this does not prove the cause or simulate a redeploy. A clean sample cannot prove restart resilience.', remediation },
  'session.delete': { title: 'Deleted session id is rejected', explanation: 'An accepted DELETE must invalidate the session so later requests return HTTP 404. HTTP 405 is allowed and is only a warning.', remediation: deletionRemediation },
};
