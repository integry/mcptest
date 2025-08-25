import React from 'react';

const McpTestVsInspector: React.FC = () => {
  return (
    <div className="container-fluid py-4">
      <div className="row">
        <div className="col">
          <h1 className="mb-4">
            <i className="bi bi-diagram-3 text-primary me-2"></i>
            MCP Test vs. MCP Inspector
          </h1>

          <div className="alert alert-info" role="alert">
            <strong>High-Level Summary:</strong>
            <ul className="mb-0 mt-2">
              <li><strong>MCP Inspector:</strong> The official, open-source, developer-centric tool for deep, spec-compliant debugging. It is designed to be run locally (npx, Docker) and is essential for developers who are building MCP servers.</li>
              <li><strong>mcptest.io:</strong> A hosted, no-code/low-code web platform designed for testing and inspecting MCP server traffic. It excels at rapid prototyping and testing MCP endpoints without requiring local setup.</li>
            </ul>
          </div>

          <div className="mb-4">
            <a href="https://modelcontextprotocol.io/legacy/tools/inspector" target="_blank" rel="noopener noreferrer" className="btn btn-outline-primary">
              <i className="bi bi-box-arrow-up-right me-2"></i>
              Visit MCP Inspector
            </a>
          </div>

          <h2>Shared Core Functionality</h2>
          <p className="mb-4">Both platforms provide the fundamental features required for interacting with an MCP server:</p>
          <ul className="mb-4">
            <li>Connect to remote servers using streamable-http and sse.</li>
            <li>List available tools, resources, and prompts.</li>
            <li>Execute tool calls with specified parameters.</li>
            <li>View a history of requests and responses.</li>
          </ul>

          <h2>Key Differences at a Glance</h2>
          <div className="table-responsive mb-4">
            <table className="table table-bordered table-hover">
              <thead className="table-light">
                <tr>
                  <th scope="col">Feature</th>
                  <th scope="col" className="text-center">MCP Test (This App)</th>
                  <th scope="col" className="text-center">MCP Inspector</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Primary Use Case</th>
                  <td>Rapid testing, monitoring, and creating shareable live views of server capabilities without local setup.</td>
                  <td>Deep debugging & spec-compliant development with full control over local and remote servers.</td>
                </tr>
                <tr>
                  <th scope="row">Target Audience</th>
                  <td>MCP Server/Client Developers, QA, Product Managers</td>
                  <td>MCP Server Developers focused on implementation and debugging</td>
                </tr>
                <tr>
                  <th scope="row">Deployment</th>
                  <td>Hosted Web Platform (zero installation)</td>
                  <td>Local (npx), Docker, Self-hosted</td>
                </tr>
                <tr>
                  <th scope="row">Local Server (stdio) Support</th>
                  <td className="text-center"><i className="bi bi-x-circle-fill text-danger"></i><br/>No support for local stdio servers</td>
                  <td className="text-center"><i className="bi bi-check-circle-fill text-success"></i><br/>Core feature - can launch and manage local server processes</td>
                </tr>
                <tr>
                  <th scope="row">OAuth 2.1 Support</th>
                  <td className="text-center"><i className="bi bi-check-circle-fill text-success"></i><br/>Basic token support for authentication</td>
                  <td className="text-center"><i className="bi bi-check-circle-fill text-success"></i><br/>Comprehensive OAuth 2.1 debugger with guided flow</td>
                </tr>
                <tr>
                  <th scope="row">CLI for Automation</th>
                  <td className="text-center"><i className="bi bi-x-circle-fill text-danger"></i><br/>No CLI available</td>
                  <td className="text-center"><i className="bi bi-check-circle-fill text-success"></i><br/>Full-fledged CLI for scripted tests and CI/CD</td>
                </tr>
                <tr>
                  <th scope="row">Configuration Export</th>
                  <td className="text-center"><i className="bi bi-x-circle-fill text-danger"></i></td>
                  <td className="text-center"><i className="bi bi-check-circle-fill text-success"></i><br/>Can export to mcp.json for use with Claude/Cursor</td>
                </tr>
                <tr>
                  <th scope="row">Multi-Client Support</th>
                  <td className="text-center">Single client connections</td>
                  <td className="text-center"><i className="bi bi-check-circle-fill text-success"></i><br/>Proxy supports multiple simultaneous clients</td>
                </tr>
                <tr>
                  <th scope="row">Monitoring</th>
                  <td className="text-center"><i className="bi bi-check-circle-fill text-success"></i><br/>Designed for creating monitoring dashboards</td>
                  <td className="text-center"><i className="bi bi-x-circle-fill text-danger"></i><br/>Not designed for persistent monitoring</td>
                </tr>
                <tr>
                  <th scope="row">Sharing & Collaboration</th>
                  <td className="text-center"><i className="bi bi-check-circle-fill text-success"></i><br/>Share dashboards and results via URLs</td>
                  <td className="text-center"><i className="bi bi-x-circle-fill text-danger"></i><br/>No built-in sharing functionality</td>
                </tr>
                <tr>
                  <th scope="row">User Interface</th>
                  <td>No-code/low-code web interface optimized for ease of use</td>
                  <td>Developer-focused interface exposing protocol details</td>
                </tr>
                <tr>
                  <th scope="row">Setup Required</th>
                  <td>None (Web browser only)</td>
                  <td>Node.js / Docker installation required</td>
                </tr>
                <tr>
                  <th scope="row">Spec Compliance</th>
                  <td>Supports standard MCP features</td>
                  <td>High (Official reference tool) with advanced features</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2>MCP Inspector's Unique Strengths (Developer-Centric & Spec-Driven)</h2>
          <p>The Inspector is built for developers who need fine-grained control and deep integration with their local and remote development workflows.</p>
          <div className="row mb-4">
            <div className="col-md-6">
              <ul className="list-unstyled">
                <li className="mb-2"><i className="bi bi-terminal text-primary me-2"></i><strong>Integrated Local Server Management (STDIO):</strong> Directly launch, manage, and debug local server processes written in any language.</li>
                <li className="mb-2"><i className="bi bi-box text-primary me-2"></i><strong>Official Docker Image:</strong> Easily deployed in containerized environments for remote development and CI/CD pipelines.</li>
                <li className="mb-2"><i className="bi bi-shield-lock text-primary me-2"></i><strong>Comprehensive OAuth 2.1 Debugger:</strong> Step-by-step guided flow for debugging complex authentication scenarios with providers like Okta and Azure AD.</li>
                <li className="mb-2"><i className="bi bi-code-slash text-primary me-2"></i><strong>Full-Fledged CLI:</strong> Essential for automation, enabling scripted tests and integration with other developer tools.</li>
                <li className="mb-2"><i className="bi bi-github text-primary me-2"></i><strong>Open Source and Self-Hostable:</strong> Full transparency and ability to run in any environment without relying on third-party services.</li>
              </ul>
            </div>
            <div className="col-md-6">
              <ul className="list-unstyled">
                <li className="mb-2"><i className="bi bi-file-code text-primary me-2"></i><strong>Configuration Export to mcp.json:</strong> Generate server configuration files directly usable by other MCP clients like Cursor and Claude Code.</li>
                <li className="mb-2"><i className="bi bi-lock text-primary me-2"></i><strong>Security Hardening:</strong> Recent updates include proxy authentication tokens to prevent vulnerabilities.</li>
                <li className="mb-2"><i className="bi bi-people text-primary me-2"></i><strong>Multi-Client Connection Support:</strong> Proxy can manage multiple simultaneous client connections to a single server.</li>
                <li className="mb-2"><i className="bi bi-lightning text-primary me-2"></i><strong>Advanced Spec Features:</strong> Early support for cutting-edge MCP features like Elicitation, Structured Output, and Resource Subscriptions.</li>
                <li className="mb-2"><i className="bi bi-chat-dots text-primary me-2"></i><strong>Direct Community Contribution:</strong> Development is transparent and directly driven by community needs and the evolving MCP specification.</li>
              </ul>
            </div>
          </div>

          <h2>mcptest.io's Unique Strengths (No-Code & Rapid Testing)</h2>
          <p>mcptest.io is positioned as a user-friendly, hosted service that excels at rapid testing without requiring local setup.</p>
          <div className="row mb-4">
            <div className="col-md-6">
              <ul className="list-unstyled">
                <li className="mb-2"><i className="bi bi-globe text-primary me-2"></i><strong>No-Code / Low-Code Interface:</strong> Quickly test or inspect MCP endpoints without setting up a local Node.js environment or running npx commands.</li>
                <li className="mb-2"><i className="bi bi-cloud text-primary me-2"></i><strong>Hosted Web Platform:</strong> Accessible from anywhere with a browser and requires zero installation.</li>
                <li className="mb-2"><i className="bi bi-speedometer2 text-primary me-2"></i><strong>Rapid Prototyping:</strong> Ideal for quickly testing a tool's JSON schema and response structure to validate a design before writing backend code.</li>
                <li className="mb-2"><i className="bi bi-share text-primary me-2"></i><strong>Collaboration and Sharing:</strong> Easily share configurations and test results with team members via URLs.</li>
                <li className="mb-2"><i className="bi bi-laptop text-primary me-2"></i><strong>No Local Resource Consumption:</strong> All operations run on mcptest.io's servers, advantageous for users on less powerful machines.</li>
              </ul>
            </div>
            <div className="col-md-6">
              <ul className="list-unstyled">
                <li className="mb-2"><i className="bi bi-window text-primary me-2"></i><strong>Cross-Platform by Default:</strong> As a web application, immune to platform-specific issues like Windows pathing problems or environment variable inconsistencies.</li>
                <li className="mb-2"><i className="bi bi-lightning text-primary me-2"></i><strong>Instant Onboarding:</strong> Time from discovering the tool to running the first test is minimal with no setup required.</li>
                <li className="mb-2"><i className="bi bi-eye text-primary me-2"></i><strong>Simplified UI:</strong> Interface optimized for ease of use and clarity, abstracting away lower-level protocol details.</li>
                <li className="mb-2"><i className="bi bi-grid text-primary me-2"></i><strong>Dashboard-Centric Approach:</strong> Create persistent dashboards with cards representing specific tool calls or resource access requests.</li>
                <li className="mb-2"><i className="bi bi-activity text-primary me-2"></i><strong>Health Monitoring:</strong> Designed for creating monitoring dashboards that continuously check server health and availability.</li>
              </ul>
            </div>
          </div>

          <h2>When to Use Which Tool?</h2>
          <div className="row mb-4">
            <div className="col-md-6 mb-3">
              <div className="card h-100 border-primary">
                <div className="card-body">
                  <h5 className="card-title"><i className="bi bi-clipboard2-pulse me-2"></i>Use mcptest.io when you are:</h5>
                  <ul className="list-unstyled">
                    <li className="mb-2"><i className="bi bi-check text-success me-2"></i>Quickly prototyping or testing a new tool's behavior without writing backend code.</li>
                    <li className="mb-2"><i className="bi bi-check text-success me-2"></i>A client developer who needs a stable MCP endpoint to test against.</li>
                    <li className="mb-2"><i className="bi bi-check text-success me-2"></i>Looking for a quick, no-installation way to make ad-hoc calls to a remote MCP server.</li>
                    <li className="mb-2"><i className="bi bi-check text-success me-2"></i>Creating persistent monitoring dashboards to track server health and availability.</li>
                    <li className="mb-2"><i className="bi bi-check text-success me-2"></i>Sharing live results and dashboards with team members who may not have technical setup.</li>
                    <li className="mb-2"><i className="bi bi-check text-success me-2"></i>Working from a restricted environment where installing Node.js or Docker isn't possible.</li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="col-md-6 mb-3">
              <div className="card h-100 border-info">
                <div className="card-body">
                  <h5 className="card-title"><i className="bi bi-search me-2"></i>Use MCP Inspector when you are:</h5>
                  <ul className="list-unstyled">
                    <li className="mb-2"><i className="bi bi-check text-success me-2"></i>Actively writing or debugging the code for an MCP server.</li>
                    <li className="mb-2"><i className="bi bi-check text-success me-2"></i>Needing to test local changes with stdio before deploying.</li>
                    <li className="mb-2"><i className="bi bi-check text-success me-2"></i>Verifying full compliance with the latest MCP specification, especially for advanced features.</li>
                    <li className="mb-2"><i className="bi bi-check text-success me-2"></i>Automating your testing in a CI/CD pipeline using a CLI.</li>
                    <li className="mb-2"><i className="bi bi-check text-success me-2"></i>Debugging complex OAuth 2.1 authentication flows with providers like Okta or Azure AD.</li>
                    <li className="mb-2"><i className="bi bi-check text-success me-2"></i>Requiring full control over your testing environment with self-hosting capabilities.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <h2>Conclusion</h2>
          <div className="alert alert-success" role="alert">
            <p className="mb-0"><strong>MCP Inspector and mcptest.io are not direct competitors but rather complementary tools</strong> that serve different needs within the MCP ecosystem. Together, they provide comprehensive coverage for both development and testing workflows, from deep technical debugging to rapid prototyping and monitoring.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default McpTestVsInspector;