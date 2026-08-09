import React from 'react';
import { Link } from 'react-router-dom';

const WhatIsMcp: React.FC = () => {
  return (
    <div className="container-fluid py-4">
      <div className="row justify-content-center">
        <div className="col" style={{ maxWidth: '860px' }}>
          <h1 className="mb-4">What is the Model Context Protocol?</h1>

          <p className="lead">
            The Model Context Protocol (MCP) is an open protocol for connecting AI applications to
            tools and context. A service describes its capabilities once through a standard JSON-RPC
            interface; MCP clients can then discover and use them without a bespoke integration for
            every client-server pair.
          </p>

          <p>
            MCP was introduced by Anthropic in November 2024 and is now an openly governed Linux
            Foundation project. It defines three roles: the <strong>host</strong> is the AI application
            a person uses, a <strong>client</strong> speaks MCP on the host&apos;s behalf, and a{' '}
            <strong>server</strong> provides capabilities backed by a database, SaaS API, local system,
            or business process. All three exchange <a href="https://www.jsonrpc.org/specification" target="_blank" rel="noopener noreferrer">JSON-RPC 2.0</a>{' '}
            messages over a transport such as local stdio or remote Streamable HTTP.
          </p>

          <h2 className="mt-5">What a server exposes</h2>
          <p>
            <strong>Tools</strong> are functions an AI model can invoke: search a database, create a
            ticket, or send a message. Each tool has a name, description, JSON Schema input, and
            optional structured output schema. Clients use <code>tools/list</code> and{' '}
            <code>tools/call</code> to discover and invoke them.
          </p>
          <p>
            <strong>Resources</strong> are data addressed by URIs. They may be listed with{' '}
            <code>resources/list</code>, parameterized through URI templates, and read with{' '}
            <code>resources/read</code>. <strong>Prompts</strong> are reusable message templates,
            discovered with <code>prompts/list</code> and rendered with <code>prompts/get</code>.
          </p>
          <p>
            The 2026 protocol also supports in-band multi-round-trip requests. A tool, resource, or
            prompt operation can return <code>resultType: &quot;input_required&quot;</code>; the client
            obtains the requested user or model input and retries the original call with{' '}
            <code>inputResponses</code>. This replaces the held-open server-to-client requests used by
            older sampling, elicitation, and roots flows. Roots, sampling, and logging are deprecated
            in the 2026 core, although compatibility implementations may continue to serve them.
          </p>

          <h2 className="mt-5">Two protocol eras</h2>
          <p>
            MCP now has two lifecycle families. A production client should understand both because
            many deployed servers still implement a 2025 revision.
          </p>
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Behavior</th>
                  <th>2026-07-28 stateless</th>
                  <th>2025 and earlier stateful</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Start</td>
                  <td>Optional client probe to required server method <code>server/discover</code></td>
                  <td><code>initialize</code>, then <code>notifications/initialized</code></td>
                </tr>
                <tr>
                  <td>Request context</td>
                  <td>Protocol version and client capabilities in every request&apos;s <code>_meta</code></td>
                  <td>Negotiated once during initialization</td>
                </tr>
                <tr>
                  <td>Transport session</td>
                  <td>None; <code>Mcp-Session-Id</code> was removed</td>
                  <td>Optional server-issued <code>Mcp-Session-Id</code></td>
                </tr>
                <tr>
                  <td>Server changes</td>
                  <td><code>subscriptions/listen</code></td>
                  <td>Standalone GET SSE stream and notifications</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3 className="mt-4">Stateless requests in 2026</h3>
          <p>
            There is no <code>initialize</code> handshake in <code>2026-07-28</code>. Every request is
            self-describing. The protocol version and client capabilities are required in{' '}
            <code>params._meta</code>, while client identity is recommended. On Streamable HTTP, the
            body metadata is mirrored by routing headers so a gateway can classify a request without
            parsing JSON:
          </p>
          <pre className="bg-light p-3 rounded"><code>{`POST /mcp
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: search

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search",
    "arguments": { "query": "stateless MCP" },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "mcptest.io",
        "version": "2.0.0"
      },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}`}</code></pre>
          <p>
            <code>Mcp-Method</code> is required on every HTTP request. <code>Mcp-Name</code> is also
            required for <code>tools/call</code>, <code>resources/read</code>, and{' '}
            <code>prompts/get</code>. The <code>MCP-Protocol-Version</code> header must match the version
            in <code>_meta</code>. With no hidden transport session, requests can reach any healthy
            instance behind a normal load balancer. Applications can still keep business state by
            returning an explicit handle and accepting it as a later tool argument.
          </p>

          <h3 className="mt-4">Stateful compatibility through 2025</h3>
          <p>
            Revisions through <code>2025-11-25</code> begin with <code>initialize</code>. The client and
            server negotiate one version and capability set, the client sends{' '}
            <code>notifications/initialized</code>, and a stateful server may issue an opaque{' '}
            <code>Mcp-Session-Id</code> that the client must return on later requests. This remains a
            valid and important compatibility path; it is not how a 2026-only request should be served.
          </p>
          <p>
            mcptest.io uses automatic SDK negotiation. It probes with <code>server/discover</code> and
            adopts stateless behavior when the server offers <code>2026-07-28</code>. A 2025-only
            response falls back to the byte-compatible initialization flow. Authentication failures
            remain authentication failures rather than being mistaken for lifecycle evidence.
          </p>

          <h2 className="mt-5">Protocol versions</h2>
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ whiteSpace: 'nowrap' }}>Version</th>
                  <th>Important changes</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>2024-11-05</code></td>
                  <td>First stable release; stdio and the original two-endpoint HTTP+SSE transport.</td>
                </tr>
                <tr>
                  <td><code>2025-03-26</code></td>
                  <td>Introduced Streamable HTTP and the OAuth-based authorization framework.</td>
                </tr>
                <tr>
                  <td><code>2025-06-18</code></td>
                  <td>OAuth 2.1 resource-server model, structured tool output, elicitation, protocol-version header, and no JSON-RPC batching.</td>
                </tr>
                <tr>
                  <td><code>2025-11-25</code></td>
                  <td>OIDC discovery, Client ID Metadata Documents, URL elicitation, icons, experimental tasks, and SSE polling refinements.</td>
                </tr>
                <tr>
                  <td><code>2026-07-28</code></td>
                  <td>Current version: stateless core, discovery, header routing, cacheable lists, multi-round-trip input, subscriptions, extensions, and authorization hardening.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2 className="mt-5">Where to go next</h2>
          <p>
            Read <Link to="/docs/remote-vs-local">Remote vs. Local MCP Servers</Link> for the
            transport mechanics, then use the <Link to="/docs/testing-guide">testing guide</Link> to
            verify both lifecycle eras. The <Link to="/docs/troubleshooting">troubleshooting guide</Link>{' '}
            maps common CORS, session, routing-header, streaming, and authorization failures to fixes.
          </p>
          <p>
            The authoritative references are the{' '}
            <a href="https://modelcontextprotocol.io/specification/2026-07-28" target="_blank" rel="noopener noreferrer">2026-07-28 specification</a>,
            the official <a href="https://blog.modelcontextprotocol.io/posts/2026-07-28/" target="_blank" rel="noopener noreferrer">release overview</a>,
            and the TypeScript SDK&apos;s{' '}
            <a href="https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md" target="_blank" rel="noopener noreferrer">dual-era negotiation guide</a>.
          </p>
        </div>
      </div>
    </div>
  );
};

export default WhatIsMcp;
