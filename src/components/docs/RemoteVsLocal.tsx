import React from 'react';
import { Link } from 'react-router-dom';

const RemoteVsLocal: React.FC = () => {
  return (
    <div className="container-fluid py-4">
      <div className="row justify-content-center">
        <div className="col" style={{ maxWidth: '860px' }}>
          <h1 className="mb-4">Remote vs. Local MCP Servers</h1>

          <p className="lead">
            MCP defines two standard transports: stdio, where the client launches the server as a local
            subprocess, and Streamable HTTP, where the server runs as an independent web service. Which
            one you implement shapes everything downstream — deployment, session handling, authentication,
            and security. This page explains both, with an emphasis on what it takes to build a correct
            remote server.
          </p>

          <h2 className="mt-5">Local servers: stdio</h2>
          <p>
            With the stdio transport, the client starts the server process itself and writes JSON-RPC
            messages to the server's standard input; the server replies on standard output. Messages are
            newline-delimited, must not contain embedded newlines, and nothing that is not a valid MCP
            message may be written to stdout — a stray <code>console.log</code> corrupts the stream,
            which is the single most common stdio bug. Logging belongs on stderr, which the client may
            capture or ignore.
          </p>
          <p>
            Stdio is the right choice when the server needs access to the user's machine (files, local
            tooling, dev environments) or when you want zero network surface. It requires no
            authentication — the process inherits the user's permissions — and has minimal latency. Its
            limits are structural: one client per process, the user must have the runtime installed,
            and there is nothing to share between users or devices. Credentials, when needed, come from
            the environment rather than from an OAuth flow.
          </p>

          <h2 className="mt-5">Remote servers: Streamable HTTP</h2>
          <p>
            A remote server exposes a single HTTP endpoint — the <strong>MCP endpoint</strong>, for
            example <code>https://example.com/mcp</code> — that supports both POST and GET. One server
            process serves many concurrent clients, which is what enables hosted, multi-tenant MCP
            services that work from any client, including browser-based ones like this playground.
            Streamable HTTP was introduced in protocol version <code>2025-03-26</code>, replacing the
            original HTTP+SSE transport (see the compatibility note below).
          </p>

          <h3 className="mt-4">Request flow</h3>
          <p>
            Every JSON-RPC message from the client is a new HTTP POST to the MCP endpoint, and the
            client must send an <code>Accept</code> header listing
            both <code>application/json</code> and <code>text/event-stream</code>. How the server
            answers depends on the message:
          </p>
          <p>
            For a JSON-RPC <em>request</em>, the server chooses between two response modes. It can
            return <code>Content-Type: application/json</code> with the single JSON-RPC response — the
            simple case — or it can return <code>Content-Type: text/event-stream</code> and open an SSE
            stream. The streaming mode is what allows a server to send progress notifications, log
            messages, or even its own requests back to the client while a long tool call runs, before
            finally delivering the JSON-RPC response on the same stream. Clients must support both
            modes; servers should close the stream once the response has been sent.
          </p>
          <p>
            For a JSON-RPC <em>notification</em> or <em>response</em> (such
            as <code>notifications/initialized</code>), the server returns <code>202 Accepted</code>{' '}
            with no body.
          </p>
          <p>
            Separately, the client may issue a GET to the MCP endpoint to open a long-lived SSE stream
            for unsolicited server-to-client messages — resource change notifications, server-initiated
            requests, and so on. Supporting this GET stream is optional: a server that does not offer
            one must respond <code>405 Method Not Allowed</code>, and clients must tolerate that.
          </p>

          <h3 className="mt-4">Sessions</h3>
          <p>
            HTTP is stateless, so the transport defines an explicit session mechanism. A server that
            wants stateful sessions returns an <code>Mcp-Session-Id</code> header on the response to
            the <code>initialize</code> request. From then on the client must include that header on
            every request. The rest of the contract is precise, and worth testing directly:
          </p>
          <ul>
            <li>Requests missing a required session ID (other than initialization) get <code>400 Bad Request</code>.</li>
            <li>The server may expire a session at any time; requests with a stale ID get <code>404 Not Found</code>, and the client must react by starting a fresh session with a new <code>initialize</code> request.</li>
            <li>A client that is done with a session should send HTTP DELETE to the MCP endpoint with the session header; servers may refuse with <code>405</code> if they don't support explicit termination.</li>
          </ul>
          <p>
            Session IDs must be cryptographically secure and unguessable (a UUID from a secure random
            generator, for instance), and must contain only visible ASCII characters. Do not use
            sequential or predictable IDs — the session ID is a bearer credential for the session.
          </p>

          <h3 className="mt-4">The protocol version header</h3>
          <p>
            After initialization, the client must include <code>MCP-Protocol-Version:
            &lt;negotiated-version&gt;</code> (for example <code>2025-11-25</code>) on every HTTP
            request. If the header is missing, servers should assume <code>2025-03-26</code> for
            backwards compatibility; if it names an invalid or unsupported version, the server must
            respond <code>400 Bad Request</code>.
          </p>

          <h3 className="mt-4">Resumability</h3>
          <p>
            SSE connections drop — networks fail, proxies time out, and since protocol
            version <code>2025-11-25</code> servers may deliberately close a connection to avoid holding
            it open. To avoid losing messages, servers can attach an <code>id</code> to each SSE event.
            A client that reconnects sends the standard <code>Last-Event-ID</code> header on a GET, and
            the server replays the messages that were sent after that event on the disconnected stream.
            Disconnection is explicitly <em>not</em> cancellation: a client that wants to abort a
            request sends a <code>notifications/cancelled</code> message rather than just hanging up.
          </p>

          <h3 className="mt-4">Backwards compatibility: the deprecated HTTP+SSE transport</h3>
          <p>
            Protocol version <code>2024-11-05</code> used a two-endpoint design: the client opened an
            SSE stream via GET, received an <code>endpoint</code> event naming a separate POST URL, and
            sent all messages there. You will still encounter servers built this way. Clients detect
            the old transport by first POSTing an <code>initialize</code> request to the URL: if it
            fails with 4xx, they fall back to a GET expecting the <code>endpoint</code> event. This
            playground performs the same fallback automatically, so both generations of servers can be
            tested.
          </p>

          <h2 className="mt-5">Authorization</h2>
          <p>
            Authorization is optional in MCP, but any remote server exposing non-public data needs it.
            The specification standardizes on OAuth 2.1: the MCP server acts as
            a <strong>resource server</strong> that accepts Bearer tokens, and an authorization server —
            which may be the same deployment or a third-party identity provider — issues them. The flow
            a compliant client walks through is fully discoverable, with no manual configuration:
          </p>
          <ol>
            <li>The client makes an unauthenticated request and receives <code>401 Unauthorized</code>. The <code>WWW-Authenticate</code> header can point at the server's <strong>protected resource metadata</strong> (RFC 9728); otherwise the client falls back to the well-known URI, e.g. <code>/.well-known/oauth-protected-resource</code>.</li>
            <li>That metadata names one or more authorization servers. The client fetches the authorization server's own metadata via OAuth 2.0 Authorization Server Metadata (RFC 8414) or OpenID Connect Discovery.</li>
            <li>The client identifies itself — via a pre-registered client ID, an OAuth Client ID Metadata Document (an HTTPS URL serving the client's metadata, new in <code>2025-11-25</code>), or Dynamic Client Registration (RFC 7591).</li>
            <li>The client runs the authorization code flow with PKCE (the <code>S256</code> method is mandatory), including the RFC 8707 <code>resource</code> parameter that binds the requested token to this specific MCP server's canonical URI.</li>
            <li>Every subsequent request carries <code>Authorization: Bearer &lt;token&gt;</code> — on every request, never in the query string.</li>
          </ol>
          <p>
            On the server side, the non-negotiable rules are: serve protected resource metadata; validate
            that each token was issued <em>for you</em> (audience validation), not merely that it is
            valid; return <code>401</code> for missing or invalid tokens and <code>403</code> with
            an <code>insufficient_scope</code> challenge when a token lacks the scopes an operation
            needs; and never pass a token you received from a client through to an upstream API. Token
            passthrough is explicitly forbidden by the specification because it creates confused-deputy
            vulnerabilities.
          </p>
          <p>
            This playground implements the full client side of this flow — discovery, registration,
            PKCE, token refresh — which makes it a practical way to verify your authorization
            implementation end to end. See the <Link to="/docs/testing-guide">testing guide</Link> for
            the workflow.
          </p>

          <h2 className="mt-5">Security requirements</h2>
          <p>
            The transport specification imposes hard requirements on remote servers beyond
            authorization. Servers <strong>must</strong> validate the <code>Origin</code> header on all
            incoming connections and answer <code>403 Forbidden</code> when it is present and invalid;
            this is the defense against DNS-rebinding attacks, where a malicious web page tricks a
            browser into speaking to a server it shouldn't reach. Servers intended to run locally
            should bind to <code>127.0.0.1</code> rather than <code>0.0.0.0</code>. Production
            deployments must use HTTPS everywhere, keep tokens and session IDs out of logs and URLs,
            and apply rate limiting — an MCP endpoint that executes tools is a more attractive target
            than a typical JSON API.
          </p>
          <p>
            One practical consequence of MCP's browser reachability: if you want browser-based clients
            (including this one) to connect directly, your server must also send CORS headers, and it
            must expose the <code>Mcp-Session-Id</code> header to scripts
            via <code>Access-Control-Expose-Headers</code>. CORS is not part of the MCP specification —
            it is a browser requirement — but omitting it is one of the most common reasons a remote
            server "works in curl but not in the browser". The{' '}
            <Link to="/docs/troubleshooting">troubleshooting guide</Link> covers this in detail.
          </p>

          <h2 className="mt-5">Choosing a transport</h2>
          <p>
            The decision usually makes itself. If the server's job is to act on the user's own machine,
            use stdio. If the server fronts a shared service, an API, or data that lives on the
            network — or if you want users to connect without installing anything — build a remote
            server on Streamable HTTP. Many production systems do both: a thin stdio server for local
            development and a hosted Streamable HTTP deployment for everyone else, sharing the same tool
            implementations behind the transport layer.
          </p>
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Aspect</th>
                  <th>stdio (local)</th>
                  <th>Streamable HTTP (remote)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Process model</td>
                  <td>Subprocess per client</td>
                  <td>One service, many clients</td>
                </tr>
                <tr>
                  <td>Message framing</td>
                  <td>Newline-delimited JSON-RPC on stdin/stdout</td>
                  <td>JSON-RPC over HTTP POST, responses as JSON or SSE</td>
                </tr>
                <tr>
                  <td>Sessions</td>
                  <td>Implicit in the process lifetime</td>
                  <td><code>Mcp-Session-Id</code> header, explicit lifecycle</td>
                </tr>
                <tr>
                  <td>Authentication</td>
                  <td>Environment credentials</td>
                  <td>OAuth 2.1 Bearer tokens</td>
                </tr>
                <tr>
                  <td>Server-initiated messages</td>
                  <td>Written to stdout at any time</td>
                  <td>SSE streams (per-request or via GET)</td>
                </tr>
                <tr>
                  <td>Main security concerns</td>
                  <td>Runs with the user's full permissions</td>
                  <td>Origin validation, token audience, CORS, rate limiting</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-4">
            For the normative details, see the specification's{' '}
            <a href="https://modelcontextprotocol.io/specification/2025-11-25/basic/transports" target="_blank" rel="noopener noreferrer">transports</a>{' '}
            and{' '}
            <a href="https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization" target="_blank" rel="noopener noreferrer">authorization</a>{' '}
            chapters. To validate a server against everything described here, continue to the{' '}
            <Link to="/docs/testing-guide">testing guide</Link>.
          </p>
        </div>
      </div>
    </div>
  );
};

export default RemoteVsLocal;
