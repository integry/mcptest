import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionTab } from '../types';
import './Tabs.css';

interface TabsProps {
  tabs: ConnectionTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
}

/**
 * Tab labels are stored as `Server: https://host/path` or `Result: name`.
 * The strip shows the host first so truncation keeps it visible; the full
 * title stays in the tooltip and the close button's label.
 */
export const getTabDisplayLabel = (title: string): string => {
  const match = title.match(/^(?:Server|Result):\s*(.+)$/i);
  const candidate = (match ? match[1] : title).trim();
  if (!/^(https?:\/\/)?[^\s/]+\.[^\s/]+(\/|$)/i.test(candidate)) return title;
  try {
    const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.host}${path}`;
  } catch {
    return title;
  }
};

type FadeState = { start: boolean; end: boolean };

const Tabs: React.FC<TabsProps> = ({ tabs, activeTabId, onSelectTab, onCloseTab, onNewTab }) => {
  const stripRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<FadeState>({ start: false, end: false });

  const updateFade = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const overflow = strip.scrollWidth - strip.clientWidth;
    const next: FadeState = overflow > 1
      ? { start: strip.scrollLeft > 1, end: strip.scrollLeft < overflow - 1 }
      : { start: false, end: false };
    setFade((current) => (current.start === next.start && current.end === next.end ? current : next));
  }, []);

  // Connection updates swap short placeholder titles for longer server titles
  // without changing tab IDs or count, so overflow is keyed on the labels too.
  const labelsKey = tabs.map((tab) => tab.title).join('\u0000');

  useEffect(() => {
    updateFade();
    const strip = stripRef.current;
    if (!strip || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateFade);
    // The strip's own box is constrained by the available width; the items
    // inside it are what grow when a label widens, so observe both.
    observer.observe(strip);
    strip.querySelectorAll<HTMLElement>('.nav-item').forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [updateFade, tabs.length, labelsKey]);

  // Keep the active tab in view when it changes, a tab is added, or a label
  // change pushes it past the edge of the strip.
  useEffect(() => {
    const active = stripRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    updateFade();
  }, [activeTabId, tabs.length, labelsKey, updateFade]);

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

  const stripClassName = [
    'playground-tab-strip',
    fade.start ? 'playground-tab-strip--fade-start' : '',
    fade.end ? 'playground-tab-strip--fade-end' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={stripClassName}>
      <div
        ref={stripRef}
        className="nav nav-tabs playground-tabs"
        role="tablist"
        onScroll={updateFade}
      >
        {tabs.map(tab => {
          const label = getTabDisplayLabel(tab.title);
          return (
            <div key={tab.id} className="nav-item position-relative" role="presentation">
              <button
                type="button"
                className={`nav-link ${tabs.length > 1 ? 'pe-5' : ''} ${activeTabId === tab.id ? 'active active-tab-override' : ''}`}
                onClick={() => onSelectTab(tab.id)}
                role="tab"
                aria-selected={activeTabId === tab.id}
                title={tab.title}
              >
                <span
                  className="me-2 playground-tab-status"
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
                <span className="playground-tab-label">{label}</span>
              </button>
              {tabs.length > 1 && (
                <button
                  type="button"
                  className="btn-close btn-close-sm position-absolute top-50 end-0 translate-middle-y me-2"
                  style={{ zIndex: 2 }}
                  onClick={() => onCloseTab(tab.id)}
                  aria-label={`Close ${tab.title} tab`}
                ></button>
              )}
            </div>
          );
        })}
        <div className="nav-item">
          <button type="button" className="nav-link playground-tab-new" onClick={onNewTab}>+ New</button>
        </div>
      </div>
    </div>
  );
};

export default Tabs;
