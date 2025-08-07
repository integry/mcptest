import React from 'react';

const Footer: React.FC = () => {
  return (
    <footer className="border-top p-3 mt-auto" style={{ backgroundColor: 'var(--card-bg)', color: 'var(--text-color)' }}>
      <div className="container-fluid">
        <div className="row align-items-center">
          <div className="col-12 col-md-8">
            <p className="text-muted small mb-1">
              &copy; {new Date().getFullYear()} <a href="/docs/contact" className="text-muted">Unchained Development OÜ</a>. All rights reserved.
            </p>
            <p className="text-muted small mb-0">
              Your application data, including server connections and history, is stored only in your browser's local storage. No data is gathered or stored on our servers.
            </p>
          </div>
          <div className="col-12 col-md-4 text-md-end mt-2 mt-md-0">
            <a href="/docs/contact" className="text-muted small me-3">
              Contact
            </a>
            <a href="/docs/privacy-policy" className="text-muted small me-3">
              Privacy Policy
            </a>
            <a href="/docs/terms-of-service" className="text-muted small">
              Terms of Service
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;