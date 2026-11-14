import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { HEADER_COPY, SIGN_IN_HINT_ID } from '../content/navigationLinks';
import { useMobileMenuOpen } from '../hooks/useMobileMenuOpen';
import { MENU_OPEN_CLASS } from '../utils/layoutState';

interface HeaderProps {
  theme: string;
  onToggleTheme: () => void;
}

/** The mobile drawer App renders; the hamburger controls it. */
export const MOBILE_DRAWER_ID = 'mobile-sidebar';

const Header: React.FC<HeaderProps> = ({ theme, onToggleTheme }) => {
  const { currentUser, loading, loginWithGoogle, logout } = useAuth();
  const authEnabled = import.meta.env.VITE_FIREBASE_AUTH_ENABLED === 'true';
  const menuOpen = useMobileMenuOpen();

  return (
    <header className="app-header">
      <div className="app-header-brand">
        {/* Mobile Menu Toggle */}
        <button
          type="button"
          className="mobile-menu-toggle d-md-none position-relative"
          onClick={() => document.body.classList.toggle(MENU_OPEN_CLASS)}
          aria-label="Toggle navigation menu"
          aria-expanded={menuOpen}
          aria-controls={MOBILE_DRAWER_ID}
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
            {HEADER_COPY.descriptor}
          </p>
        </Link>
      </div>

      <div className="app-header-actions d-none d-md-flex">
        <button
          type="button"
          onClick={onToggleTheme}
          className="btn btn-outline-secondary app-theme-toggle"
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          aria-label="Toggle color theme"
        >
          <i className={`theme-toggle-icon bi ${theme === 'light' ? 'bi-moon-stars-fill' : 'bi-sun-fill'}`} aria-hidden="true"></i>
        </button>

        {authEnabled && (
          <>
            {loading ? (
              // Holds the sign-in control's space until auth resolves; the static
              // shell in dist/index.html renders the same placeholder.
              <div className="app-auth app-auth-placeholder" style={{ visibility: 'hidden' }} aria-hidden="true">
                <span className="app-auth-hint">{HEADER_COPY.signInHint}</span>
                <button type="button" className="btn btn-sm app-signin-btn" tabIndex={-1} disabled>
                  <i className="bi bi-google" aria-hidden="true"></i>
                  {HEADER_COPY.signIn}
                </button>
              </div>
            ) : currentUser ? (
              <div className="d-flex align-items-center">
                <img src={currentUser.photoURL || undefined} alt={currentUser.displayName || 'User'} className="rounded-circle" width="32" height="32" />
                <span className="ms-2 me-3">{currentUser.displayName}</span>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={logout}>Logout</button>
              </div>
            ) : (
              <div className="app-auth">
                <span id={SIGN_IN_HINT_ID} className="app-auth-hint" title={HEADER_COPY.signInDescription}>
                  <span aria-hidden="true">{HEADER_COPY.signInHint}</span>
                  <span className="visually-hidden">{HEADER_COPY.signInDescription}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-sm app-signin-btn"
                  onClick={loginWithGoogle}
                  aria-describedby={SIGN_IN_HINT_ID}
                  title={HEADER_COPY.signInDescription}
                >
                  <i className="bi bi-google" aria-hidden="true"></i>
                  {HEADER_COPY.signIn}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </header>
  );
};

export default Header;
