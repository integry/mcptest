import React from 'react';

const Contact: React.FC = () => {
  return (
    <div className="docs-content">
      <h1 className="mb-4">Contact</h1>
      
      <div className="row">
        <div className="col-md-8">
          
          <p className="mb-4">
            Email us with questions, feedback or support requests about mcptest.io.
          </p>
          
          <div className="contact-info">
            <h3 className="mb-3">Email</h3>
            <p className="mb-5">
              <a href="mailto:info@mcptest.io" className="btn btn-primary">
                <i className="bi bi-envelope me-2"></i>
                info@mcptest.io
              </a>
            </p>
            
            <h3 className="mb-3">Company information</h3>
            <div className="card mb-5">
              <div className="card-body">
                <h5 className="card-title">
                  <a href="https://www.teatmik.ee/en/personlegal/16785055-Unchained-Development-O%C3%9C" 
                     target="_blank" 
                     rel="noopener noreferrer"
                     className="text-decoration-none">
                    Unchained Development OÜ
                  </a>
                </h5>
                <p className="card-text">
                  <strong>Location:</strong> Tallinn, Estonia<br />
                  <strong>Registry code:</strong> 16785055
                </p>
              </div>
            </div>
          </div>
          
          <div className="mt-4">
            <h3 className="mb-3">Support</h3>
            <p>
              For help with a server you are testing, email
              <a href="mailto:info@mcptest.io" className="ms-1">info@mcptest.io</a> with the endpoint URL and
              the error you saw. A shared result or report link helps.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
};

export default Contact;