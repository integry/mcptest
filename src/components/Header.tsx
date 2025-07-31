import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Header: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, loginWithGoogle, logout } = useAuth();
  const authEnabled = import.meta.env.VITE_FIREBASE_AUTH_ENABLED === 'true';

  const handleHomeClick = () => {
    navigate('/');
  };

  return (
    <header className="bg-white border-bottom p-3 mb-3" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.1rem', cursor: 'pointer' }} onClick={handleHomeClick}>
        <span style={{ display: 'inline-flex', alignItems: 'center', height: 48 }}>
          <img src="/logo.png" alt="MCP Logo" width="44" height="44" style={{ filter: 'drop-shadow(0 2px 8px rgba(34, 197, 94, 0.3))' }} />
        </span>
        <div>
          <h1 style={{ marginBottom: 0, fontWeight: 700, fontSize: '2.1rem', letterSpacing: '0.01em', lineHeight: 1, color: '#1a1a1a' }}>mcptest.io</h1>
          <p className="mb-0" style={{ color: '#6b7280', fontWeight: 500, fontSize: '1.08rem' }}>
            Test remote MCP servers
          </p>
        </div>
      </div>
      {authEnabled && (
        <div>
          {currentUser ? (
            <div className="d-flex align-items-center">
              <img src={currentUser.photoURL || undefined} alt={currentUser.displayName || 'User'} className="rounded-circle" width="32" height="32" />
              <span className="ms-2 me-3">{currentUser.displayName}</span>
              <button className="btn btn-sm btn-outline-secondary" onClick={logout}>Logout</button>
            </div>
          ) : (
            <button className="btn btn-sm btn-primary" onClick={loginWithGoogle}>Login with Google</button>
          )}
        </div>
      )}
    </header>
  );
};

export default Header;