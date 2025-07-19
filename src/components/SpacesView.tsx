import React, { useState, useEffect } from 'react';
import { Space, SpaceCard } from '../types';
import McpResponseDisplay from './McpResponseDisplay'; // Import the new display component
import { getResultShareUrl } from '../utils/urlUtils';

// --- Card Component ---
interface SpaceCardComponentProps {
  spaceId: string;
  card: SpaceCard;
  onUpdateCard: (spaceId: string, cardId: string, updatedData: Partial<Omit<SpaceCard, 'id'>>) => void;
  onDeleteCard: (spaceId: string, cardId: string) => void;
  onExecuteCard: (spaceId: string, cardId: string) => void; // Add execute handler prop
  onAddCard: (spaceId: string, cardData: Omit<SpaceCard, 'id'>) => void; // Add card handler prop
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  isDragging: boolean;
}

const SpaceCardComponent: React.FC<SpaceCardComponentProps> = ({
  spaceId,
  card,
  onUpdateCard,
  onDeleteCard,
  onExecuteCard, // Destructure execute handler
  onAddCard, // Destructure add card handler
  onDragStart,
  onDragEnd,
  isDragging,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(card.title);
  const [editedParams, setEditedParams] = useState<Record<string, any>>(card.params);

  // Remove automatic execution on mount. Execution will be triggered by refresh button.
  // useEffect(() => {
  //   onExecuteCard(spaceId, card.id);
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [spaceId, card.id]);

  useEffect(() => {
    setEditedTitle(card.title);
    setEditedParams(card.params);
    setIsEditing(false);
  }, [card.title, card.params]); // Update title and params if they change externally

  const handleEditStart = () => {
    setIsEditing(true);
  };

  const handleTitleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setEditedTitle(event.target.value);
  };

  const handleEditSave = () => {
    try {
      const updates: Partial<Omit<SpaceCard, 'id'>> = {};
      
      if (editedTitle.trim() && editedTitle !== card.title) {
        updates.title = editedTitle.trim();
      }
      
      if (JSON.stringify(editedParams) !== JSON.stringify(card.params)) {
        updates.params = editedParams;
      }
      
      if (Object.keys(updates).length > 0) {
        onUpdateCard(spaceId, card.id, updates);
      }
      
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving card changes:', error);
      alert('Error saving changes. Please check the format.');
    }
  };

  const handleEditCancel = () => {
    setEditedTitle(card.title);
    setEditedParams(card.params);
    setIsEditing(false);
  };

  const handleTitleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleEditSave();
    } else if (event.key === 'Escape') {
      handleEditCancel();
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

  const handleDuplicateClick = () => {
    const duplicatedCard = {
      title: `${card.title} (Copy)`,
      serverUrl: card.serverUrl,
      type: card.type,
      name: card.name,
      params: JSON.parse(JSON.stringify(card.params)), // Deep copy params object
      // Copy the existing state so no refresh is needed
      loading: false,
      error: card.error ? JSON.parse(JSON.stringify(card.error)) : null, // Deep copy error
      responseData: card.responseData ? JSON.parse(JSON.stringify(card.responseData)) : null, // Deep copy responseData
      responseType: card.responseType,
    };
    
    // Add the card with existing state (no refresh needed)
    onAddCard(spaceId, duplicatedCard);
  };

  const handleShareClick = () => {
    // Normalize the server URL - remove protocol if present
    const normalizedUrl = card.serverUrl.replace(/^https?:\/\//, '');
    
    // Generate share URL
    const shareUrl = `${window.location.origin}${getResultShareUrl(
      normalizedUrl,
      card.type,
      card.name,
      card.params
    )}`;
    
    // Copy to clipboard
    navigator.clipboard.writeText(shareUrl).then(() => {
      // Show temporary feedback (we'll use a simple alert for now)
      alert('Result share link copied to clipboard!');
    }).catch(err => {
      console.error('Failed to copy result share link:', err);
      alert('Failed to copy result share link. Please try again.');
    });
  };

  const handleParamChange = (paramName: string, value: any) => {
    setEditedParams(prev => ({
      ...prev,
      [paramName]: value
    }));
  };

  // Helper to truncate long strings
  const truncate = (str: string, len: number) => {
    return str.length > len ? str.substring(0, len - 3) + '...' : str;
  }

  return (
    <div className="card" style={{ minHeight: '500px', display: 'flex', flexDirection: 'column' }}>
        {/* Card Header */}
        <div 
          className="card-header d-flex justify-content-between align-items-center"
          draggable={!isEditing}
          onDragStart={!isEditing ? onDragStart : undefined}
          onDragEnd={!isEditing ? onDragEnd : undefined}
          style={{
            cursor: !isEditing ? 'move' : 'default',
            userSelect: 'none'
          }}
        >
          <div className="d-flex align-items-center flex-grow-1">
            {/* Drag Handle */}
            {!isEditing && (
              <div className="drag-handle me-2" title="Drag to reorder">
                <i className="bi bi-grip-vertical text-muted"></i>
              </div>
            )}
            {isEditing ? (
              <div className="input-group input-group-sm flex-grow-1 me-2">
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={editedTitle}
                  onChange={handleTitleChange}
                  onKeyDown={handleTitleInputKeyDown}
                  autoFocus
                />
                <button className="btn btn-outline-success btn-sm" type="button" onClick={handleEditSave} title="Save Changes">
                  <i className="bi bi-check-lg"></i>
                </button>
                <button className="btn btn-outline-secondary btn-sm" type="button" onClick={handleEditCancel} title="Cancel Edit">
                  <i className="bi bi-x-lg"></i>
                </button>
              </div>
            ) : (
              <h5 className="card-title mb-0 flex-grow-1 me-2" title={card.title}>{truncate(card.title, 35)}</h5>
            )}
          </div>
          <div className="dropdown">
            <button
              className="btn btn-sm btn-outline-secondary dropdown-toggle"
              type="button"
              id={`cardDropdown-${card.id}`}
              data-bs-toggle="dropdown"
              aria-expanded="false"
              title="Card Actions"
            >
              <i className="bi bi-three-dots"></i>
            </button>
            <ul className="dropdown-menu dropdown-menu-end" aria-labelledby={`cardDropdown-${card.id}`}>
              <li>
                <button
                  className={`dropdown-item ${card.loading ? 'disabled' : ''}`}
                  onClick={handleRefreshClick}
                  disabled={card.loading}
                >
                  <i className="bi bi-arrow-clockwise me-2"></i>
                  {card.loading ? 'Refreshing...' : 'Refresh'}
                </button>
              </li>
              {!isEditing && (
                <li>
                  <button className="dropdown-item" onClick={handleEditStart}>
                    <i className="bi bi-pencil me-2"></i>Edit
                  </button>
                </li>
              )}
              <li>
                <button className="dropdown-item" onClick={handleDuplicateClick}>
                  <i className="bi bi-copy me-2"></i>Duplicate
                </button>
              </li>
              <li>
                <button className="dropdown-item" onClick={handleShareClick}>
                  <i className="bi bi-share me-2"></i>Share
                </button>
              </li>
              <li><hr className="dropdown-divider" /></li>
              <li>
                <button className="dropdown-item text-danger" onClick={handleDeleteClick}>
                  <i className="bi bi-trash me-2"></i>Delete
                </button>
              </li>
            </ul>
          </div>
        </div>

        {/* Card Body - Response Area */}
        <div className="card-body" style={{ flex: 1, overflow: 'visible', display: 'flex', flexDirection: 'column' }}>
          {card.loading ? (
             <div className="d-flex justify-content-center align-items-center h-100">
                <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">Loading...</span>
                </div>
             </div>
          ) : card.error ? (
             // Pass error info as a partial LogEntry, hide timestamp
             <McpResponseDisplay key={`${card.id}-error`} logEntry={{ type: 'error', data: card.error }} showTimestamp={false} className="" spacesMode={true} toolName={card.name} />
          ) : (
             // Pass result info as a partial LogEntry, hide timestamp
             <McpResponseDisplay key={`${card.id}-${card.responseType}`} logEntry={{ type: card.responseType ?? 'unknown', data: card.responseData }} showTimestamp={false} className="" spacesMode={true} toolName={card.name} />
          )}
        </div>

        {/* Card Footer - Info and Parameters */}
        <div className="card-footer text-muted small" style={{ maxHeight: '200px', overflow: 'auto', flexShrink: 0 }}>
          <div title={card.serverUrl}>Server: {truncate(card.serverUrl, 40)}</div>
          <div title={card.name}>{card.type === 'tool' ? 'Tool' : 'Resource'}: {truncate(card.name, 40)}</div>
          
          {/* Parameters Section */}
          <div className="mt-2">
            <h6 className="mb-1">Parameters:</h6>
            
            {isEditing ? (
              <div className="params-editor">
                {Object.keys(editedParams).length > 0 ? (
                  Object.entries(editedParams).map(([key, value]) => (
                    <div key={key} className="param-edit-row mb-2 p-2 border rounded">
                      <div className="mb-1">
                        <strong className="param-name">{key}</strong>
                      </div>
                      <div className="param-value-editor">
                        {typeof value === 'boolean' ? (
                          <div className="form-check">
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={value}
                              onChange={(e) => handleParamChange(key, e.target.checked)}
                            />
                            <label className="form-check-label small">
                              {value ? 'true' : 'false'}
                            </label>
                          </div>
                        ) : typeof value === 'number' ? (
                          <input
                            type="number"
                            className="form-control form-control-sm"
                            value={value}
                            onChange={(e) => handleParamChange(key, e.target.value === '' ? undefined : Number(e.target.value))}
                          />
                        ) : typeof value === 'string' && value.length > 50 ? (
                          <textarea
                            className="form-control form-control-sm"
                            rows={3}
                            value={value}
                            onChange={(e) => handleParamChange(key, e.target.value)}
                          />
                        ) : (
                          <input
                            type="text"
                            className="form-control form-control-sm"
                            value={typeof value === 'string' ? value : JSON.stringify(value)}
                            onChange={(e) => {
                              let newValue = e.target.value;
                              // Try to parse as JSON for complex values, fallback to string
                              try {
                                if (newValue.startsWith('{') || newValue.startsWith('[') || newValue === 'null' || newValue === 'true' || newValue === 'false') {
                                  newValue = JSON.parse(newValue);
                                }
                              } catch {
                                // Keep as string if not valid JSON
                              }
                              handleParamChange(key, newValue);
                            }}
                          />
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-muted small m-0">No parameters.</p>
                )}
              </div>
            ) : (
              // Display mode
              Object.keys(card.params).length > 0 ? (
                <pre className="p-1 rounded small m-0"><code>{JSON.stringify(card.params, null, 1)}</code></pre>
              ) : (
                <p className="text-muted small m-0">No parameters.</p>
              )
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
  onMoveCard: (sourceSpaceId: string, targetSpaceId: string, cardId: string) => void; // Add move handler prop
  onAddCard: (spaceId: string, cardData: Omit<SpaceCard, 'id'>) => void; // Add card handler prop
  onRefreshSpace?: () => void; // Add refresh handler prop
  isRefreshing?: boolean; // Add refreshing state prop
}

const SpacesView: React.FC<SpacesViewProps> = ({
  space,
  onUpdateSpace,
  onDeleteSpace,
  onUpdateCard,
  onDeleteCard,
  onExecuteCard, // Destructure execute handler
  onMoveCard, // Destructure move handler
  onAddCard, // Destructure add card handler
  onRefreshSpace, // Destructure refresh handler
  isRefreshing = false, // Destructure refreshing state
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(space.name);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

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

  const handleColumnChange = (columns: number) => {
    onUpdateSpace(space.id, { columns });
  };

  const handleDragStart = (e: React.DragEvent, cardId: string) => {
    setDraggedCardId(cardId);
    e.dataTransfer.effectAllowed = 'move';
    // Store both card ID and source space ID for cross-space transfers
    e.dataTransfer.setData('text/plain', JSON.stringify({
      cardId: cardId,
      sourceSpaceId: space.id
    }));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    setDragOverIndex(null);
    
    if (!draggedCardId) return;
    
    const draggedIndex = space.cards.findIndex(card => card.id === draggedCardId);
    if (draggedIndex === -1 || draggedIndex === dropIndex) return;
    
    // Reorder the cards array
    const newCards = [...space.cards];
    const [draggedCard] = newCards.splice(draggedIndex, 1);
    newCards.splice(dropIndex, 0, draggedCard);
    
    // Update the space with reordered cards
    onUpdateSpace(space.id, { cards: newCards });
    setDraggedCardId(null);
  };

  const handleDragEnd = () => {
    setDraggedCardId(null);
    setDragOverIndex(null);
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
        <div className="d-flex align-items-center gap-2">
          {/* Refresh Button */}
          {onRefreshSpace && (
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={onRefreshSpace}
              disabled={isRefreshing}
              title="Refresh all cards in this space"
            >
              {isRefreshing ? (
                <>
                  <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                  Refreshing...
                </>
              ) : (
                <>
                  <i className="bi bi-arrow-clockwise me-1"></i>
                  Refresh
                </>
              )}
            </button>
          )}
          {/* Column Selector */}
          <div className="btn-group btn-group-sm" role="group" aria-label="Column count">
            <button
              type="button"
              className={`btn ${(space.columns || 2) === 1 ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => handleColumnChange(1)}
              title="1 column"
            >
              ▌
            </button>
            <button
              type="button"
              className={`btn ${(space.columns || 2) === 2 ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => handleColumnChange(2)}
              title="2 columns"
            >
              ▌▌
            </button>
            <button
              type="button"
              className={`btn ${(space.columns || 2) === 3 ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => handleColumnChange(3)}
              title="3 columns"
            >
              ▌▌▌
            </button>
            <button
              type="button"
              className={`btn ${(space.columns || 2) === 4 ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => handleColumnChange(4)}
              title="4 columns"
            >
              ▌▌▌▌
            </button>
          </div>
          {!isEditingName && (
            <button className="btn btn-sm btn-outline-secondary" onClick={handleNameEditStart} title="Edit Space Name">
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
        <div className="alert alert-info">This space is empty. Add results from the Inspector view using the <i className="bi bi-plus-square"></i> button in the Result panel.</div>
      ) : (
        <div className="row">
          {space.cards.map((card, index) => (
            <div
              key={card.id}
              className={`mb-3 ${
                space.columns === 1 ? 'col-12' :
                space.columns === 2 ? 'col-md-6' :
                space.columns === 3 ? 'col-lg-4' :
                space.columns === 4 ? 'col-xl-3 col-lg-4 col-md-6' :
                'col-md-6' // default fallback
              } ${dragOverIndex === index ? 'drag-over' : ''}`}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              style={{
                opacity: draggedCardId === card.id ? 0.5 : 1,
                transition: 'opacity 0.2s ease'
              }}
            >
              <SpaceCardComponent
                spaceId={space.id}
                card={card}
                onUpdateCard={onUpdateCard}
                onDeleteCard={onDeleteCard}
                onExecuteCard={onExecuteCard} // Pass down the handler
                onAddCard={onAddCard} // Pass down the add card handler
                onDragStart={(e) => handleDragStart(e, card.id)}
                onDragEnd={handleDragEnd}
                isDragging={draggedCardId === card.id}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SpacesView;