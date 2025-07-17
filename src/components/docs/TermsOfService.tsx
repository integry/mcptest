import React from 'react';

const TermsOfService: React.FC = () => {
  return (
    <div className="container-fluid py-4">
      <h1 className="mb-4">Terms of Service</h1>
      <p>Last updated: {new Date().toLocaleDateString()}</p>

      <p>Please read these Terms of Service ("Terms", "Terms of Service") carefully before using the mcptest.io website (the "Service") operated by Unchained Development OÜ ("us", "we", or "our").</p>

      <p>Your access to and use of the Service is conditioned on your acceptance of and compliance with these Terms. These Terms apply to all visitors, users, and others who access or use the Service.</p>

      <p>By accessing or using the Service you agree to be bound by these Terms. If you disagree with any part of the terms then you may not access the Service.</p>

      <div className="card my-4">
        <div className="card-body">
          <h5 className="card-title">Use of Service</h5>
          <p>
            The Service is provided for testing and debugging Model Context Protocol (MCP) servers. You are responsible for any and all server connections and tool executions made through the Service. You agree not to use the Service for any illegal or unauthorized purpose.
          </p>
        </div>
      </div>

      <div className="card my-4">
        <div className="card-body">
          <h5 className="card-title">Disclaimer of Warranty</h5>
          <p>
            The Service is provided on an "AS IS" and "AS AVAILABLE" basis. The Service is provided without warranties of any kind, whether express or implied, including, but not limited to, implied warranties of merchantability, fitness for a particular purpose, non-infringement or course of performance.
          </p>
        </div>
      </div>

      <div className="card my-4">
        <div className="card-body">
            <h5 className="card-title">Limitation Of Liability</h5>
            <p>
                In no event shall Unchained Development OÜ, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from your access to or use of or inability to access or use the Service.
            </p>
        </div>
      </div>

      <div className="card my-4">
        <div className="card-body">
          <h5 className="card-title">Changes</h5>
          <p>
            We reserve the right, at our sole discretion, to modify or replace these Terms at any time. We will try to provide at least 30 days' notice prior to any new terms taking effect. What constitutes a material change will be determined at our sole discretion.
          </p>
        </div>
      </div>
      
       <div className="card my-4">
        <div className="card-body">
            <h5 className="card-title">Contact Us</h5>
            <p>If you have any questions about these Terms, please contact us at <a href="mailto:info@mcptest.io">info@mcptest.io</a>.</p>
        </div>
      </div>

    </div>
  );
};

export default TermsOfService;