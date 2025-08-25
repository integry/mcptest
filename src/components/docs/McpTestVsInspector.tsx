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
            Both <strong>MCP Test</strong> and <strong>MCP Inspector</strong> are developer tools for the Model Context Protocol, but they serve different primary purposes. MCP Test is for automated testing and monitoring, while MCP Inspector is for manual, interactive debugging.
          </div>

          <div className="mb-4">
            <a href="https://modelcontextprotocol.io/legacy/tools/inspector" target="_blank" rel="noopener noreferrer" className="btn btn-outline-primary">
              <i className="bi bi-box-arrow-up-right me-2"></i>
              Visit MCP Inspector
            </a>
          </div>

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
                  <td>Automated health checks, monitoring, and creating shareable live views of server capabilities.</td>
                  <td>Interactive, real-time debugging and manual exploration of an MCP server.</td>
                </tr>
                <tr>
                  <th scope="row">Core Concept</th>
                  <td><strong>Dashboards & Cards:</strong> Create persistent dashboards with cards that represent specific tool calls or resource access requests.</td>
                  <td><strong>Live Connection:</strong> A single, stateful connection to one MCP server at a time for deep inspection.</td>
                </tr>
                <tr>
                  <th scope="row">Monitoring</th>
                  <td className="text-center"><i className="bi bi-check-circle-fill text-success"></i><br/>Designed for creating monitoring dashboards that continuously check server health.</td>
                  <td className="text-center"><i className="bi bi-x-circle-fill text-danger"></i><br/>Not designed for persistent monitoring.</td>
                </tr>
                <tr>
                  <th scope="row">Sharing</th>
                  <td className="text-center"><i className="bi bi-check-circle-fill text-success"></i><br/>Allows sharing of entire dashboards or individual card results via unique URLs.</td>
                  <td className="text-center"><i className="bi bi-x-circle-fill text-danger"></i><br/>No built-in sharing functionality.</td>
                </tr>
                <tr>
                  <th scope="row">User Interface</th>
                  <td>Dashboard-centric view, allowing for at-a-glance status of multiple servers and operations.</td>
                  <td>Single-pane-of-glass view for one server, showing logs, tools, and resources in detail.</td>
                </tr>
                 <tr>
                  <th scope="row">Best For</th>
                  <td>- Setting up health checks for production servers.<br/>- Creating demos of MCP server functionality.<br/>- Sharing live results with team members.</td>
                  <td>- Developing a new MCP server.<br/>- Debugging connection issues.<br/>- Manually testing tool inputs and outputs.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2>When to Use Which Tool?</h2>
          <div className="row">
            <div className="col-md-6 mb-3">
              <div className="card h-100 border-primary">
                <div className="card-body">
                  <h5 className="card-title"><i className="bi bi-clipboard2-pulse me-2"></i>Use MCP Test when...</h5>
                  <ul className="list-unstyled">
                    <li className="mb-2"><i className="bi bi-check text-success me-2"></i>You need to monitor the uptime and correctness of multiple MCP servers or endpoints.</li>
                    <li className="mb-2"><i className="bi bi-check text-success me-2"></i>You want to create a persistent, shareable dashboard showcasing a server's capabilities.</li>
                    <li className="mb-2"><i className="bi bi-check text-success me-2"></i>You need to provide a live, executable "snapshot" of a tool call or resource.</li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="col-md-6 mb-3">
              <div className="card h-100 border-info">
                <div className="card-body">
                  <h5 className="card-title"><i className="bi bi-search me-2"></i>Use MCP Inspector when...</h5>
                  <ul className="list-unstyled">
                    <li className="mb-2"><i className="bi bi-check text-success me-2"></i>You are actively developing a server and need to see real-time logs and connection status.</li>
                    <li className="mb-2"><i className="bi bi-check text-success me-2"></i>You need to manually trigger tools with different parameters to debug their behavior.</li>
                    <li className="mb-2"><i className="bi bi-check text-success me-2"></i>You are troubleshooting complex authentication or connection handshake issues.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default McpTestVsInspector;