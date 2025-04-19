import React from 'react';

// Use 'any' for now until correct SDK types are confirmed/exported
type Prompt = any;
type SelectedPrompt = any;

interface PromptsPanelProps {
  prompts: Prompt[];
  selectedPrompt: SelectedPrompt | null;
  isConnected: boolean;
  isConnecting: boolean;
  handleListPrompts: () => void;
  handleSelectPrompt: (prompt: Prompt) => void;
}

const PromptsPanel: React.FC<PromptsPanelProps> = ({
  prompts,
  selectedPrompt,
  isConnected,
  isConnecting,
  handleListPrompts,
  handleSelectPrompt,
}) => {
  return (
    <div className="card mb-3">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h5>Prompts</h5>
        <button
          id="listPromptsBtn"
          className="btn btn-sm btn-secondary"
          onClick={handleListPrompts}
          disabled={!isConnected || isConnecting}
        >
          {isConnecting ? '...' : 'List Prompts'}
        </button>
      </div>
      <div className="card-body" style={{ maxHeight: '200px', overflowY: 'auto' }}>
        <ul className="list-group list-group-flush">
          {prompts.length === 0 && isConnected && (
            <li className="list-group-item text-muted">No prompts listed. Click 'List Prompts'.</li>
          )}
          {prompts.length === 0 && !isConnected && (
             <li className="list-group-item text-muted">Connect to server to list prompts.</li>
          )}
          {prompts.map((prompt) => (
            <li
              key={prompt.name} // Assuming prompt has a unique 'name'
              className={`list-group-item list-group-item-action ${selectedPrompt?.name === prompt.name ? 'active' : ''}`}
              onClick={() => handleSelectPrompt(prompt)}
              style={{ cursor: 'pointer' }}
            >
              {prompt.name}
              {prompt.description && <small className="d-block text-muted">{prompt.description}</small>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default PromptsPanel;