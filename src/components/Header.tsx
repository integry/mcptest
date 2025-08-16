import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface HeaderProps {
  theme: string;
  onToggleTheme: () => void;
}

const Header: React.FC<HeaderProps> = ({ theme, onToggleTheme }) => {
  const navigate = useNavigate();
  const { currentUser, loginWithGoogle, logout } = useAuth();
  const authEnabled = import.meta.env.VITE_FIREBASE_AUTH_ENABLED === 'true';

  const handleHomeClick = () => {
    navigate('/');
  };

  return (
    <header className="border-bottom p-3 mb-3" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {/* Mobile Menu Toggle */}
        <button 
          className="mobile-menu-toggle d-md-none position-relative"
          onClick={() => document.body.classList.toggle('menu-open')}
          aria-label="Toggle navigation menu"
          style={{ position: 'relative', marginRight: '0.5rem' }}
        >
          <span className="hamburger"></span>
        </button>

        {/* MCP/AI Logo */}
        <span
          style={{ display: 'inline-flex', alignItems: 'center', height: 48, cursor: 'pointer' }}
          onClick={handleHomeClick}
        >
          <img src="/logo.png" alt="MCP Logo" width="44" height="44" style={{ filter: 'drop-shadow(0 2px 8px rgba(34, 197, 94, 0.3))' }} />
        </span>
        <div style={{ cursor: 'pointer' }} onClick={handleHomeClick}>
          <h1 style={{ marginBottom: 0, fontWeight: 700, fontSize: '2.1rem', letterSpacing: '0.01em', lineHeight: 1, color: 'var(--text-color)' }}>mcptest.io</h1>
          <p className="mb-0 d-none d-md-block" style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '1.08rem' }}>
            Test remote MCP servers
          </p>
        </div>
      </div>

      <div className="d-none d-md-flex" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button
          onClick={onToggleTheme}
          className="btn btn-outline-secondary"
          style={{ padding: '0.5rem 0.75rem', fontSize: '1.25rem', lineHeight: 1, border: 'none' }}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          <i className={`bi ${theme === 'light' ? 'bi-moon-stars-fill' : 'bi-sun-fill'}`}></i>
        </button>
        
        {authEnabled && (
          <>
            {currentUser ? (
              <div className="d-flex align-items-center">
                <img src={currentUser.photoURL || undefined} alt={currentUser.displayName || 'User'} className="rounded-circle" width="32" height="32" />
                <span className="ms-2 me-3">{currentUser.displayName}</span>
                <button className="btn btn-sm btn-outline-secondary" onClick={logout}>Logout</button>
              </div>
            ) : (
              <button className="btn btn-sm btn-primary" onClick={loginWithGoogle}>Login with Google</button>
            )}
          </>
        )}
      </div>
    </header>
  );
};

export default Header;