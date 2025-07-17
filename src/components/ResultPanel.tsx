import React from 'react';
import { LogEntry } from '../types';
import McpResponseDisplay from './McpResponseDisplay';

interface ResultPanelProps {
  lastResult: LogEntry | null;
  isConnected: boolean;
}

const ResultPanel: React.FC<ResultPanelProps> = ({ lastResult, isConnected }) => {
  return (
    <div className={`card mb-3 ${!isConnected ? 'panel-deactivated' : ''}`}>
      <div className="card-header">
        <h5>Result</h5>
      </div>
      <div className="card-body" style={{ minHeight: '150px' }}>
        {lastResult ? (
          <McpResponseDisplay
            logEntry={lastResult}
            showTimestamp={false}
            spacesMode={true}
            toolName={lastResult.callContext?.name}
          />
        ) : (
          <p className="text-muted p-2">The result of the last execution will appear here.</p>
        )}
      </div>
    </div>
  );
};

export default ResultPanel;