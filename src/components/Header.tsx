import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="bg-white border-bottom p-3 mb-3" style={{ display: 'flex', alignItems: 'center', gap: '1.1rem' }}>
      {/* MCP/AI Logo */}
      <span style={{ display: 'inline-flex', alignItems: 'center', height: 48 }}>
        <img src="/logo.png" alt="MCP Logo" width="44" height="44" style={{ filter: 'drop-shadow(0 2px 8px rgba(34, 197, 94, 0.3))' }} />
      </span>
      <div>
        <h1 style={{ marginBottom: 0, fontWeight: 700, fontSize: '2.1rem', letterSpacing: '0.01em', lineHeight: 1, color: '#1a1a1a' }}>mcptest.io</h1>
        <p className="mb-0" style={{ color: '#6b7280', fontWeight: 500, fontSize: '1.08rem' }}>
          Test MCP servers using StreamableHTTP
        </p>
      </div>
    </header>
  );
};

export default Header;