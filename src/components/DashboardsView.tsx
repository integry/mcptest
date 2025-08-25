import React, { useState, useEffect } from 'react';
import { Space, SpaceCard } from '../types';
import McpResponseDisplay from './McpResponseDisplay'; // Import the new display component
import { getResultShareUrl } from '../utils/urlUtils';
import { useShare } from '../hooks/useShare';

// --- OAuth Status Indicator Component ---
interface OAuthStatusIndicatorProps {
  serverUrl: string;
}

const OAuthStatusIndicator: React.FC<OAuthStatusIndicatorProps> = ({ serverUrl }) => {
  const [oauthUserInfo, setOauthUserInfo] = useState<any>(null);
  const [showUserInfoModal, setShowUserInfoModal] = useState(false);
  const [hasOAuthToken, setHasOAuthToken] = useState(false);

  useEffect(() => {
    // Check if we have an OAuth token for this server
    const serverHost = new URL(serverUrl).host;
    const token = sessionStorage.getItem(`oauth_access_token_${serverHost}`);
    setHasOAuthToken(!!token);

    // If we have a token, try to fetch user info
    if (token) {
      const fetchUserInfo = async () => {
        try {
          const storedEndpoints = sessionStorage.getItem(`oauth_endpoints_${serverHost}`);
          if (!storedEndpoints) return;

          const oauthEndpoints = JSON.parse(storedEndpoints);
          if (!oauthEndpoints.userinfo_endpoint) return;

          const response = await fetch(oauthEndpoints.userinfo_endpoint, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json'
            }
          });

          if (response.ok) {
            const userInfo = await response.json();
            setOauthUserInfo(userInfo);
          }
        } catch (error) {
          console.error('Failed to fetch OAuth user info for card:', error);
        }
      };

      fetchUserInfo();
    }
  }, [serverUrl]);

  if (!hasOAuthToken) {
    return null; // No OAuth token, don't show anything
  }

  return (
    <>
      <div className="d-flex align-items-center">
        <span className="badge bg-success me-2">
          <i className="bi bi-shield-check me-1"></i>
          OAuth
        </span>
        {oauthUserInfo && (
          <button
            className="btn btn-sm btn-link text-decoration-none p-0"
            onClick={() => setShowUserInfoModal(true)}
            title="View OAuth session info"
            style={{ fontSize: '0.8rem' }}
          >
            <i className="bi bi-info-circle"></i>
          </button>
        )}
      </div>

      {/* OAuth User Info Modal */}
      {showUserInfoModal && oauthUserInfo && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">OAuth Session Information</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowUserInfoModal(false)}
                  aria-label="Close"
                ></button>
              </div>
              <div className="modal-body">
                {oauthUserInfo.picture && (
                  <div className="text-center mb-3">
                    <img
                      src={oauthUserInfo.picture}
                      alt="User avatar"
                      className="rounded-circle"
                      style={{ width: '80px', height: '80px' }}
                    />
                  </div>
                )}
                <div className="table-responsive">
                  <table className="table table-sm">
                    <tbody>
                      {Object.entries(oauthUserInfo).map(([key, value]) => (
                        <tr key={key}>
                          <td className="fw-bold text-capitalize">{key.replace(/_/g, ' ')}</td>
                          <td>
                            {typeof value === 'string' && value.length > 100 
                              ? `${value.substring(0, 100)}...` 
                              : String(value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3">
                  <small className="text-muted">
                    <i className="bi bi-clock me-1"></i>
                    Session active for server: {serverUrl}
                  </small>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowUserInfoModal(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

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
  onReauthorizeCard?: (spaceId: string, cardId: string, serverUrl: string) => void; // Add reauth handler prop
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
  onReauthorizeCard, // Destructure reauth handler
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(card.title);
  const [editedParams, setEditedParams] = useState<Record<string, any>>(card.params);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { share, shareStatus, shareMessage } = useShare();

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
    
    share({
      url: shareUrl,
      title: `MCP Result: ${card.name}`,
      text: `Check out this MCP result from ${card.serverUrl}`,
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
          <div className="d-flex align-items-center">
            <button
              className="btn btn-sm btn-outline-secondary me-2"
              onClick={() => setIsFullscreen(true)}
              title="Fullscreen"
              aria-label="View result in fullscreen"
            >
              <i className="bi bi-arrows-fullscreen"></i>
            </button>
            <div className="dropdown" style={{ position: 'relative' }}>
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
                <button className="dropdown-item" onClick={handleShareClick} disabled={shareStatus !== 'idle'} aria-label="Copy share link to clipboard">
                  {shareStatus === 'success' ? (
                    <><i className="bi bi-check-lg me-2"></i>Shared!</>
                  ) : (
                    <><i className="bi bi-share me-2"></i>Share</>
                  )}
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
            {shareStatus !== 'idle' && (
              <div className="notification-tooltip right-aligned" aria-live="polite">
                {shareMessage}
              </div>
            )}
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
             <div>
               {/* Show "Authorize Again" button for auth errors */}
               {card.error && typeof card.error === 'object' && card.error.isAuthError && onReauthorizeCard && (
                 <div className="auth-error-banner mb-3 p-2 bg-warning-subtle border border-warning rounded">
                   <div className="d-flex justify-content-between align-items-center">
                     <div>
                       <i className="bi bi-shield-exclamation text-warning me-2"></i>
                       <strong>Authentication Required</strong>
                       <div className="small text-muted">The server requires OAuth authentication to access this resource.</div>
                     </div>
                     <button
                       className="btn btn-warning btn-sm"
                       onClick={() => onReauthorizeCard(spaceId, card.id, card.serverUrl)}
                       title="Start OAuth authentication flow"
                     >
                       <i className="bi bi-shield-check me-1"></i>
                       Authorize Again
                     </button>
                   </div>
                 </div>
               )}
               {/* Pass error info as a partial LogEntry, hide timestamp */}
               <McpResponseDisplay key={`${card.id}-error`} logEntry={{ type: 'error', data: card.error }} showTimestamp={false} className="" spacesMode={true} toolName={card.name} />
             </div>
          ) : (
             // Pass result info as a partial LogEntry, hide timestamp
             <McpResponseDisplay key={`${card.id}-${card.responseType}`} logEntry={{ type: card.responseType ?? 'unknown', data: card.responseData }} showTimestamp={false} className="" spacesMode={true} toolName={card.name} />
          )}
        </div>

        {/* Card Footer - Info and Parameters */}
        <div className="card-footer text-muted small" style={{ maxHeight: '200px', overflow: 'auto', flexShrink: 0 }}>
          <div title={card.serverUrl}>Server: {truncate(card.serverUrl, 40)}</div>
          <div title={card.name}>{card.type === 'tool' ? 'Tool' : 'Resource'}: {truncate(card.name, 40)}</div>
          
          {/* OAuth Status */}
          <div className="mt-2">
            <OAuthStatusIndicator serverUrl={card.serverUrl} />
          </div>
          
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
        
        {/* Fullscreen modal */}
        {isFullscreen && (
          <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}>
            <div className="modal-dialog modal-fullscreen">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">{card.name} - Output</h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => setIsFullscreen(false)}
                  ></button>
                </div>
                <div className="modal-body p-3" style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                  <McpResponseDisplay 
                    key={`${card.id}-${card.responseType}-fullscreen`} 
                    logEntry={{ type: card.responseType ?? 'unknown', data: card.responseData }} 
                    showTimestamp={false} 
                    className="" 
                    spacesMode={true} 
                    toolName={card.name}
                    forceExpanded={true}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
  );
};


// --- DashboardsView Component ---

interface DashboardsViewProps {
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
  onReauthorizeCard?: (spaceId: string, cardId: string, serverUrl: string) => void; // Add reauth handler prop
}

const DashboardsView: React.FC<DashboardsViewProps> = ({
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
  onReauthorizeCard, // Destructure reauth handler
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
    if (window.confirm(`Are you sure you want to delete the dashboard "${space.name}"? This cannot be undone.`)) {
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
      {/* Dashboard Header */}
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
        <div className="d-flex align-items-center gap-2 dashboard-controls">
          {/* Refresh Button */}
          {onRefreshSpace && (
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={onRefreshSpace}
              disabled={isRefreshing}
              title="Refresh all cards in this dashboard"
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
            <button className="btn btn-sm btn-outline-secondary" onClick={handleNameEditStart} title="Edit Dashboard Name">
              <i className="bi bi-pencil"></i>
            </button>
          )}
          <button className="btn btn-sm btn-outline-danger" onClick={handleDeleteClick} title="Delete Dashboard">
            <i className="bi bi-trash"></i>
          </button>
        </div>
      </div>

      {/* Cards Area */}
      {space.cards.length === 0 ? (
        <div className="alert alert-info">This dashboard is empty. Go to the Playground to add results.</div>
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
                onReauthorizeCard={onReauthorizeCard} // Pass down the reauth handler
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DashboardsView;