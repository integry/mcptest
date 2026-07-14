import React from 'react';

interface ActionToolbarProps {
  isConnected: boolean;
  onRefreshLists: () => void;
}

const ActionToolbar: React.FC<ActionToolbarProps> = ({
  isConnected,
  onRefreshLists,
}) => {
  return (
    <div className="card mb-3">
      <div className="card-body d-flex justify-content-start">
        <button
          className="btn btn-info me-2"
          onClick={onRefreshLists}
          disabled={!isConnected}
          title="Refresh Tools, Resources, and Prompts lists"
        >
          Refresh Lists
        </button>
        {/* Add other global action buttons here later if needed */}
      </div>
    </div>
  );
};

export default ActionToolbar;