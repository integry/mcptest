import React from 'react';
import { Space } from '../types'; // Import Space type

interface SideNavProps {
  activeView: 'inspector' | 'spaces';
  setActiveView: (view: 'inspector' | 'spaces') => void;
  spaces: Space[];
  selectedSpaceId: string | null;
  handleSelectSpace: (id: string) => void;
  handleCreateSpace: (name: string) => void; // Function to handle creation
}

const SideNav: React.FC<SideNavProps> = ({
  activeView,
  setActiveView,
  spaces,
  selectedSpaceId,
  handleSelectSpace,
  handleCreateSpace,
}) => {
  const [newSpaceName, setNewSpaceName] = React.useState('');
  const [showCreateInput, setShowCreateInput] = React.useState(false);

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

  return (
    <nav className="nav flex-column">
      {/* Inspector Link */}
      <a
        className={`nav-link ${activeView === 'inspector' ? 'active fw-bold' : ''}`}
        href="#"
        onClick={(e) => {
          e.preventDefault();
          setActiveView('inspector');
        }}
        style={{ cursor: 'pointer' }}
      >
        <i className="bi bi-search me-2"></i> Inspector
      </a>

      {/* Spaces Header */}
      <h6 className="nav-link text-muted mt-3 mb-1">Spaces</h6>

      {/* List of Spaces */}
      <ul className="nav flex-column ms-3">
        {spaces.map((space) => (
          <li className="nav-item" key={space.id}>
            <a
              className={`nav-link py-1 ${selectedSpaceId === space.id && activeView === 'spaces' ? 'active fw-bold' : ''}`}
              href="#"
              onClick={(e) => {
                e.preventDefault();
                handleSelectSpace(space.id);
              }}
              style={{ cursor: 'pointer' }}
            >
              - {space.name}
            </a>
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