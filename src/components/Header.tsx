import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="bg-dark text-white p-3 mb-3" style={{ display: 'flex', alignItems: 'center', gap: '1.1rem' }}>
      {/* MCP/AI Logo */}
      <span style={{ display: 'inline-flex', alignItems: 'center', height: 48 }}>
        <svg width="44" height="44" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 2px 8px #3b82f655)' }}>
          <rect x="8" y="8" width="32" height="32" rx="7" fill="#fff" stroke="#3b82f6" strokeWidth="2.5"/>
          <rect x="17" y="17" width="14" height="14" rx="4" fill="#dbeafe" stroke="#3b82f6" strokeWidth="2"/>
          <circle cx="24" cy="24" r="2.8" fill="#3b82f6" />
          <rect x="23.1" y="2.5" width="1.8" height="7" rx="0.9" fill="#3b82f6" />
          <rect x="23.1" y="38.5" width="1.8" height="7" rx="0.9" fill="#3b82f6" />
          <rect x="2.5" y="23.1" width="7" height="1.8" rx="0.9" fill="#3b82f6" />
          <rect x="38.5" y="23.1" width="7" height="1.8" rx="0.9" fill="#3b82f6" />
        </svg>
      </span>
      <div>
        <h1 style={{ marginBottom: 0, fontWeight: 700, fontSize: '2.1rem', letterSpacing: '0.01em', lineHeight: 1 }}>mcptest.io</h1>
        <p className="mb-0" style={{ color: '#e0e7ff', fontWeight: 500, fontSize: '1.08rem' }}>
          Test MCP servers using StreamableHTTP
        </p>
      </div>
    </header>
  );
};

export default Header;