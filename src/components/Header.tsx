import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="bg-dark text-white p-3 mb-3">
      <h1>mcptest.io</h1>
      <p className="mb-0">Test MCP servers using StreamableHTTP</p>
    </header>
  );
};

export default Header;