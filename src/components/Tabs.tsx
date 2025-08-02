import React from 'react';
import { ConnectionTab } from '../types';

// Add CSS for active tab border override
const tabStyles = `
  .active-tab-override::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background-color: var(--body-bg);
    z-index: 1;
  }
`;

// Inject styles
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = tabStyles;
  if (!document.head.querySelector('style[data-tab-styles]')) {
    styleSheet.setAttribute('data-tab-styles', 'true');
    document.head.appendChild(styleSheet);
  }
}

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
      style={{ borderBottom: '1px solid var(--border-color)', position: 'relative' }}
    >
      {tabs.map(tab => (
        <div key={tab.id} className="nav-item">
          <a
            className={`nav-link ${activeTabId === tab.id ? 'active active-tab-override' : ''}`}
            onClick={() => onSelectTab(tab.id)}
            href="#"
            role="tab"
            style={{
              borderRadius: '0.375rem 0.375rem 0 0',
              position: 'relative',
              zIndex: activeTabId === tab.id ? 2 : 0
            }}
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
          </a>
        </div>
      ))}
      <div className="nav-item">
        <a className="nav-link" onClick={onNewTab} href="#">+ New</a>
      </div>
    </div>
  );
};

export default Tabs;