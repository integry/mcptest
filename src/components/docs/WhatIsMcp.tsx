import React from 'react';

const WhatIsMcp: React.FC = () => {
  return (
    <div className="container-fluid py-4">
      <div className="row">
        <div className="col-lg-8 mx-auto">
          <div className="card">
            <div className="card-body">
              <h1 className="card-title mb-4">
                <i className="bi bi-info-circle text-primary me-2"></i>
                What is MCP?
              </h1>
              
              <div className="alert alert-info" role="alert">
                <strong>Model Context Protocol (MCP)</strong> is an open protocol that enables seamless integration between LLM applications and external data sources and tools.
              </div>

              <h2>Key Concepts</h2>
              <div className="row mb-4">
                <div className="col-md-4 mb-3">
                  <div className="card h-100 border-primary">
                    <div className="card-body text-center">
                      <i className="bi bi-server text-primary" style={{fontSize: '2rem'}}></i>
                      <h5 className="card-title mt-2">Servers</h5>
                      <p className="card-text">Services that provide context, tools, and capabilities to AI applications</p>
                    </div>
                  </div>
                </div>
                <div className="col-md-4 mb-3">
                  <div className="card h-100 border-success">
                    <div className="card-body text-center">
                      <i className="bi bi-laptop text-success" style={{fontSize: '2rem'}}></i>
                      <h5 className="card-title mt-2">Clients</h5>
                      <p className="card-text">AI applications that connect to servers to access data and functionality</p>
                    </div>
                  </div>
                </div>
                <div className="col-md-4 mb-3">
                  <div className="card h-100 border-warning">
                    <div className="card-body text-center">
                      <i className="bi bi-arrow-left-right text-warning" style={{fontSize: '2rem'}}></i>
                      <h5 className="card-title mt-2">Transports</h5>
                      <p className="card-text">Communication methods like stdio (local) and HTTP (remote)</p>
                    </div>
                  </div>
                </div>
              </div>

              <h2>What MCP Provides</h2>
              <ul className="list-group list-group-flush mb-4">
                <li className="list-group-item">
                  <strong>Resources:</strong> Access to data and content (files, databases, APIs)
                </li>
                <li className="list-group-item">
                  <strong>Tools:</strong> Functions that LLMs can execute to perform actions
                </li>
                <li className="list-group-item">
                  <strong>Prompts:</strong> Reusable templates and workflows for AI interactions
                </li>
                <li className="list-group-item">
                  <strong>Standardization:</strong> Universal protocol that works across AI applications
                </li>
              </ul>

              <h2>Why Use MCP?</h2>
              <div className="row mb-4">
                <div className="col-md-6">
                  <h5><i className="bi bi-puzzle text-success me-2"></i>Composable</h5>
                  <p>Mix and match different servers to create powerful AI workflows</p>
                </div>
                <div className="col-md-6">
                  <h5><i className="bi bi-shield-check text-primary me-2"></i>Secure</h5>
                  <p>Built-in security controls with user consent and access management</p>
                </div>
                <div className="col-md-6">
                  <h5><i className="bi bi-arrow-repeat text-warning me-2"></i>Reusable</h5>
                  <p>Build once, use across any MCP-compatible AI application</p>
                </div>
                <div className="col-md-6">
                  <h5><i className="bi bi-code-square text-info me-2"></i>Developer-Friendly</h5>
                  <p>Simple APIs and SDKs for quick integration</p>
                </div>
              </div>

              <div className="alert alert-light border">
                <h5><i className="bi bi-lightbulb text-warning me-2"></i>Think of MCP like USB-C for AI</h5>
                <p className="mb-0">Just as USB-C provides a standardized way to connect devices to various peripherals, MCP provides a standardized way to connect AI models to different data sources and tools.</p>
              </div>

              <h2>Learn More</h2>
              <div className="row">
                <div className="col-md-6 mb-3">
                  <div className="card border-0 bg-light">
                    <div className="card-body">
                      <h6 className="card-title">
                        <i className="bi bi-book me-2"></i>Official Documentation
                      </h6>
                      <p className="card-text">Complete guides and specifications</p>
                      <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
                        Visit Docs <i className="bi bi-box-arrow-up-right ms-1"></i>
                      </a>
                    </div>
                  </div>
                </div>
                <div className="col-md-6 mb-3">
                  <div className="card border-0 bg-light">
                    <div className="card-body">
                      <h6 className="card-title">
                        <i className="bi bi-file-earmark-code me-2"></i>Technical Specification
                      </h6>
                      <p className="card-text">Detailed protocol specification</p>
                      <a href="https://spec.modelcontextprotocol.io" target="_blank" rel="noopener noreferrer" className="btn btn-outline-primary btn-sm">
                        View Spec <i className="bi bi-box-arrow-up-right ms-1"></i>
                      </a>
                    </div>
                  </div>
                </div>
                <div className="col-md-6 mb-3">
                  <div className="card border-0 bg-light">
                    <div className="card-body">
                      <h6 className="card-title">
                        <i className="bi bi-github me-2"></i>Example Servers
                      </h6>
                      <p className="card-text">Ready-to-use MCP server implementations</p>
                      <a href="https://github.com/modelcontextprotocol/servers" target="_blank" rel="noopener noreferrer" className="btn btn-outline-secondary btn-sm">
                        Browse Examples <i className="bi bi-box-arrow-up-right ms-1"></i>
                      </a>
                    </div>
                  </div>
                </div>
                <div className="col-md-6 mb-3">
                  <div className="card border-0 bg-light">
                    <div className="card-body">
                      <h6 className="card-title">
                        <i className="bi bi-tools me-2"></i>MCP Inspector
                      </h6>
                      <p className="card-text">Debug and test MCP servers</p>
                      <a href="https://github.com/modelcontextprotocol/inspector" target="_blank" rel="noopener noreferrer" className="btn btn-outline-info btn-sm">
                        Get Inspector <i className="bi bi-box-arrow-up-right ms-1"></i>
                      </a>
                    </div>
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

export default WhatIsMcp;