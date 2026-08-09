import React from 'react';
import { Link } from 'react-router-dom';

const Troubleshooting: React.FC = () => {
  return (
    <div className="container-fluid py-4">
      <div className="row justify-content-center">
        <div className="col" style={{ maxWidth: '860px' }}>
          <h1 className="mb-4">Troubleshooting Remote MCP Servers</h1>

          <p className="lead">
            Start with the actual HTTP exchange: endpoint, status, response headers, protocol era, and
            JSON-RPC body. Most failures then collapse into one of six buckets—wrong URL, 2026 routing
            metadata, 2025 session state, CORS, streaming infrastructure, or authorization.
          </p>

          <h2 className="mt-5">The endpoint cannot be reached</h2>
          <p>
            Test the full published endpoint, not only the origin. A server may be mounted at{' '}
            <code>/mcp</code>, a tenant path, or a completely custom route. mcptest.io preserves an
            explicit path and tests it first; conventional <code>/mcp</code> and <code>/sse</code> paths
            are fallbacks. A bare origin returning 404 therefore says little about a custom endpoint.
          </p>
          <p>
            Use <code>curl -i</code> with the stateless discovery or stateful initialization request from
            the <Link to="/docs/testing-guide">testing guide</Link>. If neither reaches the application,
            check DNS, TLS, ingress path rewrites, request-size limits, and whether the process is bound
            to the forwarded port. A <code>401</code> or <code>403</code> proves the endpoint is reachable;
            it is an authentication outcome, not evidence that the server is stateful or broken.
          </p>

          <h2 className="mt-5">2026 discovery or requests fail</h2>
          <p>
            A <code>2026-07-28</code> server must implement <code>server/discover</code>, although clients
            do not have to call it before other operations. Each request must carry{' '}
            <code>io.modelcontextprotocol/protocolVersion</code> and{' '}
            <code>io.modelcontextprotocol/clientCapabilities</code> in <code>params._meta</code>. On HTTP,
            it also needs <code>MCP-Protocol-Version</code> and <code>Mcp-Method</code>; named calls need
            <code>Mcp-Name</code>. The header version and body version must match.
          </p>
          <p>
            If discovery succeeds but the next request gets 400, compare those fields character for
            character and inspect gateway logs. Proxies often drop unfamiliar headers unless they are
            explicitly allowed. If a gateway routes on <code>Mcp-Method</code> or <code>Mcp-Name</code>,
            verify it forwards the same request unchanged. Do not add <code>Mcp-Session-Id</code> or send
            an initialization notification on the 2026 path; both belong to the older lifecycle.
          </p>

          <h2 className="mt-5">2025 initialization or sessions fail</h2>
          <p>
            Revisions through <code>2025-11-25</code> begin with <code>initialize</code>, followed by{' '}
            <code>notifications/initialized</code>. If the response includes{' '}
            <code>Mcp-Session-Id</code>, preserve it exactly and attach it to the notification and every
            later request. The common symptoms are:
          </p>
          <ul>
            <li><strong>400 after initialization:</strong> the client lost the session ID, CORS hid it, or the server issued it too late.</li>
            <li><strong>Intermittent 404:</strong> session state is in one instance&apos;s memory and requests are reaching another, or the server expired the session.</li>
            <li><strong>Tabs affect one another:</strong> the server is keying state on IP or a global variable rather than the opaque session ID.</li>
            <li><strong>DELETE or GET returns 405:</strong> this can be valid because explicit termination and the standalone SSE stream are optional.</li>
          </ul>
          <p>
            A client should establish a new session after an expired-ID 404. A server should use secure,
            unpredictable IDs and either shared storage or deliberate affinity when it scales out.
          </p>

          <h2 className="mt-5">Works in curl, fails in a browser</h2>
          <p>
            That pattern is usually CORS. The browser&apos;s preflight must allow the app&apos;s origin and every
            non-simple header the chosen protocol and authentication mode use. For an Express server
            supporting both eras:
          </p>
          <pre className="bg-light p-3 rounded"><code>{`import cors from 'cors';

app.use(cors({
  origin: ['https://mcptest.io', 'http://localhost:5173'],
  allowedHeaders: [
    'Content-Type',
    'Accept',
    'Authorization',
    'x-api-key',
    'MCP-Protocol-Version',
    'Mcp-Method',
    'Mcp-Name',
    'Mcp-Session-Id',
    'Last-Event-ID'
  ],
  exposedHeaders: ['Mcp-Session-Id']
}));`}</code></pre>
          <p>
            Exposing <code>Mcp-Session-Id</code> matters only to stateful 2025 responses, but omitting it
            makes initialization appear successful while every later call fails. CORS does not replace
            authorization or MCP&apos;s origin checks. Keep the production origin list narrow and reject
            untrusted <code>Origin</code> values.
          </p>
          <p>
            If you use mcptest.io&apos;s optional proxy, sign-in authenticates the proxy itself. OAuth bearer
            tokens or API keys authenticate only the target MCP server. A 401 from the proxy and a 401
            from the target have different remedies; inspect the response and message log before
            refreshing target credentials.
          </p>

          <h2 className="mt-5">HTTP status decoder</h2>
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Likely meaning</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>400</code></td>
                  <td>Malformed transport request: 2026 metadata/header mismatch, missing routing header, invalid version header, or a missing required 2025 session ID.</td>
                </tr>
                <tr>
                  <td><code>401</code></td>
                  <td>Authentication is required or the token is invalid or expired. Inspect <code>WWW-Authenticate</code> and protected-resource metadata.</td>
                </tr>
                <tr>
                  <td><code>403</code></td>
                  <td>Origin rejected, token lacks scope, API key lacks permission, or a policy blocks this method or named capability.</td>
                </tr>
                <tr>
                  <td><code>404</code></td>
                  <td>Wrong route, or—when a 2025 session header is present—an expired or unknown session.</td>
                </tr>
                <tr>
                  <td><code>405</code></td>
                  <td>Wrong endpoint for POST. In the 2025 era it can be a valid answer to optional GET or DELETE.</td>
                </tr>
                <tr>
                  <td><code>406</code></td>
                  <td>The requested response media types are unsupported; 2025 Streamable HTTP clients offer JSON and SSE on POST.</td>
                </tr>
                <tr>
                  <td><code>202</code></td>
                  <td>Normal empty acceptance for a 2025 notification or client response, not a failure.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2 className="mt-5">SSE responses hang or arrive all at once</h2>
          <p>
            Reverse proxies and compression middleware commonly buffer SSE. Disable buffering on the
            route, avoid compressing event streams, and review idle timeouts from the application
            through the public ingress. Send correctly framed events and flush them after each message.
          </p>
          <p>
            Interpret disconnects by protocol era. In 2026, closing a per-request SSE response cancels
            that request, and continuing notifications use <code>subscriptions/listen</code>. In 2025,
            a dropped stream is not automatically cancellation; resumable servers may accept{' '}
            <code>Last-Event-ID</code>, and explicit <code>notifications/cancelled</code> carries client
            cancellation. Applying one era&apos;s rule to the other can create duplicate work or jobs that
            never stop.
          </p>

          <h2 className="mt-5">OAuth discovery or token exchange fails</h2>
          <p>
            After a 401, verify that <code>WWW-Authenticate</code> or the well-known URI leads to
            protected-resource metadata and that its authorization-server URLs are correct. Browser
            clients must also be able to read these metadata documents through CORS. Confirm the
            authorization server advertises PKCE <code>S256</code>, the redirect URI matches exactly,
            and the client sends the RFC 8707 <code>resource</code> value for the canonical MCP URI.
          </p>
          <p>
            If login succeeds but the MCP endpoint rejects the token, compare issuer, audience,
            resource URI, expiry, and scopes. The 2026 authorization flow also validates the returned
            authorization issuer and must not reuse client credentials across issuers. Prefer Client ID
            Metadata Documents for new clients; Dynamic Client Registration is deprecated in 2026.
          </p>

          <h2 className="mt-5">JSON-RPC and capability errors</h2>
          <p>
            <code>-32700</code> means invalid JSON, <code>-32601</code> means the method is absent, and{' '}
            <code>-32602</code> means invalid parameters. If a server advertises tools, resources, or
            prompts but their list methods return method-not-found, fix the advertised capabilities.
            Tool input and execution failures that a model can correct should normally be returned as a
            tool result with <code>isError: true</code>; reserve protocol errors for protocol failures.
          </p>

          <h2 className="mt-5">Still stuck?</h2>
          <p>
            Capture the exact endpoint, negotiated era and version, JSON-RPC request and response, HTTP
            status, and headers—with secrets removed. Those five details are usually enough to isolate
            the failing layer. Compare the exchange with the{' '}
            <a href="https://modelcontextprotocol.io/specification/2026-07-28" target="_blank" rel="noopener noreferrer">current specification</a>,{' '}
            the <a href="https://modelcontextprotocol.io/specification/2025-11-25" target="_blank" rel="noopener noreferrer">2025 compatibility specification</a>, and the official SDK&apos;s{' '}
            <a href="https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md" target="_blank" rel="noopener noreferrer">negotiation guide</a>.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Troubleshooting;
