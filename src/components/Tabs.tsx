import React from 'react';
import { ConnectionTab } from '../types';

interface TabsProps {
  tabs: ConnectionTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
}

const Tabs: React.FC<TabsProps> = ({ tabs, activeTabId, onSelectTab, onCloseTab, onNewTab }) => {
  if (tabs.length === 0) {
    return null; // Don't render tabs if there are none
  }

  const getConnectionStatusColor = (status: string, transportType?: string) => {
    switch (status) {
      case 'Connected': 
        return transportType === 'legacy-sse' ? 'primary' : 'success'; // Blue for SSE, Green for HTTP
      case 'Connecting': return 'warning';
      case 'Error': return 'danger';
      default: return 'secondary';
    }
  };

  return (
    <div 
      className="nav nav-tabs" 
      role="tablist"
    >
      {tabs.map(tab => (
        <div key={tab.id} className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTabId === tab.id ? 'active active-tab-override' : ''}`}
            onClick={() => onSelectTab(tab.id)}
            role="tab"
            aria-selected={activeTabId === tab.id}
          >
            <span 
              className="me-2"
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: getConnectionStatusColor(tab.connectionStatus, tab.transportType) === 'success' ? '#198754' :
                                 getConnectionStatusColor(tab.connectionStatus, tab.transportType) === 'primary' ? '#0d6efd' :
                                 getConnectionStatusColor(tab.connectionStatus, tab.transportType) === 'warning' ? '#ffc107' :
                                 getConnectionStatusColor(tab.connectionStatus, tab.transportType) === 'danger' ? '#dc3545' : '#6c757d',
                display: 'inline-block'
              }}
            ></span>
            {tab.title}
            {tabs.length > 1 && (
              <button
                type="button"
                className="btn-close btn-close-sm ms-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                aria-label="Close"
              ></button>
            )}
          </button>
        </div>
      ))}
      <div className="nav-item">
        <button type="button" className="nav-link" onClick={onNewTab}>+ New</button>
      </div>
    </div>
  );
};

export default Tabs;
