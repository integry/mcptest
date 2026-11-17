import React, { useRef, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Space } from '../types'; // Import Space type
import { getSpaceUrl } from '../utils/urlUtils';
import { trackEvent } from '../utils/analytics';
import { useAuth } from '../context/AuthContext';
import {
  DASHBOARDS_NAVIGATION,
  NAVIGATION_GROUPS,
  PLAYGROUND_NAVIGATION,
  isNavigationItemActive,
  navigationDescriptionId,
  navigationTooltip,
  HEADER_COPY,
  SIGN_IN_HINT_ID,
  type NavigationLink,
} from '../content/navigation';
import { closeMobileDrawer, useMobileDrawer } from '../hooks/useMobileDrawer';

type ActiveView = 'playground' | 'dashboards' | 'docs' | 'learn' | 'report' | 'catalog' | 'server-profile' | 'breaking-changes' | 'discovery' | 'oauth-check' | 'mcp-test-servers' | 'mcp-test-client' | 'keyword-landing';

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
  const dashboardListRef = useRef<(HTMLAnchorElement | null)[]>([]);
  const navRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { currentUser, loginWithGoogle, logout } = useAuth();
  const authEnabled = import.meta.env.VITE_FIREBASE_AUTH_ENABLED === 'true';
  useMobileDrawer(isMobile, navRef);
  const idSuffix = isMobile ? 'mobile' : 'desktop';
  const dashboardsListId = `sidenav-dashboards-${idSuffix}`;
  const dashboardsExpanded = dashboardsOpen;
  useEffect(() => {
    if (focusedDashboardIndex !== null && dashboardListRef.current[focusedDashboardIndex]) {
      dashboardListRef.current[focusedDashboardIndex]?.focus();
    }
  }, [focusedDashboardIndex]);

  const handleDashboardsToggle = () => {
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



  const renderDescription = (item: NavigationLink) => (
    item.description
      ? <span id={navigationDescriptionId(item, idSuffix)} className="visually-hidden">{item.description}</span>
      : null
  );

  const renderLink = (item: NavigationLink, isActive: boolean, extraClass = '') => (
    <li className={`nav-item${extraClass ? ` ${extraClass}` : ''}`} key={item.path}>
      <Link
        to={item.path}
        className={`nav-link sidenav-link${item === PLAYGROUND_NAVIGATION ? ' sidenav-link--primary' : ''}${isActive ? ' active' : ''}`}
        aria-current={isActive ? 'page' : undefined}
        aria-describedby={item.description ? navigationDescriptionId(item, idSuffix) : undefined}
        onClick={closeMobileDrawer}
        title={navigationTooltip(item, false)}
      >
        <i className={`bi ${item.icon} sidenav-icon`} aria-hidden="true"></i>
        <span className="sidenav-label">{item.label}</span>
      </Link>
      {renderDescription(item)}
    </li>
  );

  const renderDashboards = () => {
    // A visitor who has never created a dashboard sees one entry that leads to
    // the dashboards page, which explains them and offers the create action.
    if (spaces.length === 0) {
      return renderLink(DASHBOARDS_NAVIGATION, activeView === 'dashboards', 'sidenav-dashboards');
    }
    return (
      <li className="nav-item sidenav-dashboards" key={DASHBOARDS_NAVIGATION.path}>
        <div className="sidenav-group-header">
          <button
            type="button"
            className={`nav-link sidenav-link sidenav-group-toggle${activeView === 'dashboards' ? ' active' : ''}`}
            aria-expanded={dashboardsExpanded}
            aria-controls={dashboardsListId}
            aria-describedby={navigationDescriptionId(DASHBOARDS_NAVIGATION, idSuffix)}
            onClick={handleDashboardsToggle}
            title={navigationTooltip(DASHBOARDS_NAVIGATION, false)}
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
        {renderDescription(DASHBOARDS_NAVIGATION)}

        <div id={dashboardsListId} className="sidenav-dashboards-body" hidden={!dashboardsExpanded}>
          <ul className="nav flex-column dashboard-list" onKeyDown={handleDashboardKeyDown} aria-label="Dashboards">
            {spaces.map((space, index) => (
              <li
                className={`nav-item ${dragOverIndex === index ? 'space-drag-over' : ''} ${cardDropTargetSpaceId === space.id ? 'card-drop-target' : ''}`}
                key={space.id}
                onDragOver={(e) => handleSpaceDragOver(e, index)}
                onDragLeave={handleSpaceDragLeave}
                onDrop={(e) => handleSpaceDrop(e, index)}
              >
                <Link
                  ref={(el) => { dashboardListRef.current[index] = el; }}
                  onFocus={() => setFocusedDashboardIndex(index)}
                  aria-current={selectedSpaceId === space.id && activeView === 'dashboards' ? 'page' : undefined}
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
              <button className="btn btn-sm btn-ghost btn-confirm" type="button" onClick={handleCreateConfirm} title="Create" aria-label="Create dashboard">
                <i className="bi bi-check-lg" aria-hidden="true"></i>
              </button>
              <button className="btn btn-sm btn-ghost" type="button" onClick={handleCreateCancel} title="Cancel" aria-label="Cancel">
                <i className="bi bi-x-lg" aria-hidden="true"></i>
              </button>
            </div>
          )}
        </div>
      </li>
    );
  };

  return (
    <nav
      ref={navRef}
      id={`app-sidenav-${idSuffix}`}
      className="app-sidenav d-flex flex-column flex-grow-1"
      aria-label="Main"
    >
      {/* Ordered by what people come to do: test and browse, the checks, then saved work */}
      {NAVIGATION_GROUPS.map(group => (
        <section
          key={group.id}
          className={`sidenav-group sidenav-group--${group.id}`}
          aria-labelledby={`sidenav-${group.id}-heading-${idSuffix}`}
        >
          <h2
            id={`sidenav-${group.id}-heading-${idSuffix}`}
            className={group.labelHidden ? 'visually-hidden' : 'sidenav-section-label'}
          >
            {group.label}
          </h2>
          <ul className="sidenav-list">
            {group.items.map(item => (
              item === DASHBOARDS_NAVIGATION
                ? renderDashboards()
                : renderLink(item, isNavigationItemActive(item, activeView))
            ))}
          </ul>
        </section>
      ))}

      {/* Keep article trees and search in the Guides hub. */}
        <section className="sidenav-group" aria-labelledby={`sidenav-learn-heading-${idSuffix}`}>
          <h2 id={`sidenav-learn-heading-${idSuffix}`} className="sidenav-section-label">Learn</h2>
          <Link to="/guides" className="nav-link sidenav-link" title="Guides" onClick={closeMobileDrawer} aria-current={pathname === '/guides' ? 'page' : undefined}>
            <i className="bi bi-book sidenav-icon" aria-hidden="true" /><span className="sidenav-label">Guides</span>
          </Link>
        </section>

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
                  <button type="button" className="btn btn-sm btn-outline-secondary w-100" onClick={logout}>Logout</button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary w-100"
                    onClick={loginWithGoogle}
                    aria-describedby={`${SIGN_IN_HINT_ID}-${idSuffix}`}
                  >
                    {HEADER_COPY.signIn}
                  </button>
                  <p id={`${SIGN_IN_HINT_ID}-${idSuffix}`} className="sidenav-auth-hint">{HEADER_COPY.signInDescription}</p>
                </>
              )}
            </div>
          )}
        </div>
      )}

    </nav>
  );
};

export default SideNav;
