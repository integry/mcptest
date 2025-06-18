import React from 'react';

const TestingGuide: React.FC = () => {
  return (
    <div className="container-fluid py-4">
      <div className="row">
        <div className="col-lg-10 mx-auto">
          <div className="card">
            <div className="card-body">
              <h1 className="card-title mb-4">
                <i className="bi bi-check-circle text-success me-2"></i>
                MCP Server Testing Guide
              </h1>
              
              <p className="lead">Essential workflows for testing and validating MCP server implementations, with a focus on remote servers.</p>

              <div className="alert alert-info" role="alert">
                <i className="bi bi-info-circle me-2"></i>
                This guide covers testing both local and remote MCP servers using various tools and techniques.
              </div>

              <h2>Quick Server Validation</h2>
              <div className="card mb-4">
                <div className="card-body">
                  <h5>1. Basic Connection Test</h5>
                  <p>First, verify that your server accepts connections and responds to initialization:</p>
                  
                  <div className="row">
                    <div className="col-md-6">
                      <h6>Local Server (stdio)</h6>
                      <pre className="bg-light p-3 rounded"><code>{`# Test basic connectivity
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | your-server`}</code></pre>
                    </div>
                    <div className="col-md-6">
                      <h6>Remote Server (HTTP)</h6>
                      <pre className="bg-light p-3 rounded"><code>{`# Test HTTP endpoint
curl -X POST https://your-server.com/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize",...}'`}</code></pre>
                    </div>
                  </div>

                  <h5 className="mt-4">2. Capability Negotiation</h5>
                  <p>Verify that your server correctly advertises its capabilities:</p>
                  <ul>
                    <li>Check that the server responds with its supported features</li>
                    <li>Validate protocol version compatibility</li>
                    <li>Confirm that capabilities match your server's actual functionality</li>
                  </ul>
                </div>
              </div>

              <h2>Tool & Resource Testing</h2>
              <div className="row mb-4">
                <div className="col-lg-6">
                  <div className="card h-100">
                    <div className="card-header bg-primary text-white">
                      <h5 className="mb-0">Testing Tools</h5>
                    </div>
                    <div className="card-body">
                      <ol>
                        <li><strong>List available tools:</strong> Send <code>tools/list</code> request</li>
                        <li><strong>Validate tool schemas:</strong> Check input parameter definitions</li>
                        <li><strong>Test tool execution:</strong> Call each tool with valid parameters</li>
                        <li><strong>Error handling:</strong> Test with invalid inputs</li>
                        <li><strong>Response format:</strong> Verify output matches expected structure</li>
                      </ol>

                      <div className="alert alert-light mt-3">
                        <small><strong>Tip:</strong> Test edge cases like empty parameters, very large inputs, and special characters.</small>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-lg-6">
                  <div className="card h-100">
                    <div className="card-header bg-success text-white">
                      <h5 className="mb-0">Testing Resources</h5>
                    </div>
                    <div className="card-body">
                      <ol>
                        <li><strong>List resources:</strong> Send <code>resources/list</code> request</li>
                        <li><strong>Read static resources:</strong> Test direct URI access</li>
                        <li><strong>Template resources:</strong> Test parameterized URIs</li>
                        <li><strong>Subscribe to changes:</strong> Test notification system</li>
                        <li><strong>Content validation:</strong> Verify MIME types and encoding</li>
                      </ol>

                      <div className="alert alert-light mt-3">
                        <small><strong>Tip:</strong> Test both text and binary resources if your server supports them.</small>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <h2>Authentication Testing</h2>
              <div className="card mb-4">
                <div className="card-body">
                  <h5>For Remote Servers</h5>
                  <div className="row">
                    <div className="col-md-4">
                      <div className="card border-warning">
                        <div className="card-body">
                          <h6>OAuth Flow</h6>
                          <ul className="small mb-0">
                            <li>Authorization URL generation</li>
                            <li>Token exchange</li>
                            <li>Token refresh</li>
                            <li>Revocation handling</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="card border-info">
                        <div className="card-body">
                          <h6>Header Validation</h6>
                          <ul className="small mb-0">
                            <li>Authorization header format</li>
                            <li>Origin header checking</li>
                            <li>Session ID handling</li>
                            <li>CORS preflight</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="card border-danger">
                        <div className="card-body">
                          <h6>Security Tests</h6>
                          <ul className="small mb-0">
                            <li>Invalid token handling</li>
                            <li>Expired token behavior</li>
                            <li>Unauthorized access attempts</li>
                            <li>Rate limiting</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <h2>Testing Tools & Resources</h2>
              <div className="row mb-4">
                <div className="col-md-6 mb-3">
                  <div className="card border-0 bg-light h-100">
                    <div className="card-body">
                      <h5 className="card-title">
                        <i className="bi bi-tools text-primary me-2"></i>MCP Inspector
                      </h5>
                      <p className="card-text">Official debugging tool for interactive testing of MCP servers</p>
                      <ul className="small">
                        <li>Visual interface for testing tools and resources</li>
                        <li>Real-time message inspection</li>
                        <li>Support for both local and remote servers</li>
                      </ul>
                      <a href="https://github.com/modelcontextprotocol/inspector" target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
                        Get Inspector <i className="bi bi-box-arrow-up-right ms-1"></i>
                      </a>
                    </div>
                  </div>
                </div>
                <div className="col-md-6 mb-3">
                  <div className="card border-0 bg-light h-100">
                    <div className="card-body">
                      <h5 className="card-title">
                        <i className="bi bi-terminal text-success me-2"></i>Command Line Testing
                      </h5>
                      <p className="card-text">Use curl, wget, or custom scripts for automated testing</p>
                      <ul className="small">
                        <li>Scriptable test scenarios</li>
                        <li>CI/CD integration</li>
                        <li>Load testing capabilities</li>
                      </ul>
                      <a href="https://modelcontextprotocol.io/docs/tutorials/debugging" target="_blank" rel="noopener noreferrer" className="btn btn-success btn-sm">
                        Debug Guide <i className="bi bi-box-arrow-up-right ms-1"></i>
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              <h2>Common Test Scenarios</h2>
              <div className="accordion" id="testScenariosAccordion">
                <div className="accordion-item">
                  <h2 className="accordion-header" id="headingOne">
                    <button className="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#collapseOne">
                      Connection Reliability
                    </button>
                  </h2>
                  <div id="collapseOne" className="accordion-collapse collapse show" data-bs-parent="#testScenariosAccordion">
                    <div className="accordion-body">
                      <ul>
                        <li><strong>Network Interruption:</strong> Test behavior when connection drops</li>
                        <li><strong>Timeout Handling:</strong> Verify proper timeout responses</li>
                        <li><strong>Reconnection:</strong> Test automatic reconnection logic</li>
                        <li><strong>Concurrent Connections:</strong> Multiple clients to same server</li>
                      </ul>
                    </div>
                  </div>
                </div>
                <div className="accordion-item">
                  <h2 className="accordion-header" id="headingTwo">
                    <button className="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseTwo">
                      Data Validation
                    </button>
                  </h2>
                  <div id="collapseTwo" className="accordion-collapse collapse" data-bs-parent="#testScenariosAccordion">
                    <div className="accordion-body">
                      <ul>
                        <li><strong>Input Sanitization:</strong> SQL injection, path traversal attempts</li>
                        <li><strong>Data Types:</strong> Test with unexpected data types</li>
                        <li><strong>Size Limits:</strong> Very large payloads and responses</li>
                        <li><strong>Encoding:</strong> Unicode, special characters, binary data</li>
                      </ul>
                    </div>
                  </div>
                </div>
                <div className="accordion-item">
                  <h2 className="accordion-header" id="headingThree">
                    <button className="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseThree">
                      Performance Testing
                    </button>
                  </h2>
                  <div id="collapseThree" className="accordion-collapse collapse" data-bs-parent="#testScenariosAccordion">
                    <div className="accordion-body">
                      <ul>
                        <li><strong>Response Time:</strong> Measure latency under normal load</li>
                        <li><strong>Throughput:</strong> Requests per second capacity</li>
                        <li><strong>Memory Usage:</strong> Monitor resource consumption</li>
                        <li><strong>Concurrent Users:</strong> Load testing with multiple clients</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              <div className="alert alert-warning mt-4">
                <h5><i className="bi bi-exclamation-triangle me-2"></i>Testing Checklist</h5>
                <div className="row">
                  <div className="col-md-6">
                    <h6>Basic Functionality</h6>
                    <ul className="mb-0">
                      <li>□ Server starts successfully</li>
                      <li>□ Initialization handshake works</li>
                      <li>□ All advertised capabilities function</li>
                      <li>□ Error responses are well-formed</li>
                    </ul>
                  </div>
                  <div className="col-md-6">
                    <h6>Security & Reliability</h6>
                    <ul className="mb-0">
                      <li>□ Authentication works correctly</li>
                      <li>□ Invalid inputs are rejected safely</li>
                      <li>□ Rate limiting prevents abuse</li>
                      <li>□ Graceful degradation under load</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="alert alert-light border">
                <h5><i className="bi bi-book me-2"></i>Additional Resources</h5>
                <div className="row">
                  <div className="col-md-4">
                    <a href="https://github.com/modelcontextprotocol/servers" target="_blank" rel="noopener noreferrer" className="btn btn-outline-primary btn-sm w-100 mb-2">
                      Example Servers <i className="bi bi-box-arrow-up-right ms-1"></i>
                    </a>
                  </div>
                  <div className="col-md-4">
                    <a href="https://modelcontextprotocol.io/docs/concepts/tools" target="_blank" rel="noopener noreferrer" className="btn btn-outline-secondary btn-sm w-100 mb-2">
                      Tools Documentation <i className="bi bi-box-arrow-up-right ms-1"></i>
                    </a>
                  </div>
                  <div className="col-md-4">
                    <a href="https://github.com/orgs/modelcontextprotocol/discussions" target="_blank" rel="noopener noreferrer" className="btn btn-outline-info btn-sm w-100 mb-2">
                      Community Discussions <i className="bi bi-box-arrow-up-right ms-1"></i>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TestingGuide;