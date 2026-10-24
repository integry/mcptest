import React, { useRef, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Space } from '../types'; // Import Space type
import { getSpaceUrl } from '../utils/urlUtils';
import { trackEvent } from '../utils/analytics';
import { VERSION_INFO, getGithubCommitUrl } from '../utils/versionInfo';
import { useAuth } from '../context/AuthContext';
import {
  DASHBOARDS_NAVIGATION,
  FOOTER_NAVIGATION,
  LEGAL_NAVIGATION,
  PRIMARY_NAVIGATION,
} from '../content/navigation';
import { useSidebarCollapsed } from '../hooks/useSidebarCollapsed';
import { closeMobileDrawer, useMobileDrawer } from '../hooks/useMobileDrawer';
import ContentTrackNav from './learn/ContentTrackNav';
import GuideSearch from './learn/GuideSearch';
import { isGuideSearchShortcutView } from './learn/guideSearchShortcut';

type ActiveView = 'playground' | 'dashboards' | 'docs' | 'learn' | 'report' | 'catalog' | 'server-profile' | 'breaking-changes' | 'discovery';

interface SideNavProps {
  activeView: ActiveView;
  spaces: Space[];
  selectedSpaceId: string | null;
  handleSelectSpace: (id: string) => void;
  handleCreateSpace: (name: string) => void; // Function to handle creation
  handleReorderDashboards: (reorderedDashboards: Space[]) => void; // Function to handle reordering
  getSpaceHealthStatus: (spaceId: string) => { loading: boolean, successCount: number, totalCount: number };
  getSpaceHealthColor: (spaceId: string) => 'green' | 'orange' | 'red' | 'gray';
  performAllDashboardsHealthCheck: () => Promise<void>;
  onMoveCard: (sourceSpaceId: string, targetSpaceId: string, cardId: string) => void; // Function to handle card moves
  theme?: string;
  onToggleTheme?: () => void;
  isMobile?: boolean;
}

/** Which views light up each primary link; the catalog owns server profiles too. */
const PRIMARY_ACTIVE_VIEWS: Record<string, ActiveView[]> = {
  '/': ['playground'],
  '/catalog': ['catalog', 'server-profile'],
  '/report': ['report'],
  '/tools/breaking-changes': ['breaking-changes'],
  '/tools/discovery': ['discovery'],
};

