import React from 'react';

const PrivacyPolicy: React.FC = () => {
  return (
    <div className="container-fluid py-4">
      <h1 className="mb-4">Privacy Policy</h1>
      <p className="lead">Your privacy is critically important to us. At mcptest.io, we have a few fundamental principles:</p>

      <div className="card my-4">
        <div className="card-body">
          <h5 className="card-title">Data Storage</h5>
          <p>
            All data you enter and generate while using mcptest.io, including server URLs, connection history, tool parameters, and logs, is stored exclusively in your web browser's <strong>local storage</strong>.
          </p>
          <div className="alert alert-success">
            <strong>We do not collect, transmit, or store any of your application data on our servers.</strong> Your information remains on your machine.
          </div>
          <p>
            Because data is stored locally, clearing your browser's cache or local storage will permanently delete your saved connections and history.
          </p>
        </div>
      </div>

      <div className="card my-4">
        <div className="card-body">
          <h5 className="card-title">Website Analytics</h5>
          <p>
            Like most website operators, mcptest.io may collect non-personally-identifying information of the sort that web browsers and servers typically make available, such as the browser type, language preference, referring site, and the date and time of each visitor request. Our purpose in collecting non-personally identifying information is to better understand how our visitors use the website.
          </p>
        </div>
      </div>
      
      <div className="card my-4">
        <div className="card-body">
            <h5 className="card-title">Contact Us</h5>
            <p>If you have any questions about this Privacy Policy, please contact us by email: <a href="mailto:info@mcptest.io">info@mcptest.io</a></p>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;