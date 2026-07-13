import React from 'react';
import { Link } from 'react-router-dom';

const Troubleshooting: React.FC = () => {
  return (
    <div className="container-fluid py-4">
      <div className="row justify-content-center">
        <div className="col" style={{ maxWidth: '860px' }}>
          <h1 className="mb-4">Troubleshooting Remote MCP Servers</h1>

          <p className="lead">
            Most remote MCP failures fall into a small number of categories: CORS, HTTP status
            mishandling, session lifecycle bugs, streaming infrastructure, and OAuth. This guide is
            organized by symptom. Throughout, the fastest diagnostic tool is your browser's network tab
            (or <code>curl -i</code>): look at the actual status code and headers before theorizing.
          </p>

          <h2 className="mt-5">The connection fails immediately</h2>
          <p>
            If the client cannot reach the server at all, work outward from the URL. The endpoint must
            be the full MCP endpoint path — servers built with the official SDKs typically serve
            at <code>/mcp</code>, and POSTing to the bare domain returns <code>404</code>. Verify with
            curl that the endpoint answers an <code>initialize</code> POST (see the{' '}
            <Link to="/docs/testing-guide">testing guide</Link> for the exact request). If curl works
            but the browser doesn't, it is almost always CORS — see the next section. If neither works,
            check TLS (browser clients require valid HTTPS certificates; self-signed certs fail
            silently in fetch), DNS, and whether the process is actually listening on the port your
            ingress forwards to.
          </p>
          <p>
            A <code>404</code> from a server you know is running can also mean the server is a legacy
            HTTP+SSE implementation (protocol <code>2024-11-05</code>). Spec-compliant clients,
            including this playground, react to a failed <code>initialize</code> POST by attempting a
            GET and looking for an <code>endpoint</code> SSE event. If your server is legacy and
            clients still can't connect, confirm the GET actually returns that event as its first
            message.
          </p>

          <h2 className="mt-5">Works in curl, fails in the browser: CORS</h2>
          <p>
            Browsers enforce the same-origin policy; curl does not. When a browser-based client (like
            this playground) calls your server, the browser first sends a
            preflight <code>OPTIONS</code> request, and it will only expose response headers that your
            server explicitly allows. The failure modes are distinctive: the network tab shows the
            request blocked or the preflight failing, and the console logs a CORS policy error while
            the server logs show nothing wrong.
          </p>
          <p>
            Three things must all be configured. The server must allow the client's origin; it must
            allow the request headers MCP uses; and — the one everyone misses — it must{' '}
            <em>expose</em> <code>Mcp-Session-Id</code> so the client can read it from the
            initialization response. If that header is not exposed, connection appears to succeed but
            every subsequent request fails with <code>400</code>, because the client never saw the
            session ID. An Express example:
          </p>
          <pre className="bg-light p-3 rounded"><code>{`import cors from 'cors';

app.use(cors({
  origin: ['https://mcptest.io', 'http://localhost:5173'],
  allowedHeaders: [
    'Content-Type', 'Accept', 'Authorization',
    'Mcp-Session-Id', 'MCP-Protocol-Version', 'Last-Event-ID'
  ],
  exposedHeaders: ['Mcp-Session-Id']
}));`}</code></pre>
          <p>
            Remember that CORS is a browser mechanism layered on top of MCP, not a substitute for the
            transport's own security rules: your server must still validate
            the <code>Origin</code> header and return <code>403</code> for origins it does not trust,
            which is the specification's defense against DNS rebinding.
          </p>

          <h2 className="mt-5">Decoding HTTP status codes</h2>
          <p>
            The Streamable HTTP transport assigns specific meanings to status codes, so an error status
            from a compliant server is a strong hint:
          </p>
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ whiteSpace: 'nowrap' }}>Status</th>
                  <th>Meaning in MCP terms</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>400</code></td>
                  <td>Malformed request — most often a missing <code>Mcp-Session-Id</code> header on a stateful server, or an invalid/unsupported <code>MCP-Protocol-Version</code> header.</td>
                </tr>
                <tr>
                  <td><code>401</code></td>
                  <td>Authorization required or the token is invalid/expired. The <code>WWW-Authenticate</code> header should point at the protected resource metadata; a client is expected to start (or redo) the OAuth flow.</td>
                </tr>
                <tr>
                  <td><code>403</code></td>
                  <td>The <code>Origin</code> header failed validation, or the token lacks required scopes (<code>error="insufficient_scope"</code> in <code>WWW-Authenticate</code>).</td>
                </tr>
                <tr>
                  <td><code>404</code></td>
                  <td>On a request carrying a session ID: the session has expired or been terminated. The correct client reaction is to re-initialize, not retry.</td>
                </tr>
                <tr>
                  <td><code>405</code></td>
                  <td>Normal for GET if the server offers no standalone SSE stream, and for DELETE if it doesn't support client-initiated session termination. Only a bug if POST itself returns it — then you're hitting the wrong path.</td>
                </tr>
                <tr>
                  <td><code>406</code></td>
                  <td>The <code>Accept</code> header is wrong. Clients must offer both <code>application/json</code> and <code>text/event-stream</code> on POST.</td>
                </tr>
                <tr>
                  <td><code>202</code></td>
                  <td>Not an error — the required response to notifications and client responses, with an empty body. Treating it as a failure (or returning a body with it) is a client/server bug respectively.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2 className="mt-5">Session problems</h2>
          <p>
            The session contract trips up hand-rolled servers. Symptoms and causes: every request after
            initialization returns <code>400</code> — the client isn't sending the session header back,
            usually because CORS hides it (see above) or because the server expects it on
            the <code>initialized</code> notification but assigned it too late. Requests randomly start
            failing with <code>404</code> mid-session — the server expired the session (restart,
            deployment, in-memory session store behind a load balancer without sticky routing); the
            client must transparently re-initialize. Two browser tabs interfere with each other — the
            server is keying sessions on something other than the session ID, such as the client IP.
            When running multiple server instances, session state must live somewhere shared (or use
            sticky sessions), or every scaled-out deployment becomes an intermittent <code>404</code>{' '}
            generator.
          </p>

          <h2 className="mt-5">Streaming and SSE issues</h2>
          <p>
            When tool calls hang, progress notifications never arrive, or responses appear only when
            the connection closes, suspect the infrastructure between client and server before the
            server itself. Reverse proxies buffer by default: for nginx you
            need <code>proxy_buffering off</code> (or the server can send
            an <code>X-Accel-Buffering: no</code> header), and compression middleware must not gzip
            SSE responses — buffering plus compression means events sit in a buffer until the stream
            ends. Idle timeouts on proxies and load balancers will also sever long-lived streams;
            either raise them, send periodic keep-alive comments, or implement resumability so clients
            recover. Note that since protocol <code>2025-11-25</code>, servers may intentionally close
            SSE connections and expect clients to poll by reconnecting — a disconnect is not an error,
            and clients should reconnect with <code>Last-Event-ID</code> rather than surfacing a
            failure. Conversely, a client that disappears is not a cancellation: honor
            explicit <code>notifications/cancelled</code> messages instead of tying work to connection
            lifetime.
          </p>

          <h2 className="mt-5">OAuth and authorization failures</h2>
          <p>
            Because the MCP authorization flow is discovery-driven, most failures happen before any
            login screen appears. If a client reports it cannot find authorization details after
            a <code>401</code>, check that your protected resource metadata is actually reachable:
            either the <code>WWW-Authenticate</code> header carries a valid <code>resource_metadata</code>{' '}
            URL, or the well-known document exists
            (<code>/.well-known/oauth-protected-resource</code>, optionally suffixed with the MCP
            endpoint path) and lists your authorization server in <code>authorization_servers</code>.
            The metadata endpoints themselves must be CORS-readable for browser clients — a common gap,
            since they are often served by an auth library that doesn't share the MCP endpoint's CORS
            configuration.
          </p>
          <p>
            If discovery succeeds but the flow fails, the classic OAuth errors apply, each with an MCP
            twist. <code>invalid_client</code> or a rejected registration usually means the
            authorization server supports neither Dynamic Client Registration nor Client ID Metadata
            Documents, leaving clients no way to identify themselves without
            pre-registration. <code>redirect_uri_mismatch</code> means the client's callback URL isn't
            registered. A client refusing to proceed because PKCE support is not advertised means your
            authorization server metadata omits <code>code_challenge_methods_supported</code> — clients
            are required to abort in that case. And if the flow completes but the MCP server still
            rejects the token, check audience validation from both directions: the client must send
            the RFC 8707 <code>resource</code> parameter naming your server's canonical URI, and your
            server must be validating tokens against that same identifier. Mismatched canonical URIs
            (trailing slashes, http vs. https, missing path) are a frequent silent culprit.
          </p>

          <h2 className="mt-5">Protocol-level errors</h2>
          <p>
            JSON-RPC error codes surface application-level problems: <code>-32700</code> means the
            server couldn't parse your JSON, <code>-32601</code> means the method doesn't exist (often
            a capability the server advertises but never implemented — compare
            the <code>initialize</code> result against reality), and <code>-32602</code> flags invalid
            parameters. One subtlety worth fixing on the server side: a tool that receives bad
            arguments should generally return a successful JSON-RPC response whose result
            has <code>isError: true</code> and a descriptive message, rather than a protocol error —
            execution errors are visible to the model, which lets it correct its own tool call, while
            protocol errors are not. Version mismatches show up as failed initialization: a compliant
            server counters with the newest version it supports when it doesn't support the client's,
            and only fails if there is genuinely no overlap, while missing <code>MCP-Protocol-Version</code>{' '}
            headers on later requests make servers assume <code>2025-03-26</code> — which can
            mysteriously disable newer features.
          </p>

          <h2 className="mt-5">Still stuck?</h2>
          <p>
            Reproduce the failure in the playground with the message log open — the raw request and
            response usually identify the failing layer immediately. For protocol questions, the{' '}
            <a href="https://modelcontextprotocol.io/specification/2025-11-25" target="_blank" rel="noopener noreferrer">specification</a>{' '}
            is precise and readable, and the{' '}
            <a href="https://github.com/orgs/modelcontextprotocol/discussions" target="_blank" rel="noopener noreferrer">community discussions</a>{' '}
            cover most edge cases that aren't. When filing a bug against a server or SDK, include the
            exact JSON-RPC messages, HTTP status codes and headers, and the protocol version negotiated
            at initialization — with those three things, most MCP issues are diagnosable on sight.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Troubleshooting;
