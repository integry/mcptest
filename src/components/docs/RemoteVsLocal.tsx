import React from 'react';
import { Link } from 'react-router-dom';

const RemoteVsLocal: React.FC = () => {
  return (
    <div className="container-fluid py-4">
      <div className="row justify-content-center">
        <div className="col" style={{ maxWidth: '860px' }}>
          <h1 className="mb-4">Remote vs. Local MCP Servers</h1>

          <p className="lead">
            MCP&apos;s standard transports are stdio for a server launched on the user&apos;s machine and
            Streamable HTTP for an independently deployed service. Remote MCP now spans two lifecycle
            eras: sessionless requests in <code>2026-07-28</code> and the stateful handshake used by
            every earlier stable revision. A compatible client and a production server need to be
            explicit about which behavior they are using.
          </p>

          <h2 className="mt-5">Local servers: stdio</h2>
          <p>
            With stdio, the client launches the server as a subprocess and exchanges newline-delimited
            JSON-RPC through standard input and output. Nothing except valid MCP messages may be written
            to stdout; diagnostic logging belongs on stderr. This transport is a strong fit for local
            files, developer tools, or anything that should have no network-facing endpoint.
          </p>
          <p>
            Process lifetime supplies a natural isolation boundary. Credentials usually arrive through
            the environment, and each client gets its own process. The trade-offs are installation and
            runtime requirements on the user&apos;s machine, one process per client, and no shared hosted
            endpoint. Stdio can carry either protocol era when the SDK supports it; “local” does not by
            itself mean “legacy.”
          </p>

          <h2 className="mt-5">Remote servers: Streamable HTTP</h2>
          <p>
            A remote server exposes one exact MCP endpoint, such as{' '}
            <code>https://example.com/mcp</code>. The endpoint accepts JSON-RPC requests over HTTP POST
            and can answer with <code>application/json</code> or a per-request{' '}
            <code>text/event-stream</code> response. One deployment can serve many clients and can sit
            behind standard gateways, authentication services, and load balancers.
          </p>

          <h3 className="mt-4">2026 stateless flow</h3>
          <p>
            In <code>2026-07-28</code>, every request stands alone. There is no{' '}
            <code>initialize</code> / <code>notifications/initialized</code> handshake and no{' '}
            <code>Mcp-Session-Id</code>. A server must implement <code>server/discover</code>, while a
            client may call it to learn the supported versions and capabilities before normal work.
            The official SDK&apos;s automatic mode uses that call as an era probe.
          </p>
          <p>
            Every request includes its protocol version and client capabilities in{' '}
            <code>params._meta</code>. Streamable HTTP also requires{' '}
            <code>MCP-Protocol-Version</code> and <code>Mcp-Method</code> headers; named operations such
            as <code>tools/call</code>, <code>resources/read</code>, and <code>prompts/get</code> also
            require <code>Mcp-Name</code>. The header version must match the body metadata. This design
            lets a gateway route, authorize, and meter a call before parsing the JSON body, and lets any
            healthy server instance handle any request.
          </p>
          <p>
            A POST request may still receive an SSE response while work runs. For continuing change
            notifications, 2026 uses the <code>subscriptions/listen</code> request instead of the old
            standalone GET stream. Closing a per-request SSE response cancels that request. Interactive
            tool flows use multi-round-trip <code>input_required</code> results and retries instead of
            server-initiated requests on a permanently open connection.
          </p>

          <h3 className="mt-4">2025 stateful flow</h3>
          <p>
            Revisions through <code>2025-11-25</code> start with an <code>initialize</code> POST. The
            server returns the selected protocol version, capabilities, and server identity; the client
            acknowledges with <code>notifications/initialized</code>. A server that wants transport
            state also returns <code>Mcp-Session-Id</code>. The client must then include that opaque ID
            and the negotiated <code>MCP-Protocol-Version</code> on later requests.
          </p>
          <ul>
            <li>A missing required session ID normally produces <code>400 Bad Request</code>.</li>
            <li>An expired or unknown session ID produces <code>404 Not Found</code>; the client creates a fresh connection rather than retrying the stale session.</li>
            <li>A client may send DELETE with the session header to terminate it; a server that does not support explicit termination may answer <code>405 Method Not Allowed</code>.</li>
            <li>A separate GET may open a server-to-client SSE stream. Returning <code>405</code> is valid when that optional stream is unsupported.</li>
          </ul>
          <p>
            Session IDs must be secure, unpredictable, and kept out of URLs and logs. Stateful servers
            deployed across instances need shared session storage or correct affinity; otherwise users
            see intermittent 404 responses as calls land on different instances.
          </p>

          <h3 className="mt-4">Streaming and compatibility</h3>
          <p>
            For 2025 Streamable HTTP, clients send an <code>Accept</code> header offering both{' '}
            <code>application/json</code> and <code>text/event-stream</code>. A JSON-RPC request can
            receive one JSON response or an SSE stream that eventually contains it. Notifications and
            client responses normally receive <code>202 Accepted</code> with no body. SSE event IDs and
            <code>Last-Event-ID</code> support resumption where the server offers it.
          </p>
          <p>
            The original <code>2024-11-05</code> HTTP+SSE transport uses two endpoints: a client opens
            a GET stream, receives an <code>endpoint</code> event, and sends messages to the advertised
            POST URL. It is deprecated, but mcptest.io keeps it as a final fallback for deployed servers.
            An explicit URL is always tested before conventional path guesses such as <code>/mcp</code>
            or <code>/sse</code>.
          </p>

          <h2 className="mt-5">Authorization</h2>
          <p>
            Remote MCP authorization uses the OAuth 2.1 resource-server model. A protected MCP endpoint
            returns <code>401 Unauthorized</code> and points the client to protected-resource metadata.
            That metadata names the authorization server; the client discovers its metadata, identifies
            itself, and runs authorization code with PKCE and an RFC 8707 <code>resource</code> value
            bound to the MCP server.
          </p>
          <p>
            Servers must validate issuer, audience, expiry, and scopes rather than accepting any token
            that happens to be structurally valid. The 2026 revision requires authorization-response
            issuer validation when an <code>iss</code> value is returned, binds client credentials to
            their issuer, and deprecates Dynamic Client Registration in favor of Client ID Metadata
            Documents. Bearer tokens belong in the <code>Authorization</code> header, never a query
            string, and an MCP server must not pass a client token through to an unrelated upstream API.
          </p>
          <p>
            mcptest.io supports discovered OAuth with PKCE as well as explicit bearer tokens and API
            keys for servers that use provider-specific authentication. When its optional CORS proxy is
            enabled, Firebase authenticates the proxy hop and the target credential is carried through
            a separate internal header; the two trust boundaries are not conflated.
          </p>

          <h2 className="mt-5">CORS and origin security</h2>
          <p>
            A browser client needs the server to allow <code>Content-Type</code>, <code>Accept</code>,{' '}
            <code>Authorization</code>, <code>x-api-key</code>, <code>MCP-Protocol-Version</code>,{' '}
            <code>Mcp-Method</code>, and <code>Mcp-Name</code>. A 2025 stateful endpoint must additionally
            allow <code>Mcp-Session-Id</code> and <code>Last-Event-ID</code>, and expose{' '}
            <code>Mcp-Session-Id</code> so browser code can read it. Only allow the headers and origins
            your deployment actually uses.
          </p>
          <p>
            CORS is a browser control, not MCP authorization. Remote servers must still validate the
            incoming <code>Origin</code> and reject disallowed origins. Local HTTP servers should bind to
            loopback rather than all interfaces. Production endpoints need HTTPS, rate limits, careful
            credential redaction, request-size limits, and tool-level authorization.
          </p>

          <h2 className="mt-5">Choosing and testing a deployment</h2>
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Aspect</th>
                  <th>stdio</th>
                  <th>HTTP 2026</th>
                  <th>HTTP 2025</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Process model</td>
                  <td>Usually one subprocess per client</td>
                  <td>Shared service; any request can reach any instance</td>
                  <td>Shared service; sessions may require storage or affinity</td>
                </tr>
                <tr>
                  <td>Lifecycle</td>
                  <td>Depends on negotiated era</td>
                  <td>Self-describing requests; optional discovery</td>
                  <td>Initialize once; retain negotiated state</td>
                </tr>
                <tr>
                  <td>Credentials</td>
                  <td>Usually environment or host-managed</td>
                  <td colSpan={2}>OAuth bearer token, API key, or public endpoint</td>
                </tr>
                <tr>
                  <td>Best fit</td>
                  <td>Local files and developer tooling</td>
                  <td>New scalable hosted services</td>
                  <td>Compatibility with deployed clients and servers</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4">
            New hosted servers should implement the stateless 2026 lifecycle. Supporting the stateful
            era as well broadens compatibility, but its session contract must remain isolated from the
            2026 path. Continue with the <Link to="/docs/testing-guide">testing guide</Link> to test
            both, or use <Link to="/docs/troubleshooting">troubleshooting</Link> when negotiation fails.
          </p>
          <p>
            Normative references: the{' '}
            <a href="https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http" target="_blank" rel="noopener noreferrer">2026 Streamable HTTP transport</a>,{' '}
            <a href="https://modelcontextprotocol.io/specification/2025-11-25/basic/transports" target="_blank" rel="noopener noreferrer">2025 transport</a>, and{' '}
            <a href="https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization" target="_blank" rel="noopener noreferrer">current authorization specification</a>.
          </p>
        </div>
      </div>
    </div>
  );
};

export default RemoteVsLocal;
