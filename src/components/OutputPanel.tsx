import React from 'react';
import { LogEntry, Space, SpaceCard, SelectedTool, ResourceTemplate } from '../types';
import McpResponseDisplay from './McpResponseDisplay';
import ResultPanel from './ResultPanel';
import ResponsePanel from './ResponsePanel';

interface OutputPanelProps {
  lastResult: LogEntry | null;
  responses: LogEntry[];
  autoScroll: boolean;
  setAutoScroll: (autoScroll: boolean) => void;
  handleClearResponse: () => void;
  isConnected: boolean;
  spaces: Space[];
  onAddCardToSpace: (spaceId: string, cardData: Omit<SpaceCard, 'id'>) => void;
  serverUrl: string;
  selectedTool: SelectedTool | null;
  selectedResourceTemplate: ResourceTemplate | null;
  toolParams: Record<string, any>;
  resourceArgs: Record<string, any>;
  onRunAgain?: (callContext: LogEntry['callContext']) => void;
}

const OutputPanel: React.FC<OutputPanelProps> = (props) => {
  return (
    <div className="card mt-3 flex-grow-1">
      <div className="card-header p-0">
        <ul className="nav nav-tabs" id="outputTabs" role="tablist">
          <li className="nav-item" role="presentation">
            <button className="nav-link active" id="result-tab" data-bs-toggle="tab" data-bs-target="#result-panel" type="button" role="tab" aria-controls="result-panel" aria-selected="true">Result</button>
          </li>
          <li className="nav-item" role="presentation">
            <button className="nav-link" id="logs-tab" data-bs-toggle="tab" data-bs-target="#logs-panel" type="button" role="tab" aria-controls="logs-panel" aria-selected="false">Logs & Events</button>
          </li>
        </ul>
      </div>
      <div className="card-body p-0">
        <div className="tab-content" id="outputTabsContent">
          <div className="tab-pane fade show active" id="result-panel" role="tabpanel" aria-labelledby="result-tab">
            <ResultPanel {...props} />
          </div>
          <div className="tab-pane fade" id="logs-panel" role="tabpanel" aria-labelledby="logs-tab">
            <ResponsePanel {...props} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default OutputPanel;