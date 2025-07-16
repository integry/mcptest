import React from 'react';

const RemoteVsLocal: React.FC = () => {
  return (
    <div className="container-fluid py-4">
      <div className="row">
        <div className="col">
          <h1 className="mb-4">
            <i className="bi bi-cloud-arrow-up text-primary me-2"></i>
            Remote vs Local MCP Servers
          </h1>
              
              <p className="lead">Understanding when to use remote HTTP servers versus local stdio servers for your MCP implementations.</p>

              <div className="row mb-5">
                <div className="col-lg-6 mb-4">
                  <div className="card h-100 border-success">
                    <div className="card-header bg-success text-white">
                      <h4 className="mb-0">
                        <i className="bi bi-laptop me-2"></i>
                        Local Servers (stdio)
                      </h4>
                    </div>
                    <div className="card-body">
                      <h5>How it works:</h5>
                      <p>MCP client launches the server as a subprocess and communicates via standard input/output.</p>
                      
                      <h5>Best for:</h5>
                      <ul>
                        <li>Development and testing</li>
                        <li>Personal productivity tools</li>
                        <li>Local file system access</li>
                        <li>Simple command-line integrations</li>
                        <li>Single-user scenarios</li>
                      </ul>

                      <h5>Advantages:</h5>
                      <ul className="list-unstyled">
                        <li><i className="bi bi-check-circle text-success me-2"></i>Simple setup - no network config</li>
                        <li><i className="bi bi-check-circle text-success me-2"></i>No authentication needed</li>
                        <li><i className="bi bi-check-circle text-success me-2"></i>Low latency communication</li>
                        <li><i className="bi bi-check-circle text-success me-2"></i>Direct process management</li>
                        <li><i className="bi bi-check-circle text-success me-2"></i>Automatic cleanup on exit</li>
                      </ul>

                      <h5>Limitations:</h5>
                      <ul className="list-unstyled">
                        <li><i className="bi bi-x-circle text-danger me-2"></i>Single client per server instance</li>
                        <li><i className="bi bi-x-circle text-danger me-2"></i>No sharing between users</li>
                        <li><i className="bi bi-x-circle text-danger me-2"></i>Platform-dependent executables</li>
                        <li><i className="bi bi-x-circle text-danger me-2"></i>Process overhead for each client</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="col-lg-6 mb-4">
                  <div className="card h-100 border-primary">
                    <div className="card-header bg-primary text-white">
                      <h4 className="mb-0">
                        <i className="bi bi-cloud me-2"></i>
                        Remote Servers (HTTP)
                      </h4>
                    </div>
                    <div className="card-body">
                      <h5>How it works:</h5>
                      <p>MCP server runs as a web service, clients connect via HTTP with optional Server-Sent Events for streaming.</p>
                      
                      <h5>Best for:</h5>
                      <ul>
                        <li>Multi-user applications</li>
                        <li>Cloud-based services</li>
                        <li>Shared resources and APIs</li>
                        <li>Enterprise deployments</li>
                        <li>Cross-platform compatibility</li>
                      </ul>

                      <h5>Advantages:</h5>
                      <ul className="list-unstyled">
                        <li><i className="bi bi-check-circle text-success me-2"></i>Multiple concurrent clients</li>
                        <li><i className="bi bi-check-circle text-success me-2"></i>Platform independent</li>
                        <li><i className="bi bi-check-circle text-success me-2"></i>Scalable deployment</li>
                        <li><i className="bi bi-check-circle text-success me-2"></i>Centralized resource management</li>
                        <li><i className="bi bi-check-circle text-success me-2"></i>Web-standard protocols</li>
                      </ul>

                      <h5>Considerations:</h5>
                      <ul className="list-unstyled">
                        <li><i className="bi bi-exclamation-triangle text-warning me-2"></i>Requires authentication setup</li>
                        <li><i className="bi bi-exclamation-triangle text-warning me-2"></i>Network latency</li>
                        <li><i className="bi bi-exclamation-triangle text-warning me-2"></i>Security configuration needed</li>
                        <li><i className="bi bi-exclamation-triangle text-warning me-2"></i>Infrastructure management</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              <h2>Connection Methods</h2>
              <div className="table-responsive mb-4">
                <table className="table table-striped">
                  <thead>
                    <tr>
                      <th>Aspect</th>
                      <th>stdio (Local)</th>
                      <th>HTTP (Remote)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>Transport</strong></td>
                      <td>Standard input/output streams</td>
                      <td>HTTP POST + optional SSE</td>
                    </tr>
                    <tr>
                      <td><strong>Message Format</strong></td>
                      <td>JSON-RPC over newline-delimited JSON</td>
                      <td>JSON-RPC over HTTP</td>
                    </tr>
                    <tr>
                      <td><strong>Authentication</strong></td>
                      <td>Environment-based credentials</td>
                      <td>OAuth 2.0 / Bearer tokens</td>
                    </tr>
                    <tr>
                      <td><strong>Session Management</strong></td>
                      <td>Process lifecycle</td>
                      <td>HTTP sessions with IDs</td>
                    </tr>
                    <tr>
                      <td><strong>Streaming</strong></td>
                      <td>Bidirectional over pipes</td>
                      <td>Server-Sent Events</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h2>Security Considerations</h2>
              <div className="row mb-4">
                <div className="col-md-6">
                  <div className="card border-warning">
                    <div className="card-header bg-warning text-dark">
                      <h5 className="mb-0">Local Servers</h5>
                    </div>
                    <div className="card-body">
                      <ul className="mb-0">
                        <li>Inherit user's file system permissions</li>
                        <li>No network exposure by default</li>
                        <li>Process isolation</li>
                        <li>Environment variable access</li>
                      </ul>
                    </div>
                  </div>
                </div>
                <div className="col-md-6">
                  <div className="card border-danger">
                    <div className="card-header bg-danger text-white">
                      <h5 className="mb-0">Remote Servers</h5>
                    </div>
                    <div className="card-body">
                      <ul className="mb-0">
                        <li>Require authentication mechanisms</li>
                        <li>Need CORS and origin validation</li>
                        <li>DNS rebinding attack prevention</li>
                        <li>Rate limiting and DoS protection</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              <h2>Performance Comparison</h2>
              <div className="alert alert-info">
                <h5><i className="bi bi-speedometer me-2"></i>Performance Characteristics</h5>
                <div className="row">
                  <div className="col-md-6">
                    <strong>Local (stdio):</strong>
                    <ul className="mb-0">
                      <li>Lower latency (no network)</li>
                      <li>Higher memory usage per client</li>
                      <li>Process startup overhead</li>
                    </ul>
                  </div>
                  <div className="col-md-6">
                    <strong>Remote (HTTP):</strong>
                    <ul className="mb-0">
                      <li>Network latency impact</li>
                      <li>Shared resources across clients</li>
                      <li>Connection pooling benefits</li>
                    </ul>
                  </div>
                </div>
              </div>

              <h2>Decision Matrix</h2>
              <div className="table-responsive mb-4">
                <table className="table table-bordered">
                  <thead>
                    <tr>
                      <th>Use Case</th>
                      <th>Recommended</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Development & Testing</td>
                      <td><span className="badge bg-success">Local</span></td>
                      <td>Simple setup, no authentication needed</td>
                    </tr>
                    <tr>
                      <td>Personal Assistant</td>
                      <td><span className="badge bg-success">Local</span></td>
                      <td>Single user, file system access</td>
                    </tr>
                    <tr>
                      <td>Team Collaboration</td>
                      <td><span className="badge bg-primary">Remote</span></td>
                      <td>Multiple users need shared access</td>
                    </tr>
                    <tr>
                      <td>Enterprise API</td>
                      <td><span className="badge bg-primary">Remote</span></td>
                      <td>Scalability and security requirements</td>
                    </tr>
                    <tr>
                      <td>Cloud Service</td>
                      <td><span className="badge bg-primary">Remote</span></td>
                      <td>Cross-platform, multiple clients</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="alert alert-light border">
                <h5><i className="bi bi-book me-2"></i>Learn More</h5>
                <p className="mb-2">For detailed implementation guides:</p>
                <a href="https://modelcontextprotocol.io/docs/concepts/transports" target="_blank" rel="noopener noreferrer" className="btn btn-outline-primary btn-sm me-2">
                  Transport Documentation <i className="bi bi-box-arrow-up-right ms-1"></i>
                </a>
                <a href="https://modelcontextprotocol.io/docs/quickstart/server-developers" target="_blank" rel="noopener noreferrer" className="btn btn-outline-secondary btn-sm">
                  Server Development Guide <i className="bi bi-box-arrow-up-right ms-1"></i>
                </a>
              </div>
        </div>
      </div>
    </div>
  );
};

export default RemoteVsLocal;