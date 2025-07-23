import React from 'react';
import { LogEntry, Space, SpaceCard, SelectedTool, ResourceTemplate } from '../types';
import McpResponseDisplay from './McpResponseDisplay';

interface ResultPanelProps {
  lastResult: LogEntry | null;
  isConnected: boolean;
  serverUrl?: string;
  spaces: Space[];
  onAddCardToSpace: (spaceId: string, cardData: Omit<SpaceCard, 'id'>) => void;
  selectedTool: SelectedTool | null;
  selectedResourceTemplate: ResourceTemplate | null;
  toolParams: Record<string, any>;
  resourceArgs: Record<string, any>;
  isContentExpanded?: boolean;
}

const ResultPanel: React.FC<ResultPanelProps> = ({ 
  lastResult, 
  isConnected, 
  serverUrl,
  spaces,
  onAddCardToSpace,
  selectedTool,
  selectedResourceTemplate,
  toolParams,
  resourceArgs,
  isContentExpanded = false
}) => {

  return (
    <div className={`h-100 d-flex flex-column ${!isConnected ? 'panel-deactivated' : ''}`}>
      <div className="p-3 flex-grow-1 overflow-auto">
        {lastResult ? (
          <McpResponseDisplay
            logEntry={lastResult}
            showTimestamp={false}
            spacesMode={true}
            toolName={lastResult.callContext?.name}
            hideControls={true}
            forceExpanded={isContentExpanded}
          />
        ) : (
          <p className="text-muted">The result of the last execution will appear here.</p>
        )}
      </div>
    </div>
  );
};

export default ResultPanel;