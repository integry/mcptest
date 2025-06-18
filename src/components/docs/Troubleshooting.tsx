import React from 'react';

const Troubleshooting: React.FC = () => {
  return (
    <div className="container-fluid py-4">
      <div className="row">
        <div className="col-lg-10 mx-auto">
          <div className="card">
            <div className="card-body">
              <h1 className="card-title mb-4">
                <i className="bi bi-wrench text-warning me-2"></i>
                MCP Troubleshooting Guide
              </h1>
              
              <p className="lead">Common issues and solutions when working with MCP servers, especially for remote deployments.</p>

              <div className="alert alert-info" role="alert">
                <i className="bi bi-lightbulb me-2"></i>
                Start with the basics: check server logs, verify network connectivity, and confirm protocol versions match.
              </div>

              <h2>Connection Issues</h2>
              <div className="row mb-4">
                <div className="col-lg-6">
                  <div className="card border-danger">
                    <div className="card-header bg-danger text-white">
                      <h5 className="mb-0">Remote Server Connection Failures</h5>
                    </div>
                    <div className="card-body">
                      <h6>Symptoms:</h6>
                      <ul>
                        <li>Connection timeout errors</li>
                        <li>HTTP 404 or 405 responses</li>
                        <li>CORS policy violations</li>
                        <li>"Server not found" messages</li>
                      </ul>

                      <h6>Common Solutions:</h6>
                      <div className="accordion" id="remoteIssues">
                        <div className="accordion-item">
                          <h2 className="accordion-header">
                            <button className="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#cors">
                              CORS & Origin Issues
                            </button>
                          </h2>
                          <div id="cors" className="accordion-collapse collapse" data-bs-parent="#remoteIssues">
                            <div className="accordion-body">
                              <pre className="bg-light p-2 rounded"><code>{`// Server must validate Origin header
app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (!isValidOrigin(origin)) {
    return res.status(403).send('Invalid origin');
  }
  next();
});`}</code></pre>
                            </div>
                          </div>
                        </div>
                        <div className="accordion-item">
                          <h2 className="accordion-header">
                            <button className="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#endpoints">
                              Wrong Endpoint Configuration
                            </button>
                          </h2>
                          <div id="endpoints" className="accordion-collapse collapse" data-bs-parent="#remoteIssues">
                            <div className="accordion-body">
                              <p>Ensure your server supports both GET and POST on the MCP endpoint:</p>
                              <ul>
                                <li><code>POST /mcp</code> - Handle client requests</li>
                                <li><code>GET /mcp</code> - Server-sent events (or return 405)</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-lg-6">
                  <div className="card border-warning">
                    <div className="card-header bg-warning text-dark">
                      <h5 className="mb-0">Local Server Issues</h5>
                    </div>
                    <div className="card-body">
                      <h6>Symptoms:</h6>
                      <ul>
                        <li>Process fails to start</li>
                        <li>No response to stdio input</li>
                        <li>Permission denied errors</li>
                        <li>Path not found errors</li>
                      </ul>

                      <h6>Common Solutions:</h6>
                      <ul>
                        <li><strong>Check executable path:</strong> Verify the command exists and is executable</li>
                        <li><strong>Environment variables:</strong> Ensure required env vars are set</li>
                        <li><strong>File permissions:</strong> Check read/write access to required files</li>
                        <li><strong>Dependencies:</strong> Install missing runtime dependencies</li>
                      </ul>

                      <div className="alert alert-light mt-3">
                        <small><strong>Debug tip:</strong> Run the server manually in a terminal to see startup errors.</small>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <h2>Authentication Problems</h2>
              <div className="card mb-4">
                <div className="card-body">
                  <div className="row">
                    <div className="col-md-6">
                      <h5><i className="bi bi-shield-x text-danger me-2"></i>OAuth Flow Issues</h5>
                      <table className="table table-sm">
                        <thead>
                          <tr>
                            <th>Error</th>
                            <th>Likely Cause</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td><code>invalid_client</code></td>
                            <td>Wrong client ID or secret</td>
                          </tr>
                          <tr>
                            <td><code>invalid_grant</code></td>
                            <td>Expired authorization code</td>
                          </tr>
                          <tr>
                            <td><code>redirect_uri_mismatch</code></td>
                            <td>Callback URL not registered</td>
                          </tr>
                          <tr>
                            <td><code>access_denied</code></td>
                            <td>User declined authorization</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="col-md-6">
                      <h5><i className="bi bi-key text-warning me-2"></i>Token Problems</h5>
                      <ul>
                        <li><strong>Expired tokens:</strong> Implement refresh token logic</li>
                        <li><strong>Invalid scope:</strong> Check requested vs granted permissions</li>
                        <li><strong>Malformed headers:</strong> Verify <code>Authorization: Bearer &lt;token&gt;</code> format</li>
                        <li><strong>Token leakage:</strong> Never log or expose tokens in responses</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              <h2>Protocol & Message Errors</h2>
              <div className="row mb-4">
                <div className="col-lg-4">
                  <div className="card border-info h-100">
                    <div className="card-header bg-info text-white">
                      <h6 className="mb-0">Version Mismatches</h6>
                    </div>
                    <div className="card-body">
                      <p className="small">Client and server must agree on protocol version during initialization.</p>
                      <strong>Solution:</strong>
                      <ul className="small mb-0">
                        <li>Check supported versions in both client and server</li>
                        <li>Update to compatible versions</li>
                        <li>Implement version negotiation</li>
                      </ul>
                    </div>
                  </div>
                </div>
                <div className="col-lg-4">
                  <div className="card border-warning h-100">
                    <div className="card-header bg-warning text-dark">
                      <h6 className="mb-0">Malformed JSON-RPC</h6>
                    </div>
                    <div className="card-body">
                      <p className="small">Invalid JSON-RPC format causes parse errors.</p>
                      <strong>Check for:</strong>
                      <ul className="small mb-0">
                        <li>Missing <code>jsonrpc: "2.0"</code></li>
                        <li>Invalid ID format</li>
                        <li>Malformed params object</li>
                        <li>Wrong method names</li>
                      </ul>
                    </div>
                  </div>
                </div>
                <div className="col-lg-4">
                  <div className="card border-danger h-100">
                    <div className="card-header bg-danger text-white">
                      <h6 className="mb-0">Capability Mismatches</h6>
                    </div>
                    <div className="card-body">
                      <p className="small">Client tries to use unsupported server features.</p>
                      <strong>Fix by:</strong>
                      <ul className="small mb-0">
                        <li>Checking server capabilities first</li>
                        <li>Graceful fallback for missing features</li>
                        <li>Clear error messages to users</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              <h2>Performance Issues</h2>
              <div className="card mb-4">
                <div className="card-body">
                  <div className="row">
                    <div className="col-md-6">
                      <h5>Slow Response Times</h5>
                      <div className="alert alert-warning">
                        <strong>Common Causes:</strong>
                        <ul className="mb-0">
                          <li>Network latency for remote servers</li>
                          <li>Inefficient database queries</li>
                          <li>Large resource payloads</li>
                          <li>Unoptimized tool operations</li>
                        </ul>
                      </div>
                      <h6>Optimization Strategies:</h6>
                      <ul>
                        <li>Implement caching where appropriate</li>
                        <li>Use streaming for large responses</li>
                        <li>Optimize database queries</li>
                        <li>Add request timeouts</li>
                      </ul>
                    </div>
                    <div className="col-md-6">
                      <h5>Memory & Resource Usage</h5>
                      <div className="alert alert-info">
                        <strong>Monitor:</strong>
                        <ul className="mb-0">
                          <li>Memory consumption per client</li>
                          <li>File handle usage</li>
                          <li>Network connection pools</li>
                          <li>CPU usage during operations</li>
                        </ul>
                      </div>
                      <h6>Best Practices:</h6>
                      <ul>
                        <li>Implement connection pooling</li>
                        <li>Clean up resources in error paths</li>
                        <li>Use streaming for large files</li>
                        <li>Set resource limits</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              <h2>Security Considerations</h2>
              <div className="alert alert-danger">
                <h5><i className="bi bi-shield-exclamation me-2"></i>Security Checklist</h5>
                <div className="row">
                  <div className="col-md-6">
                    <h6>Remote Servers</h6>
                    <ul className="mb-0">
                      <li>□ Origin header validation</li>
                      <li>□ HTTPS in production</li>
                      <li>□ Rate limiting enabled</li>
                      <li>□ Input sanitization</li>
                      <li>□ Authentication required</li>
                      <li>□ Bind to localhost only (if local)</li>
                    </ul>
                  </div>
                  <div className="col-md-6">
                    <h6>All Servers</h6>
                    <ul className="mb-0">
                      <li>□ Validate all inputs</li>
                      <li>□ Sanitize file paths</li>
                      <li>□ Handle errors gracefully</li>
                      <li>□ Log security events</li>
                      <li>□ Don't expose internal errors</li>
                      <li>□ Implement timeouts</li>
                    </ul>
                  </div>
                </div>
              </div>

              <h2>Debugging Tools & Techniques</h2>
              <div className="row mb-4">
                <div className="col-md-6 mb-3">
                  <div className="card border-0 bg-light">
                    <div className="card-body">
                      <h5 className="card-title">
                        <i className="bi bi-bug text-danger me-2"></i>Debug Logging
                      </h5>
                      <p>Enable detailed logging to trace message flow:</p>
                      <ul className="small">
                        <li>Log all incoming/outgoing messages</li>
                        <li>Include timestamps and correlation IDs</li>
                        <li>Log authentication events</li>
                        <li>Track resource access attempts</li>
                      </ul>
                    </div>
                  </div>
                </div>
                <div className="col-md-6 mb-3">
                  <div className="card border-0 bg-light">
                    <div className="card-body">
                      <h5 className="card-title">
                        <i className="bi bi-network-widescreen text-primary me-2"></i>Network Analysis
                      </h5>
                      <p>Use browser dev tools or network utilities:</p>
                      <ul className="small">
                        <li>Check HTTP status codes</li>
                        <li>Verify request/response headers</li>
                        <li>Monitor WebSocket connections</li>
                        <li>Analyze timing and latency</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              <div className="alert alert-success">
                <h5><i className="bi bi-question-circle me-2"></i>Getting Help</h5>
                <p>If you're still having issues after trying these solutions:</p>
                <div className="row">
                  <div className="col-md-4">
                    <a href="https://github.com/orgs/modelcontextprotocol/discussions" target="_blank" rel="noopener noreferrer" className="btn btn-success btn-sm w-100 mb-2">
                      Community Discussions <i className="bi bi-box-arrow-up-right ms-1"></i>
                    </a>
                  </div>
                  <div className="col-md-4">
                    <a href="https://modelcontextprotocol.io/docs/tutorials/debugging" target="_blank" rel="noopener noreferrer" className="btn btn-outline-primary btn-sm w-100 mb-2">
                      Official Debug Guide <i className="bi bi-box-arrow-up-right ms-1"></i>
                    </a>
                  </div>
                  <div className="col-md-4">
                    <a href="https://github.com/modelcontextprotocol/inspector" target="_blank" rel="noopener noreferrer" className="btn btn-outline-info btn-sm w-100 mb-2">
                      MCP Inspector Tool <i className="bi bi-box-arrow-up-right ms-1"></i>
                    </a>
                  </div>
                </div>
                <hr />
                <p className="mb-0"><strong>When reporting issues:</strong> Include server logs, client configuration, error messages, and steps to reproduce the problem.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Troubleshooting;