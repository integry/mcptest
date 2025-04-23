import React, { useState, useEffect } from 'react';
import { Space, SpaceCard } from '../types';
import McpResponseDisplay from './McpResponseDisplay'; // Import the new display component

// --- Card Component ---
interface SpaceCardComponentProps {
  spaceId: string;
  card: SpaceCard;
  onUpdateCard: (spaceId: string, cardId: string, updatedData: Partial<Omit<SpaceCard, 'id'>>) => void;
  onDeleteCard: (spaceId: string, cardId: string) => void;
  onExecuteCard: (spaceId: string, cardId: string) => void; // Add execute handler prop
}

const SpaceCardComponent: React.FC<SpaceCardComponentProps> = ({
  spaceId,
  card,
  onUpdateCard,
  onDeleteCard,
  onExecuteCard, // Destructure execute handler
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState(card.title);

  // Remove automatic execution on mount. Execution will be triggered by refresh button.
  // useEffect(() => {
  //   onExecuteCard(spaceId, card.id);
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [spaceId, card.id]);

  useEffect(() => {
    setEditedTitle(card.title);
    setIsEditingTitle(false);
  }, [card.title]); // Update title if it changes externally

  const handleTitleEditStart = () => {
    setIsEditingTitle(true);
  };

  const handleTitleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setEditedTitle(event.target.value);
  };

  const handleTitleEditSave = () => {
    if (editedTitle.trim() && editedTitle !== card.title) {
      onUpdateCard(spaceId, card.id, { title: editedTitle.trim() });
    }
    setIsEditingTitle(false);
  };

  const handleTitleEditCancel = () => {
    setEditedTitle(card.title);
    setIsEditingTitle(false);
  };

  const handleTitleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleTitleEditSave();
    } else if (event.key === 'Escape') {
      handleTitleEditCancel();
    }
  };

  const handleDeleteClick = () => {
    if (window.confirm(`Are you sure you want to delete the card "${card.title}"?`)) {
      onDeleteCard(spaceId, card.id);
    }
  };

  const handleRefreshClick = () => {
    onExecuteCard(spaceId, card.id); // Call the execution handler
  };

  // Helper to truncate long strings
  const truncate = (str: string, len: number) => {
    return str.length > len ? str.substring(0, len - 3) + '...' : str;
  }

  return (
    <div className="col-md-6 col-lg-4 mb-3">
      <div className="card h-100">
        {/* Card Header */}
        <div className="card-header d-flex justify-content-between align-items-center">
          {isEditingTitle ? (
            <div className="input-group input-group-sm flex-grow-1 me-2">
              <input
                type="text"
                className="form-control form-control-sm"
                value={editedTitle}
                onChange={handleTitleChange}
                onKeyDown={handleTitleInputKeyDown}
                autoFocus
              />
              <button className="btn btn-outline-success btn-sm" type="button" onClick={handleTitleEditSave} title="Save Title">
                <i className="bi bi-check-lg"></i>
              </button>
              <button className="btn btn-outline-secondary btn-sm" type="button" onClick={handleTitleEditCancel} title="Cancel Edit">
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
          ) : (
            <h5 className="card-title mb-0 flex-grow-1 me-2" title={card.title}>{truncate(card.title, 35)}</h5>
          )}
          <div>
            {/* Refresh Button */}
            <button
              className={`btn btn-sm btn-outline-primary me-1 ${card.loading ? 'disabled' : ''}`}
              onClick={handleRefreshClick}
              disabled={card.loading}
              title="Refresh Card Data"
            >
              {card.loading ? <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> : <i className="bi bi-arrow-clockwise"></i>}
            </button>
            {!isEditingTitle && (
              <button className="btn btn-sm btn-outline-secondary me-1" onClick={handleTitleEditStart} title="Edit Card Title">
                <i className="bi bi-pencil"></i>
              </button>
            )}
            <button className="btn btn-sm btn-outline-danger" onClick={handleDeleteClick} title="Delete Card">
              <i className="bi bi-trash"></i>
            </button>
          </div>
        </div>

        {/* Card Body - Response Area */}
        <div className="card-body" style={{ overflowY: 'auto', maxHeight: '300px' }}>
          {card.loading ? (
             <div className="d-flex justify-content-center align-items-center h-100">
                <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">Loading...</span>
                </div>
             </div>
          ) : card.error ? (
             // Pass error info as a partial LogEntry, hide timestamp
             <McpResponseDisplay logEntry={{ type: 'error', data: card.error }} showTimestamp={false} className="bg-light p-2 rounded small" />
          ) : (
             // Pass result info as a partial LogEntry, hide timestamp
             <McpResponseDisplay logEntry={{ type: card.responseType ?? 'unknown', data: card.responseData }} showTimestamp={false} className="bg-light p-2 rounded small" />
          )}
        </div>

        {/* Card Footer - Fixed Info */}
        <div className="card-footer text-muted small">
          <div title={card.serverUrl}>Server: {truncate(card.serverUrl, 40)}</div>
          <div title={card.name}>{card.type === 'tool' ? 'Tool' : 'Resource'}: {truncate(card.name, 40)}</div>
          <h6>Parameters:</h6>
          {Object.keys(card.params).length > 0 ? (
             <pre className="bg-light p-1 rounded small m-0"><code>{JSON.stringify(card.params, null, 1)}</code></pre>
          ) : (
             <p className="text-muted small m-0">No parameters.</p>
          )}
        </div>
      </div>
    </div>
  );
};


