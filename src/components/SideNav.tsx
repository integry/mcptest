import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Space } from '../types'; // Import Space type
import { getSpaceUrl } from '../utils/urlUtils';
import { VERSION_INFO, getGithubCommitUrl } from '../utils/versionInfo';

interface SideNavProps {
  activeView: 'playground' | 'dashboards' | 'docs';
  spaces: Space[];
  selectedSpaceId: string | null;
  handleSelectSpace: (id: string) => void;
  handleCreateSpace: (name: string) => void; // Function to handle creation
  handleReorderDashboards: (reorderedDashboards: Space[]) => void; // Function to handle reordering
  getSpaceHealthStatus: (spaceId: string) => { loading: boolean, successCount: number, totalCount: number };
  getSpaceHealthColor: (spaceId: string) => 'green' | 'orange' | 'red' | 'gray';
  performAllDashboardsHealthCheck: () => Promise<void>;
  onMoveCard: (sourceSpaceId: string, targetSpaceId: string, cardId: string) => void; // Function to handle card moves
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
}) => {
  const [newSpaceName, setNewSpaceName] = React.useState('');
  const [showCreateInput, setShowCreateInput] = React.useState(false);
  const [draggedSpaceId, setDraggedSpaceId] = React.useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = React.useState<number | null>(null);
  const [cardDropTargetSpaceId, setCardDropTargetSpaceId] = React.useState<string | null>(null);
  const navigate = useNavigate();

  const handlePlaygroundClick = () => {
    navigate('/');
    // Close mobile menu if open
    document.body.classList.remove('menu-open');
  };

  const handleCreateClick = () => {
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

  return (
    <nav className="nav flex-column d-flex flex-grow-1">
      {/* Playground Link */}
      <Link
        to="/"
        className={`nav-link ${activeView === 'playground' ? 'active fw-bold' : ''}`}
        onClick={handlePlaygroundClick}
      >
        <i className="bi bi-search me-2"></i> Playground
      </Link>

      {/* Dashboards Header */}
      <div className="d-flex justify-content-between align-items-center mt-3 mb-1">
        <h6 className="nav-link text-muted mb-0">Dashboards</h6>
        <button
          className="btn btn-sm btn-outline-secondary"
          onClick={performAllDashboardsHealthCheck}
          title="Refresh health status"
          style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
        >
          <i className="bi bi-arrow-clockwise"></i>
        </button>
      </div>

      {/* List of Dashboards */}
      <nav aria-label="Dashboards">
        <ul className="nav flex-column ms-3">
          {spaces.map((space, index) => (
            <li
              className={`nav-item ${dragOverIndex === index ? 'space-drag-over' : ''} ${cardDropTargetSpaceId === space.id ? 'card-drop-target' : ''}`}
            key={space.id}
            onDragOver={(e) => handleSpaceDragOver(e, index)}
            onDragLeave={handleSpaceDragLeave}
            onDrop={(e) => handleSpaceDrop(e, index)}
          >
            <Link
              to={getSpaceUrl(space.name)}
              className={`nav-link py-1 d-flex align-items-center ${selectedSpaceId === space.id && activeView === 'spaces' ? 'active fw-bold' : ''}`}
              draggable
              onDragStart={(e) => handleSpaceDragStart(e, space.id)}
              onDragEnd={handleSpaceDragEnd}
              onClick={() => {
                handleSelectSpace(space.id);
                // Close mobile menu if open
                document.body.classList.remove('menu-open');
              }}
              style={{ 
                cursor: 'move',
                opacity: draggedSpaceId === space.id ? 0.5 : 1,
                transition: 'opacity 0.2s ease',
                userSelect: 'none'
              }}
            >
              {renderHealthIndicator(space.id)}
              {space.name} ({space.cards.length})
            </Link>
          </li>
        ))}
        </ul>
      </nav>

      {/* Create New Dashboard */}
      <div className="mt-2 ms-3">
        {showCreateInput ? (
          <div className="input-group input-group-sm">
            <input
              type="text"
              className="form-control form-control-sm"
              placeholder="New dashboard name..."
              value={newSpaceName}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              autoFocus
            />
            <button className="btn btn-outline-success btn-sm" type="button" onClick={handleCreateConfirm} title="Create">
              <i className="bi bi-check-lg"></i>
            </button>
            <button className="btn btn-outline-secondary btn-sm" type="button" onClick={handleCreateCancel} title="Cancel">
              <i className="bi bi-x-lg"></i>
            </button>
          </div>
        ) : (
          <button className="btn btn-sm btn-outline-primary w-100" onClick={handleCreateClick}>
            <i className="bi bi-plus-lg me-1"></i> Create New Dashboard
          </button>
        )}
      </div>

      {/* Documentation Section */}
      <div className="mt-4">
        <h6 className="nav-link text-muted mb-1">Documentation</h6>
        <ul className="nav flex-column ms-3">
          <li className="nav-item">
            <Link
              to="/docs/what-is-mcp"
              className="nav-link py-1"
              onClick={() => document.body.classList.remove('menu-open')}
            >
              <i className="bi bi-info-circle me-2"></i> What is MCP?
            </Link>
          </li>
          <li className="nav-item">
            <Link
              to="/docs/remote-vs-local"
              className="nav-link py-1"
              onClick={() => document.body.classList.remove('menu-open')}
            >
              <i className="bi bi-cloud-arrow-up me-2"></i> Remote vs Local
            </Link>
          </li>
          <li className="nav-item">
            <Link
              to="/docs/testing-guide"
              className="nav-link py-1"
              onClick={() => document.body.classList.remove('menu-open')}
            >
              <i className="bi bi-check-circle me-2"></i> Testing Guide
            </Link>
          </li>
          <li className="nav-item">
            <Link
              to="/docs/troubleshooting"
              className="nav-link py-1"
              onClick={() => document.body.classList.remove('menu-open')}
            >
              <i className="bi bi-wrench me-2"></i> Troubleshooting
            </Link>
          </li>
        </ul>
      </div>

      {/* Footer Content */}
      <div className="mt-auto pt-3 border-top small">
        <div className="px-2 text-center">
          <p className="text-muted mb-1">
            &copy; {new Date().getFullYear()} <Link to="/docs/contact" className="text-muted">Unchained Development OÜ</Link>.
          </p>
          <div className="mb-2">
            <Link to="/docs/contact" className="text-muted me-2" style={{ fontSize: '0.8rem' }}>
              Contact
            </Link>
            <Link to="/docs/privacy-policy" className="text-muted me-2" style={{ fontSize: '0.8rem' }}>
              Privacy
            </Link>
            <Link to="/docs/terms-of-service" className="text-muted" style={{ fontSize: '0.8rem' }}>
              Terms
            </Link>
          </div>
          <div className="text-muted" style={{ fontSize: '0.75rem', opacity: 0.7 }}>
            <div>Updated: <a 
                href={getGithubCommitUrl(VERSION_INFO.commitHash)} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-muted"
                style={{ opacity: 0.7 }}
              >
                {new Date(VERSION_INFO.commitDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} {new Date(VERSION_INFO.commitDate).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
              </a></div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default SideNav;