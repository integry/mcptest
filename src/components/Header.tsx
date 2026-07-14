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
    <header className="app-header">
      <div className="app-header-brand">
        {/* Mobile Menu Toggle */}
        <button 
          className="mobile-menu-toggle d-md-none position-relative"
          onClick={() => document.body.classList.toggle('menu-open')}
          aria-label="Toggle navigation menu"
        >
          <span className="hamburger"></span>
        </button>

        {/* MCP/AI Logo */}
        <span
          className="app-logo"
          onClick={handleHomeClick}
        >
          <img src="/logo.png" alt="MCP Logo" width="40" height="40" />
        </span>
        <div className="app-brand-copy" onClick={handleHomeClick}>
          <h1 className="app-brand-title">mcptest.io</h1>
          <p className="app-brand-subtitle d-none d-md-block">
            Test remote MCP servers
          </p>
        </div>
      </div>

      <div className="app-header-actions d-none d-md-flex">
        <button
          onClick={onToggleTheme}
          className="btn btn-outline-secondary app-theme-toggle"
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          aria-label="Toggle color theme"
        >
          <i className={`theme-toggle-icon bi ${theme === 'light' ? 'bi-moon-stars-fill' : 'bi-sun-fill'}`}></i>
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