const SideNav: React.FC<SideNavProps> = ({
  activeView,
  spaces,
  selectedSpaceId,
  handleSelectSpace,
  handleCreateSpace,
  handleReorderDashboards,
  getSpaceHealthStatus,
  getSpaceHealthColor,
  performAllDashboardsHealthCheck,
  onMoveCard,
  theme,
  onToggleTheme,
  isMobile = false,
}) => {
  const [newSpaceName, setNewSpaceName] = React.useState('');
  const [showCreateInput, setShowCreateInput] = React.useState(false);
  const [dashboardsOpen, setDashboardsOpen] = React.useState(true);
  const [draggedSpaceId, setDraggedSpaceId] = React.useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = React.useState<number | null>(null);
  const [cardDropTargetSpaceId, setCardDropTargetSpaceId] = React.useState<string | null>(null);
  const [focusedDashboardIndex, setFocusedDashboardIndex] = useState<number | null>(null);
  const dashboardListRef = useRef<(HTMLLIElement | null)[]>([]);
  const navRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const { currentUser, loginWithGoogle, logout } = useAuth();
  const authEnabled = import.meta.env.VITE_FIREBASE_AUTH_ENABLED === 'true';
  const [collapsed, toggleCollapsed, expandSidebar] = useSidebarCollapsed(!isMobile);
  useMobileDrawer(isMobile, navRef);
  const idSuffix = isMobile ? 'mobile' : 'desktop';
  const dashboardsListId = `sidenav-dashboards-${idSuffix}`;
  const dashboardsExpanded = dashboardsOpen && !collapsed;

  useEffect(() => {
    if (focusedDashboardIndex !== null && dashboardListRef.current[focusedDashboardIndex]) {
      dashboardListRef.current[focusedDashboardIndex]?.focus();
    }
  }, [focusedDashboardIndex]);

  const handleDashboardsToggle = () => {
    if (collapsed) {
      expandSidebar();
      setDashboardsOpen(true);
      return;
    }
    setDashboardsOpen(open => !open);
  };

  const handleCreateClick = () => {
    setDashboardsOpen(true);
    setShowCreateInput(true);
  };

  const handleCreateConfirm = () => {
    if (newSpaceName.trim()) {
      handleCreateSpace(newSpaceName.trim());
      setNewSpaceName('');
      setShowCreateInput(false);
    }
  };

  const handleCreateCancel = () => {
    setNewSpaceName('');
    setShowCreateInput(false);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setNewSpaceName(event.target.value);
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleCreateConfirm();
    } else if (event.key === 'Escape') {
      handleCreateCancel();
    }
  };

  const handleDashboardKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const newIndex = focusedDashboardIndex === null ? 0 : Math.min(focusedDashboardIndex + 1, spaces.length - 1);
      setFocusedDashboardIndex(newIndex);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const newIndex = focusedDashboardIndex === null ? spaces.length - 1 : Math.max(focusedDashboardIndex - 1, 0);
      setFocusedDashboardIndex(newIndex);
    } else if (event.key === 'Enter' && focusedDashboardIndex !== null) {
      event.preventDefault();
      const space = spaces[focusedDashboardIndex];
      if (space) {
        navigate(getSpaceUrl(space.name));
        handleSelectSpace(space.id);
        closeMobileDrawer();
      }
    }
  };

  const handleSpaceDragStart = (e: React.DragEvent, spaceId: string) => {
    setDraggedSpaceId(spaceId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', spaceId);
  };

  const handleSpaceDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();

    // Check if this is a card being dragged (from the data format)
    try {
      const dragData = e.dataTransfer.getData('text/plain');
      const parsedData = JSON.parse(dragData);
      if (parsedData.cardId && parsedData.sourceSpaceId) {
        // This is a card being dragged
        e.dataTransfer.dropEffect = 'move';
        setCardDropTargetSpaceId(spaces[index].id);
        return;
      }
    } catch {
      // Not JSON, likely a space drag - continue with space reordering
    }

    // This is a space being dragged for reordering
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleSpaceDragLeave = () => {
    setDragOverIndex(null);
    setCardDropTargetSpaceId(null);
  };

  const handleSpaceDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    setDragOverIndex(null);
    setCardDropTargetSpaceId(null);

    // Check if this is a card being dropped
    try {
      const dragData = e.dataTransfer.getData('text/plain');
      const parsedData = JSON.parse(dragData);
      if (parsedData.cardId && parsedData.sourceSpaceId) {
        // This is a card drop
        const targetSpaceId = spaces[dropIndex].id;
        const sourceSpaceId = parsedData.sourceSpaceId;
        const cardId = parsedData.cardId;

        // Don't move if dropping on the same space
        if (targetSpaceId !== sourceSpaceId) {
          onMoveCard(sourceSpaceId, targetSpaceId, cardId);
        }
        return;
      }
    } catch {
      // Not JSON, continue with space reordering
    }

    // This is a space reordering
    if (!draggedSpaceId) return;

    const draggedIndex = spaces.findIndex(space => space.id === draggedSpaceId);
    if (draggedIndex === -1 || draggedIndex === dropIndex) return;

    // Reorder the spaces array
    const newSpaces = [...spaces];
    const [draggedSpace] = newSpaces.splice(draggedIndex, 1);
    newSpaces.splice(dropIndex, 0, draggedSpace);

    // Update the dashboards order
    handleReorderDashboards(newSpaces);
    setDraggedSpaceId(null);
  };

  const handleSpaceDragEnd = () => {
    setDraggedSpaceId(null);
    setDragOverIndex(null);
    setCardDropTargetSpaceId(null);
  };

  const renderHealthIndicator = (spaceId: string) => {
    const status = getSpaceHealthStatus(spaceId);
    const color = getSpaceHealthColor(spaceId);

    if (status.loading) {
      return (
        <div
          className="spinner-border spinner-border-sm me-2"
          style={{
            width: '12px',
            height: '12px',
            color: '#6c757d',
            verticalAlign: 'middle',
            position: 'relative',
            top: '-1px'
          }}
          role="status"
        >
          <span className="visually-hidden">Loading...</span>
        </div>
      );
    }

    const colorMap = {
      green: '#28a745',
      orange: '#fd7e14',
      red: '#dc3545',
      gray: '#6c757d'
    };

    return (
      <span
        className={`me-2 health-indicator health-indicator-${color}`}
        style={{
          display: 'inline-block',
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          backgroundColor: colorMap[color],
          flexShrink: 0,
          verticalAlign: 'middle',
          position: 'relative',
          top: '-1px'
        }}
        title={
          status.totalCount > 0
            ? `${status.successCount}/${status.totalCount} cards working`
            : 'No cards to check'
        }
      />
    );
  };

  const buildDate = new Date(VERSION_INFO.commitDate);

  return (
    <nav
      ref={navRef}
      id={`app-sidenav-${idSuffix}`}
      className={`app-sidenav d-flex flex-column flex-grow-1${collapsed ? ' app-sidenav--collapsed' : ''}`}
      aria-label="Main"
    >
      {/* Workspace: app destinations plus the collapsible dashboards group */}
      <section className="sidenav-group" aria-labelledby={`workspace-nav-heading-${idSuffix}`}>
        <h2 id={`workspace-nav-heading-${idSuffix}`} className="sidenav-section-label">Workspace</h2>
        <ul className="sidenav-list">
          {PRIMARY_NAVIGATION.map(item => {
            const isActive = (PRIMARY_ACTIVE_VIEWS[item.path] ?? []).includes(activeView);
            return (
              <li className="nav-item" key={item.path}>
                <Link
                  to={item.path}
                  className={`nav-link sidenav-link${isActive ? ' active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={closeMobileDrawer}
                  title={collapsed ? item.label : undefined}
                >
                  <i className={`bi ${item.icon} sidenav-icon`} aria-hidden="true"></i>
                  <span className="sidenav-label">{item.label}</span>
                </Link>
              </li>
            );
          })}

          <li className="nav-item sidenav-dashboards">
            <div className="sidenav-group-header">
              <button
                type="button"
                className={`nav-link sidenav-link sidenav-group-toggle${activeView === 'dashboards' ? ' active' : ''}`}
                aria-expanded={dashboardsExpanded}
                aria-controls={dashboardsListId}
                onClick={handleDashboardsToggle}
                title={collapsed ? DASHBOARDS_NAVIGATION.label : undefined}
              >
                <i className={`bi ${DASHBOARDS_NAVIGATION.icon} sidenav-icon`} aria-hidden="true"></i>
                <span className="sidenav-label">{DASHBOARDS_NAVIGATION.label}</span>
                <i className="bi bi-chevron-right sidenav-chevron" aria-hidden="true"></i>
              </button>
              <div className="sidenav-group-actions">
                <button
                  type="button"
                  className="btn btn-sm btn-ghost sidenav-action"
                  onClick={performAllDashboardsHealthCheck}
                  title="Refresh health status"
                  aria-label="Refresh health status of all dashboards"
                >
                  <i className="bi bi-arrow-clockwise" aria-hidden="true"></i>
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost sidenav-action"
                  onClick={handleCreateClick}
                  title="Create new dashboard"
                  aria-label="Create new dashboard"
                >
                  <i className="bi bi-plus-lg" aria-hidden="true"></i>
                </button>
              </div>
            </div>

            <div id={dashboardsListId} className="sidenav-dashboards-body" hidden={!dashboardsExpanded}>
              {spaces.length === 0 && !showCreateInput ? (
                <p className="sidenav-empty-hint">Create a dashboard to pin saved connections.</p>
              ) : (
                <ul className="nav flex-column dashboard-list" onKeyDown={handleDashboardKeyDown} role="listbox" aria-label="Dashboards">
                  {spaces.map((space, index) => (
                    <li
                      ref={(el) => { dashboardListRef.current[index] = el; }}
                      className={`nav-item ${dragOverIndex === index ? 'space-drag-over' : ''} ${cardDropTargetSpaceId === space.id ? 'card-drop-target' : ''}`}
                      key={space.id}
                      onDragOver={(e) => handleSpaceDragOver(e, index)}
                      onDragLeave={handleSpaceDragLeave}
                      onDrop={(e) => handleSpaceDrop(e, index)}
                      tabIndex={focusedDashboardIndex === index ? 0 : -1}
                      role="option"
                      aria-selected={selectedSpaceId === space.id && activeView === 'dashboards'}
                      onFocus={() => setFocusedDashboardIndex(index)}
                    >
                      <Link
                        to={getSpaceUrl(space.name)}
                        className={`dashboard-link nav-link sidenav-sublink py-1 d-flex align-items-center ${selectedSpaceId === space.id && activeView === 'dashboards' ? 'active' : ''}`}
                        draggable
                        onDragStart={(e) => handleSpaceDragStart(e, space.id)}
                        onDragEnd={handleSpaceDragEnd}
                        onClick={() => {
                          handleSelectSpace(space.id);
                          closeMobileDrawer();
                        }}
                        style={{
                          cursor: 'move',
                          opacity: draggedSpaceId === space.id ? 0.5 : 1,
                          transition: 'opacity 0.2s ease',
                          userSelect: 'none'
                        }}
                      >
                        {renderHealthIndicator(space.id)}
                        <span className="dashboard-name flex-grow-1 text-truncate" title={space.name}>{space.name}</span>
                        <span
                          className="dashboard-card-count"
                          title={`${space.cards.length} saved connection ${space.cards.length === 1 ? 'card' : 'cards'}`}
                          aria-label={`${space.cards.length} saved connection ${space.cards.length === 1 ? 'card' : 'cards'}`}
                        >
                          {space.cards.length} {space.cards.length === 1 ? 'card' : 'cards'}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              {showCreateInput && (
                <div className="inline-edit-group sidenav-create">
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    placeholder="New dashboard name..."
                    aria-label="New dashboard name"
                    value={newSpaceName}
                    onChange={handleInputChange}
                    onKeyDown={handleInputKeyDown}
                    autoFocus
                  />
                  <button className="btn btn-sm btn-ghost btn-confirm" type="button" onClick={handleCreateConfirm} title="Create">
                    <i className="bi bi-check-lg"></i>
                  </button>
                  <button className="btn btn-sm btn-ghost" type="button" onClick={handleCreateCancel} title="Cancel">
                    <i className="bi bi-x-lg"></i>
                  </button>
                </div>
              )}
            </div>
          </li>
        </ul>
      </section>

      {/* Learn: the guide hub and the four tracks, with the current track expanded */}
      <ContentTrackNav
        onNavigate={closeMobileDrawer}
        collapsed={collapsed}
        onExpandSidebar={expandSidebar}
        idPrefix={`sidenav-${idSuffix}`}
        search={(
          <GuideSearch
            idPrefix={`sidenav-${idSuffix}`}
            shortcutEnabled={!isMobile && isGuideSearchShortcutView(activeView)}
            collapsed={collapsed}
            onExpandSidebar={expandSidebar}
            onNavigate={closeMobileDrawer}
          />
        )}
      />

      {/* Theme and Auth Controls - Only show on mobile */}
      {isMobile && (
        <div className="sidenav-mobile-controls">
          <div className="d-flex align-items-center justify-content-between">
            <span className="text-muted">Theme</span>
            <button
              type="button"
              onClick={onToggleTheme}
              className="btn btn-ghost sidenav-theme-toggle"
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            >
              <i className={`bi ${theme === 'light' ? 'bi-moon-stars-fill' : 'bi-sun-fill'}`} aria-hidden="true"></i>
            </button>
          </div>

          {authEnabled && (
            <div className="pt-3">
              {currentUser ? (
                <div className="d-flex flex-column align-items-center">
                  <div className="d-flex align-items-center mb-2">
                    <img src={currentUser.photoURL || undefined} alt={currentUser.displayName || 'User'} className="rounded-circle me-2" width="32" height="32" />
                    <span>{currentUser.displayName}</span>
                  </div>
                  <button className="btn btn-sm btn-outline-secondary w-100" onClick={logout}>Logout</button>
                </div>
              ) : (
                <button className="btn btn-sm btn-primary w-100" onClick={loginWithGoogle}>Login with Google</button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer: project links, legal links and the build, in quieter type */}
      <div className="sidenav-footer">
        <ul className="sidenav-footer-links" aria-label="Project links">
          {FOOTER_NAVIGATION.map(link => (
            <li key={link.href}>
              {link.external ? (
                <a href={link.href} target="_blank" rel="noopener noreferrer" className="sidenav-footer-link">
                  {link.label}
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              ) : (
                <Link to={link.href} className="sidenav-footer-link" onClick={closeMobileDrawer}>
                  {link.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
        <div className="sidenav-legal">
          {LEGAL_NAVIGATION.map(link => (
            <Link key={link.href} to={link.href} className="sidenav-footer-link" onClick={closeMobileDrawer}>
              {link.label}
            </Link>
          ))}
        </div>
        <p className="sidenav-build">
          <span>&copy; {new Date().getFullYear()} Unchained Development OÜ</span>
          <span>
            Updated{' '}
            <a
              href={getGithubCommitUrl(VERSION_INFO.commitHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="sidenav-footer-link"
            >
              <time dateTime={VERSION_INFO.commitDate}>
                {buildDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}{' '}
                {buildDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </time>
            </a>
          </span>
        </p>
        {!isMobile && (
          <button
            type="button"
            className="sidenav-collapse-toggle"
            onClick={() => {
              trackEvent('sidebar_collapse', { collapsed: !collapsed });
              toggleCollapsed();
            }}
            aria-expanded={!collapsed}
            aria-controls={`app-sidenav-${idSuffix}`}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <i className={`bi ${collapsed ? 'bi-chevron-double-right' : 'bi-chevron-double-left'}`} aria-hidden="true"></i>
            <span className="sidenav-label">Collapse</span>
          </button>
        )}
      </div>
    </nav>
  );
};

export default SideNav;
