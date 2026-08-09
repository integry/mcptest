import React from 'react';
import { Link } from 'react-router-dom';

const TestingGuide: React.FC = () => {
  return (
    <div className="container-fluid py-4">
      <div className="row justify-content-center">
        <div className="col" style={{ maxWidth: '860px' }}>
          <h1 className="mb-4">Testing Remote MCP Servers</h1>

          <p className="lead">
            A useful MCP test proves more than reachability. It identifies the protocol era, validates
            HTTP and JSON-RPC behavior, exercises every advertised capability, checks authentication,
            and confirms failures are safe and actionable. This guide covers stateless 2026 servers and
            the stateful 2025 servers still widely deployed.
          </p>

          <h2 className="mt-5">Start with the exact endpoint</h2>
          <p>
            Use the complete published MCP URL, including its path, for example{' '}
            <code>https://your-server.example.com/custom/mcp</code>. mcptest.io tries that exact URL
            first, then conventional path fallbacks only when needed. A valid auth challenge means the
            service is reachable but does not, by itself, prove that anonymous MCP negotiation passed.
          </p>

          <h2 className="mt-5">Interactive testing in the playground</h2>
          <p>
            Enter the endpoint and connect. The playground first probes with{' '}
            <code>server/discover</code>. If the server offers <code>2026-07-28</code>, the client uses
            stateless, self-describing requests. If the endpoint is 2025-only, it falls back to{' '}
            <code>initialize</code>, sends <code>notifications/initialized</code>, and preserves a
            server-issued <code>Mcp-Session-Id</code>. The deprecated HTTP+SSE transport is the last
            fallback. Authentication responses are surfaced instead of being misclassified as an old
            protocol.
          </p>
          <p>
            Check the connection log before testing features. For a stateless server, confirm the
            negotiated version and that discovery capabilities match reality. For a stateful server,
            confirm the initialization result, selected version, capabilities, and any session header.
            The same client API then lists and invokes capabilities in either era.
          </p>

          <h3 className="mt-4">Capabilities</h3>
          <ul>
            <li><strong>Tools:</strong> inspect every input schema, call each tool with representative valid input, and compare structured output with its declared schema.</li>
            <li><strong>Negative tool calls:</strong> try missing required fields, wrong types, bounds, unexpected properties, unusual Unicode, and large inputs. Recoverable tool failures should normally return a tool result with <code>isError: true</code>, not crash the transport.</li>
            <li><strong>Resources:</strong> list and read several URIs; verify MIME types, text versus base64 content, templates, pagination, and authorization boundaries.</li>
            <li><strong>Prompts:</strong> list templates, exercise required and optional arguments, and verify the returned messages and roles.</li>
            <li><strong>2026 caches:</strong> where list results provide <code>ttlMs</code> and <code>cacheScope</code>, verify they reflect the data&apos;s real freshness and privacy boundary.</li>
            <li><strong>2026 multi-round trips:</strong> exercise calls that return <code>input_required</code>, then verify the retried request carries the expected <code>inputResponses</code> and request state.</li>
          </ul>

          <h3 className="mt-4">Authentication</h3>
          <p>
            For OAuth servers, start without credentials. A correct <code>401</code> should lead to
            protected-resource metadata, authorization-server metadata, client identification, and an
            authorization-code flow with PKCE. Verify the client selection order: a pre-registered
            client first, a Client ID Metadata Document when the server advertises support, and Dynamic
            Client Registration only as a legacy fallback. After sign-in, verify that the token is
            accepted only by its intended MCP resource and that insufficient scopes produce a useful{' '}
            <code>403</code> challenge. For provider-specific servers, select bearer token or API key
            and verify both valid and invalid credentials.
          </p>

          <div className="alert alert-info mt-4" role="alert">
            <strong>Browser clients need CORS.</strong> Allow <code>Content-Type</code>,{' '}
            <code>Accept</code>, <code>Authorization</code>, <code>x-api-key</code>,{' '}
            <code>MCP-Protocol-Version</code>, <code>Mcp-Method</code>, and <code>Mcp-Name</code>. For
            stateful 2025 support, also allow <code>Mcp-Session-Id</code> and{' '}
            <code>Last-Event-ID</code>, and expose <code>Mcp-Session-Id</code> in responses.
          </div>

          <h2 className="mt-5">Command-line check: stateless 2026</h2>
          <p>
            A 2026 server must implement <code>server/discover</code>. The client call is optional, but
            it is the clearest compatibility probe. Include the version and method headers plus the
            required per-request metadata:
          </p>
          <pre className="bg-light p-3 rounded"><code>{`curl -i https://your-server.example.com/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "MCP-Protocol-Version: 2026-07-28" \\
  -H "Mcp-Method: server/discover" \\
  -d '{
    "jsonrpc": "2.0",
    "id": "discover-1",
    "method": "server/discover",
    "params": {
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": {
          "name": "curl-check",
          "version": "1.0.0"
        },
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }'`}</code></pre>
          <p>
            A successful result advertises supported versions and capabilities. There is no initialized
            notification and no session header to retain. Test an ordinary request independently:
          </p>
          <pre className="bg-light p-3 rounded"><code>{`curl -i https://your-server.example.com/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "MCP-Protocol-Version: 2026-07-28" \\
  -H "Mcp-Method: tools/list" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }'`}</code></pre>
          <p>
            For <code>tools/call</code>, add <code>Mcp-Name: &lt;tool-name&gt;</code>. Do the same with the
            resource URI for <code>resources/read</code> and prompt name for <code>prompts/get</code>.
            Confirm a missing method header, a missing required name header, or a mismatch between the
            header and body metadata is rejected rather than silently routed.
          </p>

          <h2 className="mt-5">Command-line check: stateful 2025</h2>
          <p>
            A 2025-only server begins with initialization. Keep <code>-i</code> so the response headers
            reveal whether it issued a session ID:
          </p>
          <pre className="bg-light p-3 rounded"><code>{`curl -i https://your-server.example.com/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-11-25",
      "capabilities": {},
      "clientInfo": { "name": "curl-check", "version": "1.0.0" }
    }
  }'`}</code></pre>
          <p>
            Complete the handshake and carry the negotiated version and session ID on later requests:
          </p>
          <pre className="bg-light p-3 rounded"><code>{`# Use the Mcp-Session-Id returned above when the server issued one.
curl -i https://your-server.example.com/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "MCP-Protocol-Version: 2025-11-25" \\
  -H "Mcp-Session-Id: $SESSION_ID" \\
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

curl -i https://your-server.example.com/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "MCP-Protocol-Version: 2025-11-25" \\
  -H "Mcp-Session-Id: $SESSION_ID" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'`}</code></pre>
          <p>
            Omit the session header entirely when the server did not issue one; do not send a literal
            empty value. On a stateful implementation, verify missing IDs return 400, unknown or expired
            IDs return 404, optional GET and DELETE return either their documented behavior or 405, and
            concurrent sessions never leak data into one another.
          </p>

          <h2 className="mt-5">Failure and production checks</h2>
          <ul>
            <li>Malformed JSON returns JSON-RPC <code>-32700</code>; an unknown method returns <code>-32601</code> instead of an empty body or generic 500.</li>
            <li>An unsupported version produces a protocol-specific error; 2026 header/body mismatches produce <code>400</code>.</li>
            <li>An invalid <code>Origin</code> is rejected, while approved browser origins pass preflight with the exact headers they need.</li>
            <li>Tokens are audience- and scope-checked, secrets are absent from logs and URLs, and rate limits apply at both endpoint and tool level.</li>
            <li>Concurrent calls, cancellation, proxy timeouts, SSE buffering, deploys, and instance scaling do not corrupt state or duplicate side effects.</li>
            <li>List ordering and cache hints remain deterministic; schema changes trigger the appropriate refresh behavior.</li>
          </ul>

          <p className="mt-4">
            The official <a href="https://github.com/modelcontextprotocol/inspector" target="_blank" rel="noopener noreferrer">MCP Inspector</a>{' '}
            is a useful second client, especially for stdio. For wire-level expectations use the{' '}
            <a href="https://modelcontextprotocol.io/specification/2026-07-28" target="_blank" rel="noopener noreferrer">current specification</a>{' '}
            and the TypeScript SDK&apos;s{' '}
            <a href="https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md" target="_blank" rel="noopener noreferrer">protocol-version guide</a>.
            When a check fails, continue to <Link to="/docs/troubleshooting">troubleshooting</Link>.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TestingGuide;
