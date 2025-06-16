import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Space } from '../types'; // Import Space type
import { getSpaceUrl } from '../utils/urlUtils';

interface SideNavProps {
  activeView: 'inspector' | 'spaces';
  setActiveView: (view: 'inspector' | 'spaces') => void;
  spaces: Space[];
  selectedSpaceId: string | null;
  handleSelectSpace: (id: string) => void;
  handleCreateSpace: (name: string) => void; // Function to handle creation
  handleReorderSpaces: (reorderedSpaces: Space[]) => void; // Function to handle reordering
  getSpaceHealthStatus: (spaceId: string) => { loading: boolean, successCount: number, totalCount: number };
  getSpaceHealthColor: (spaceId: string) => 'green' | 'orange' | 'red' | 'gray';
  performAllSpacesHealthCheck: () => Promise<void>;
}

const SideNav: React.FC<SideNavProps> = ({
  activeView,
  setActiveView,
  spaces,
  selectedSpaceId,
  handleSelectSpace,
  handleCreateSpace,
  handleReorderSpaces,
  getSpaceHealthStatus,
  getSpaceHealthColor,
  performAllSpacesHealthCheck,
}) => {
  const [newSpaceName, setNewSpaceName] = React.useState('');
  const [showCreateInput, setShowCreateInput] = React.useState(false);
  const [draggedSpaceId, setDraggedSpaceId] = React.useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = React.useState<number | null>(null);
  const navigate = useNavigate();

  const handleInspectorClick = () => {
    setActiveView('inspector');
    navigate('/');
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
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleSpaceDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleSpaceDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    setDragOverIndex(null);
    
    if (!draggedSpaceId) return;
    
    const draggedIndex = spaces.findIndex(space => space.id === draggedSpaceId);
    if (draggedIndex === -1 || draggedIndex === dropIndex) return;
    
    // Reorder the spaces array
    const newSpaces = [...spaces];
    const [draggedSpace] = newSpaces.splice(draggedIndex, 1);
    newSpaces.splice(dropIndex, 0, draggedSpace);
    
    // Update the spaces order
    handleReorderSpaces(newSpaces);
    setDraggedSpaceId(null);
  };

  const handleSpaceDragEnd = () => {
    setDraggedSpaceId(null);
    setDragOverIndex(null);
  };

  const renderHealthIndicator = (spaceId: string) => {
    const status = getSpaceHealthStatus(spaceId);
    const color = getSpaceHealthColor(spaceId);
    
    if (status.loading) {
      return (
        <div 
          className="spinner-border spinner-border-sm me-2" 
          style={{ width: '12px', height: '12px', color: '#6c757d' }}
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
      <div
        className="me-2"
        style={{
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          backgroundColor: colorMap[color],
          flexShrink: 0
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
    <nav className="nav flex-column">
      {/* Inspector Link */}
      <Link
        to="/"
        className={`nav-link ${activeView === 'inspector' ? 'active fw-bold' : ''}`}
        onClick={handleInspectorClick}
      >
        <i className="bi bi-search me-2"></i> Inspector
      </Link>

      {/* Spaces Header */}
      <div className="d-flex justify-content-between align-items-center mt-3 mb-1">
        <h6 className="nav-link text-muted mb-0">Spaces</h6>
        <button
          className="btn btn-sm btn-outline-secondary"
          onClick={performAllSpacesHealthCheck}
          title="Refresh health status"
          style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
        >
          <i className="bi bi-arrow-clockwise"></i>
        </button>
      </div>

      {/* List of Spaces */}
      <ul className="nav flex-column ms-3">
        {spaces.map((space, index) => (
          <li 
            className={`nav-item ${dragOverIndex === index ? 'space-drag-over' : ''}`} 
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
              onClick={() => handleSelectSpace(space.id)}
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

      {/* Create New Space */}
      <div className="mt-2 ms-3">
        {showCreateInput ? (
          <div className="input-group input-group-sm">
            <input
              type="text"
              className="form-control form-control-sm"
              placeholder="New space name..."
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
            <i className="bi bi-plus-lg me-1"></i> Create New Space
          </button>
        )}
      </div>
    </nav>
  );
};

export default SideNav;