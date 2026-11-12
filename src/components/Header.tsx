import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface HeaderProps {
  theme: string;
  onToggleTheme: () => void;
}

const Header: React.FC<HeaderProps> = ({ theme, onToggleTheme }) => {
  const { currentUser, loading, loginWithGoogle, logout } = useAuth();
  const authEnabled = import.meta.env.VITE_FIREBASE_AUTH_ENABLED === 'true';

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

        <Link
          to="/"
          className="app-logo"
          aria-label="mcptest.io home"
        >
          <img src="/logo-96.png" alt="MCP Logo" width="40" height="40" />
        </Link>
        <Link to="/" className="app-brand-copy">
          <span className="app-brand-title">mcptest.io</span>
          <p className="app-brand-subtitle d-none d-md-block">
            Remote MCP Inspector
          </p>
        </Link>
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
            {loading ? (
              // Holds the sign-in button's space until auth resolves; the static
              // shell in dist/index.html renders the same placeholder.
              <button
                type="button"
                className="btn btn-sm btn-primary app-auth-placeholder"
                style={{ visibility: 'hidden' }}
                aria-hidden="true"
                tabIndex={-1}
                disabled
              >
                Login with Google
              </button>
            ) : currentUser ? (
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
