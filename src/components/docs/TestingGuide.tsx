import React from 'react';
import { Link } from 'react-router-dom';

const TestingGuide: React.FC = () => {
  return (
    <div className="container-fluid py-4">
      <div className="row justify-content-center">
        <div className="col" style={{ maxWidth: '860px' }}>
          <h1 className="mb-4">Testing Remote MCP Servers</h1>

          <p className="lead">
            A remote MCP server is only correct if a real client can walk the full protocol against it:
            negotiate a session, discover capabilities, execute tools, and fail cleanly when given bad
            input. This guide describes that verification process — first interactively with the
            playground on this site, then from the command line for scripting and CI.
          </p>

          <h2 className="mt-5">What you are actually verifying</h2>
          <p>
            Testing an MCP server is not just "does it respond". A server that answers requests can
            still break clients by mishandling sessions, advertising capabilities it doesn't implement,
            returning malformed tool results, or omitting the HTTP behaviors the transport specification
            requires. A useful test pass covers four layers: the <strong>transport contract</strong>{' '}
            (HTTP methods, headers, status codes, streaming), the <strong>protocol lifecycle</strong>{' '}
            (initialization, version negotiation, session management), the <strong>capabilities</strong>{' '}
            themselves (tools, resources, prompts and their schemas), and <strong>failure behavior</strong>{' '}
            (invalid input, expired sessions, missing auth). The sections below work through each.
          </p>

          <h2 className="mt-5">Interactive testing with the playground</h2>
          <p>
            Enter your server's MCP endpoint URL (for
            example <code>https://your-server.example.com/mcp</code>) in the playground and connect.
            The playground is a spec-compliant Streamable HTTP client running in your browser: it sends
            the <code>initialize</code> request with the proper <code>Accept</code> headers, completes
            the handshake with <code>notifications/initialized</code>, captures
            the <code>Mcp-Session-Id</code> header if your server issues one, and attaches the
            negotiated <code>MCP-Protocol-Version</code> to every subsequent request. If the endpoint
            turns out to be a legacy HTTP+SSE server (protocol <code>2024-11-05</code>), it falls back
            to that transport automatically. Every request and response is shown in the message log, so
            you can inspect the exact JSON-RPC traffic rather than guessing at what happened.
          </p>
          <p>
            The first thing to check after connecting is the initialization result: does the server
            report the protocol version you expect, and does its advertised capability set match what
            it actually implements? Capability mismatches — advertising <code>resources</code> but
            returning "method not found" for <code>resources/list</code> — are among the most common
            interoperability bugs, because most SDK quickstarts enable capabilities wholesale.
          </p>
          <p>
            <strong>Tools.</strong> List the server's tools and review each declared input schema —
            names, types, required fields, descriptions. The playground renders a form from the schema,
            which is itself a useful test: if the form looks wrong, an LLM will misuse the tool the same
            way. Call each tool with representative valid input and confirm the result content is
            well-formed; if the tool declares an output schema, check the structured result validates
            against it. Then deliberately send wrong input — missing required fields, wrong types,
            out-of-range values. Since spec <code>2025-06-18</code> era guidance, input validation
            failures should come back as <em>tool execution errors</em> (a result
            with <code>isError: true</code> and a message the model can read and correct from), not as
            JSON-RPC protocol errors, and definitely not as unhandled exceptions that kill the session.
          </p>
          <p>
            <strong>Resources and prompts.</strong> List resources and read a few, verifying URIs, MIME
            types, and content encoding (text vs. base64 blobs). If the server exposes resource
            templates, expand them with edge-case parameters — special characters, very long values.
            For prompts, fetch each with valid and missing arguments and confirm the returned messages
            are coherent. If the server declares subscription support, subscribe to a resource and
            verify a change actually produces a notification; this exercises the server's GET-based SSE
            stream, which otherwise goes untested.
          </p>
          <p>
            <strong>Streaming.</strong> If your server streams responses (SSE mode) for long-running
            tools, watch the message log during a slow call: progress notifications should arrive while
            the call runs, and the final JSON-RPC response should terminate the stream. Test what
            happens when you cancel mid-call and when the connection drops — a resumable server replays
            missed events when the client reconnects with <code>Last-Event-ID</code>.
          </p>
          <p>
            <strong>Authorization.</strong> Connecting to a protected server exercises the entire OAuth
            2.1 flow described in{' '}
            <Link to="/docs/remote-vs-local">Remote vs. Local MCP Servers</Link>: the playground reacts
            to your <code>401</code>, discovers the protected resource metadata and authorization
            server, registers or identifies itself, and runs the authorization code flow with PKCE in a
            popup. This end-to-end path is hard to test any other way short of writing a client, and it
            fails loudly at whichever step your server gets wrong — missing metadata, bad issuer URLs,
            PKCE not supported, or tokens rejected after issuance. Also verify the negative cases: the
            server must reject requests with no token and with a token issued for a different resource.
          </p>
          <p>
            Once a server checks out, you can save tool calls to a dashboard to re-run them later as a
            regression check, and share links to specific results with your team.
          </p>

          <div className="alert alert-info mt-4" role="alert">
            <strong>Browser clients need CORS.</strong> Because the playground runs in your browser,
            your server must send CORS headers: allow the origin, allow
            the <code>Content-Type</code>, <code>Accept</code>, <code>Authorization</code>,{' '}
            <code>Mcp-Session-Id</code> and <code>MCP-Protocol-Version</code> request headers, and
            expose <code>Mcp-Session-Id</code> via <code>Access-Control-Expose-Headers</code> —
            otherwise the client cannot read the session ID and every request after initialization
            fails. See <Link to="/docs/troubleshooting">troubleshooting</Link> for a working
            configuration.
          </div>

          <h2 className="mt-5">Testing from the command line</h2>
          <p>
            For scripted checks and CI, curl against the MCP endpoint directly. Initialization is a
            plain POST — note the dual <code>Accept</code> header the transport requires, and
            the <code>-i</code> flag so you can see whether the server issues a session ID:
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
      "clientInfo": { "name": "curl", "version": "1.0" }
    }
  }'`}</code></pre>
          <p>
            A compliant server answers with the <code>InitializeResult</code> — either as
            plain JSON or as an SSE stream containing it — and, if stateful,
            an <code>Mcp-Session-Id</code> response header. Complete the handshake and then exercise
            the API, carrying the session ID and protocol version on every request:
          </p>
          <pre className="bg-light p-3 rounded"><code>{`# The initialized notification must return 202 Accepted
curl -i https://your-server.example.com/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "Mcp-Session-Id: $SESSION_ID" \\
  -H "MCP-Protocol-Version: 2025-11-25" \\
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

# List and call tools
curl https://your-server.example.com/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "Mcp-Session-Id: $SESSION_ID" \\
  -H "MCP-Protocol-Version: 2025-11-25" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'`}</code></pre>
          <p>
            From here, a conformance pass is a handful of assertions you can script:
          </p>
          <ul>
            <li>A request without the session ID (when one was issued) returns <code>400</code>; an unknown or expired session ID returns <code>404</code>.</li>
            <li>A GET to the endpoint either opens an SSE stream or returns exactly <code>405</code>.</li>
            <li>An unsupported <code>MCP-Protocol-Version</code> header value returns <code>400</code>.</li>
            <li>A request with an invalid <code>Origin</code> header returns <code>403</code>.</li>
            <li>On a protected server, a request without a token returns <code>401</code>, and the protected resource metadata is reachable (via the <code>WWW-Authenticate</code> header or <code>/.well-known/oauth-protected-resource</code>).</li>
            <li>Malformed JSON and unknown methods produce proper JSON-RPC error responses (<code>-32700</code> parse error, <code>-32601</code> method not found) rather than empty bodies or 500s.</li>
          </ul>

          <h2 className="mt-5">Beyond correctness</h2>
          <p>
            Once the protocol behavior is right, test the things that only show up under real
            conditions. Run concurrent sessions and confirm state does not leak between them — session
            isolation bugs are invisible in single-client testing. Feed tools adversarial input (path
            traversal attempts, injection payloads, megabyte-sized strings, unusual Unicode) and verify
            they refuse rather than crash. Measure time-to-first-byte on streamed responses, since
            agents block on it. And check behavior at the edges of infrastructure: many streaming bugs
            are caused not by the server but by a reverse proxy buffering SSE — worth testing through
            your production ingress, not just against localhost.
          </p>

          <p className="mt-4">
            Useful companions to this playground:{' '}
            <a href="https://github.com/modelcontextprotocol/inspector" target="_blank" rel="noopener noreferrer">MCP Inspector</a>{' '}
            (the official local debugging UI, which also covers stdio servers), the{' '}
            <a href="https://modelcontextprotocol.io/legacy/tools/debugging" target="_blank" rel="noopener noreferrer">official debugging guide</a>, and the{' '}
            <a href="https://github.com/modelcontextprotocol/servers" target="_blank" rel="noopener noreferrer">reference server implementations</a>{' '}
            to compare behavior against. When a test fails and the cause isn't obvious, the{' '}
            <Link to="/docs/troubleshooting">troubleshooting guide</Link> maps symptoms to causes.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TestingGuide;
