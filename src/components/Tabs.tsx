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

  return (
    <div className="nav nav-tabs" role="tablist">
      {tabs.map(tab => (
        <div key={tab.id} className="nav-item">
          <a
            className={`nav-link ${activeTabId === tab.id ? 'active' : ''}`}
            onClick={() => onSelectTab(tab.id)}
            href="#"
            role="tab"
          >
            {tab.title}
            <button
              type="button"
              className="btn-close btn-close-sm ms-2"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              aria-label="Close"
            ></button>
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