// --- SpacesView Component ---

interface SpacesViewProps {
  space: Space;
  onUpdateSpace: (id: string, updatedData: Partial<Omit<Space, 'id'>>) => void;
  onDeleteSpace: (id: string) => void;
  onUpdateCard: (spaceId: string, cardId: string, updatedData: Partial<Omit<SpaceCard, 'id'>>) => void;
  onDeleteCard: (spaceId: string, cardId: string) => void;
  onExecuteCard: (spaceId: string, cardId: string) => void; // Add execute handler prop
}

const SpacesView: React.FC<SpacesViewProps> = ({
  space,
  onUpdateSpace,
  onDeleteSpace,
  onUpdateCard,
  onDeleteCard,
  onExecuteCard, // Destructure execute handler
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(space.name);

  useEffect(() => {
    setEditedName(space.name);
    setIsEditingName(false);
  }, [space]);

  const handleNameEditStart = () => {
    setIsEditingName(true);
  };

  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setEditedName(event.target.value);
  };

  const handleNameEditSave = () => {
    if (editedName.trim() && editedName !== space.name) {
      onUpdateSpace(space.id, { name: editedName.trim() });
    }
    setIsEditingName(false);
  };

  const handleNameEditCancel = () => {
    setEditedName(space.name);
    setIsEditingName(false);
  };

  const handleNameInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleNameEditSave();
    } else if (event.key === 'Escape') {
      handleNameEditCancel();
    }
  };

  const handleDeleteClick = () => {
    if (window.confirm(`Are you sure you want to delete the space "${space.name}"? This cannot be undone.`)) {
        onDeleteSpace(space.id);
    }
  };

  return (
    <div>
      {/* Space Header */}
      <div className="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom">
        {isEditingName ? (
          <div className="input-group">
            <input
              type="text"
              className="form-control"
              value={editedName}
              onChange={handleNameChange}
              onKeyDown={handleNameInputKeyDown}
              autoFocus
            />
            <button className="btn btn-outline-success" type="button" onClick={handleNameEditSave} title="Save Name">
              <i className="bi bi-check-lg"></i>
            </button>
            <button className="btn btn-outline-secondary" type="button" onClick={handleNameEditCancel} title="Cancel Edit">
              <i className="bi bi-x-lg"></i>
            </button>
          </div>
        ) : (
          <h2 className="mb-0">{space.name}</h2>
        )}
        <div>
          {!isEditingName && (
            <button className="btn btn-sm btn-outline-secondary me-2" onClick={handleNameEditStart} title="Edit Space Name">
              <i className="bi bi-pencil"></i>
            </button>
          )}
          <button className="btn btn-sm btn-outline-danger" onClick={handleDeleteClick} title="Delete Space">
            <i className="bi bi-trash"></i>
          </button>
        </div>
      </div>

      {/* Cards Area */}
      {space.cards.length === 0 ? (
        <div className="alert alert-info">This space is empty. Add results from the Inspector view using the <i className="bi bi-plus-square"></i> button in the Logs panel.</div>
      ) : (
        <div className="row">
          {space.cards.map(card => (
            <SpaceCardComponent
              key={card.id}
              spaceId={space.id}
              card={card}
              onUpdateCard={onUpdateCard}
              onDeleteCard={onDeleteCard}
              onExecuteCard={onExecuteCard} // Pass down the handler
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default SpacesView;