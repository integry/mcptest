import React from 'react';
import { Link } from 'react-router-dom';

const WhatIsMcp: React.FC = () => {
  return (
    <div className="container-fluid py-4">
      <div className="row justify-content-center">
        <div className="col" style={{ maxWidth: '860px' }}>
          <h1 className="mb-4">What is the Model Context Protocol?</h1>

          <p className="lead">
            The Model Context Protocol (MCP) is an open protocol that standardizes how applications
            provide context and capabilities to large language models. An MCP server exposes tools,
            data, and prompt templates through a well-defined JSON-RPC interface, and any MCP-compatible
            client — Claude, IDEs, agent frameworks, or a testing tool like this one — can connect to it
            and use those capabilities without custom integration work.
          </p>

          <p>
            MCP was introduced by Anthropic in November 2024 and has since moved to an open governance
            model with contributions from across the industry. It solves the "N×M integration problem":
            instead of every AI application building bespoke connectors for every data source or API,
            a service implements one MCP server and every MCP client can use it. The protocol is
            transport-agnostic, but in practice two transports matter: <strong>stdio</strong> for servers
            that run locally as a subprocess, and <strong>Streamable HTTP</strong> for servers reachable
            over the network — so-called <em>remote MCP servers</em>, which are the focus of this site.
          </p>

          <h2 className="mt-5">Architecture</h2>
          <p>
            MCP defines three roles. A <strong>host</strong> is the AI application the user interacts
            with — a chat interface, an IDE, an agent runtime. The host creates one or
            more <strong>clients</strong>, each of which maintains a stateful, one-to-one connection to
            a single <strong>server</strong>. The server is the process that actually provides context
            and functionality, whether that is a wrapper around a database, a SaaS API, a file system,
            or custom business logic.
          </p>
          <p>
            All communication between client and server uses <a href="https://www.jsonrpc.org/specification" target="_blank" rel="noopener noreferrer">JSON-RPC 2.0</a> messages:
            requests that expect a response, responses, and one-way notifications. The protocol is
            bidirectional — servers can also send requests to clients (for example, to ask the client's
            model to generate text), which is what distinguishes MCP from a plain REST API.
          </p>

          <h2 className="mt-5">What a server can expose</h2>
          <p>
            A server advertises its capabilities during initialization and then serves them through a
            small set of standardized methods. The three server-side primitives are:
          </p>
          <p>
            <strong>Tools</strong> are functions the language model can invoke — searching a database,
            creating a ticket, sending a message. Each tool declares a name, a description, and a JSON
            Schema for its inputs (and optionally for structured outputs). Clients discover tools
            with <code>tools/list</code> and invoke them with <code>tools/call</code>. Tools are the
            primitive that turns a model from a text generator into an agent that acts, which makes
            testing them thoroughly — including their error behavior — the core of MCP server testing.
          </p>
          <p>
            <strong>Resources</strong> are pieces of data identified by URIs — file contents, database
            records, API responses — that the host application can read and attach to the model's
            context. Resources can be static, listed via <code>resources/list</code>, or parameterized
            through URI templates. Servers can also let clients subscribe to change notifications for
            individual resources.
          </p>
          <p>
            <strong>Prompts</strong> are reusable, parameterized message templates, discovered
            via <code>prompts/list</code> and instantiated with <code>prompts/get</code>. They are
            typically surfaced in the host UI as slash commands or quick actions.
          </p>
          <p>
            Clients can offer capabilities in the other direction as well: <strong>sampling</strong> lets
            a server request an LLM completion from the client, <strong>elicitation</strong> lets a
            server ask the user for additional input mid-operation, and <strong>roots</strong> let the
            client tell the server which directories or locations it should operate on.
          </p>

          <h2 className="mt-5">The connection lifecycle</h2>
          <p>
            Every MCP session follows the same lifecycle regardless of transport. The client opens the
            connection and sends an <code>initialize</code> request declaring the protocol version it
            supports, its capabilities, and its identity:
          </p>
          <pre className="bg-light p-3 rounded"><code>{`{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": { "elicitation": {} },
    "clientInfo": { "name": "mcptest.io", "version": "1.0.0" }
  }
}`}</code></pre>
          <p>
            The server responds with the protocol version it will use for the session, its own
            capabilities (for example <code>tools</code>, <code>resources</code>, <code>prompts</code>,
            and whether it emits list-change notifications), and its server info. The client then sends
            a <code>notifications/initialized</code> notification, after which normal operation begins.
            Version and capability negotiation happen here and only here: both sides must agree on a
            single protocol version, and neither side may use a capability the other did not declare.
            A surprising number of real-world interoperability bugs are simply servers that advertise
            capabilities they don't implement, or that reject protocol versions they should negotiate
            down from — which is why the <Link to="/docs/testing-guide">testing guide</Link> starts with
            the handshake.
          </p>

          <h2 className="mt-5">Transports</h2>
          <p>
            The specification defines two standard transports. With <strong>stdio</strong>, the client
            launches the server as a local subprocess and exchanges newline-delimited JSON-RPC messages
            over standard input and output. With <strong>Streamable HTTP</strong>, the server runs as an
            independent HTTP service exposing a single MCP endpoint that accepts POST and GET requests,
            optionally streaming responses via Server-Sent Events. Streamable HTTP replaced the original
            HTTP+SSE transport in 2025 and is what makes remote, multi-tenant MCP deployments practical.
            The trade-offs and the full mechanics — sessions, streaming, resumability, authorization —
            are covered in <Link to="/docs/remote-vs-local">Remote vs. Local MCP Servers</Link>.
          </p>

          <h2 className="mt-5">Protocol versions</h2>
          <p>
            MCP versions are date strings (<code>YYYY-MM-DD</code>) that change only when a revision
            contains backwards-incompatible changes. Knowing the version history matters when testing,
            because servers and clients in the wild span all of these revisions:
          </p>
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ whiteSpace: 'nowrap' }}>Version</th>
                  <th>Highlights</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>2024-11-05</code></td>
                  <td>First stable release. Tools, resources, prompts, sampling; stdio and the original HTTP+SSE transport.</td>
                </tr>
                <tr>
                  <td><code>2025-03-26</code></td>
                  <td>Replaced HTTP+SSE with Streamable HTTP; introduced the OAuth-based authorization framework; tool annotations and audio content.</td>
                </tr>
                <tr>
                  <td><code>2025-06-18</code></td>
                  <td>Reworked authorization around OAuth 2.1 resource servers (RFC 9728 protected resource metadata, RFC 8707 resource indicators); structured tool output; elicitation; required <code>MCP-Protocol-Version</code> header on HTTP; removed JSON-RPC batching.</td>
                </tr>
                <tr>
                  <td><code>2025-11-25</code></td>
                  <td>Current version. OpenID Connect Discovery support, OAuth Client ID Metadata Documents, incremental scope consent, URL-mode elicitation, icons metadata, tool calling in sampling, experimental long-running tasks, and SSE polling refinements.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Clients and servers may support several versions at once and negotiate the one to use during
            initialization. On HTTP transports, the negotiated version must also be echoed on every
            subsequent request in the <code>MCP-Protocol-Version</code> header.
          </p>

          <h2 className="mt-5">Where to go next</h2>
          <p>
            If you are building or evaluating a remote MCP server, read{' '}
            <Link to="/docs/remote-vs-local">Remote vs. Local MCP Servers</Link> for the transport,
            session, and authorization mechanics, then use the{' '}
            <Link to="/docs/testing-guide">testing guide</Link> to validate your implementation against
            a real client — this site's playground speaks Streamable HTTP directly from your browser.
            When something breaks, the <Link to="/docs/troubleshooting">troubleshooting guide</Link>{' '}
            maps the most common failure symptoms to their causes.
          </p>
          <p>
            The authoritative protocol reference is the official specification at{' '}
            <a href="https://modelcontextprotocol.io/specification/2025-11-25" target="_blank" rel="noopener noreferrer">modelcontextprotocol.io</a>.
            Official SDKs for TypeScript, Python, and other languages, plus a large catalog of open-source
            server implementations, live in the{' '}
            <a href="https://github.com/modelcontextprotocol" target="_blank" rel="noopener noreferrer">modelcontextprotocol GitHub organization</a>.
          </p>
        </div>
      </div>
    </div>
  );
};

export default WhatIsMcp;
