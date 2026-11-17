import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionTab } from '../types';
import { NEW_TAB_LABEL, NEW_TAB_TOOLTIP } from '../content/landingFirstRun';
import './Tabs.css';

interface TabsProps {
  tabs: ConnectionTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onCloseOtherTabs?: () => void;
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

const Tabs: React.FC<TabsProps> = ({ tabs, activeTabId, onSelectTab, onCloseTab, onNewTab, onCloseOtherTabs }) => {
  const pickerRef = useRef<HTMLDetailsElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<FadeState>({ start: false, end: false });

  const updateFade = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const bounds = strip.getBoundingClientRect();
    strip.querySelectorAll<HTMLElement>('.nav-item').forEach(item => {
      const rect = item.getBoundingClientRect();
      item.toggleAttribute('data-clipped', rect.left < bounds.left - 1 || rect.right > bounds.right + 1);
    });
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
    const active = stripRef.current?.querySelector<HTMLElement>('.nav-item:has([role="tab"][aria-selected="true"])');
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    updateFade();
  }, [activeTabId, tabs.length, labelsKey, updateFade]);

  if (tabs.length === 0) {
    return null; // Don't render tabs if there are none
  }

  // Status dots read the theme tokens: green for HTTP, info for legacy SSE.
  const getConnectionStatusColor = (status: string, transportType?: string) => {
    switch (status) {
      case 'Connected':
        return transportType === 'legacy-sse' ? 'var(--info-color)' : 'var(--success-color)';
      case 'Connecting': return 'var(--warning-color)';
      case 'Error': return 'var(--danger-color)';
      default: return 'var(--secondary-color)';
    }
  };

  const stripClassName = [
    'playground-tab-strip',
    fade.start ? 'playground-tab-strip--fade-start' : '',
    fade.end ? 'playground-tab-strip--fade-end' : '',
  ].filter(Boolean).join(' ');

  const labels = tabs.map(tab => getTabDisplayLabel(tab.title));

  return (
    <div className={stripClassName}>
      <details className="session-picker" ref={pickerRef}
        onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false;
        }}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.currentTarget.open = false;
            event.currentTarget.querySelector('summary')?.focus();
          }
        }}>
        <summary className="playground-tab-count">
          Sessions <span className="playground-tab-count-value">{tabs.length}</span><span aria-hidden="true">▾</span>
        </summary>
        <div className="session-picker-popover">
          <ul aria-label="Open sessions">
            {tabs.map((tab, index) => {
              const params = tab.selectedPrompt ? tab.promptParams
                : tab.selectedResourceTemplate ? tab.resourceArgs : tab.toolParams;
              const context = [tab.selectedTool?.name || tab.selectedPrompt?.name || tab.selectedResourceTemplate?.name,
                params && Object.entries(params).filter(([, value]) => value !== '' && value != null)
                  .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join(', ')]
                .filter(Boolean).join(' — ');
              return <li key={tab.id}>
                <button type="button" aria-current={tab.id === activeTabId ? 'true' : undefined}
                  onClick={() => { onSelectTab(tab.id); if (pickerRef.current) pickerRef.current.open = false; }}>
                  <span>{labels[index]}{labels.filter(label => label === labels[index]).length > 1
                    ? ` #${labels.slice(0, index + 1).filter(label => label === labels[index]).length}` : ''}</span>
                  <small>{context || tab.connectionStatus}</small>
                </button>
              </li>;
            })}
          </ul>
          {onCloseOtherTabs && <button type="button" className="session-picker-close"
            disabled={tabs.length < 2} onClick={() => {
              onCloseOtherTabs();
              if (pickerRef.current) pickerRef.current.open = false;
            }}>Close other tabs</button>}
        </div>
      </details>
      {(fade.start || fade.end) && <button type="button" className="playground-tab-scroll" aria-label="Scroll sessions left" disabled={!fade.start}
        onClick={() => stripRef.current?.scrollBy({ left: -stripRef.current.clientWidth * 0.7, behavior: 'smooth' })}>‹</button>}
      <div
        ref={stripRef}
        className="nav nav-tabs playground-tabs"
        role="tablist"
        onScroll={updateFade}
      >
        {tabs.map((tab, index) => {
          const label = labels[index];
          const duplicate = labels.filter(value => value === label).length > 1;
          const suffix = duplicate ? ` #${labels.slice(0, index + 1).filter(value => value === label).length}` : '';
          return (
            <div key={tab.id} className="nav-item position-relative" role="presentation">
              <button
                type="button"
                className={`nav-link ${tabs.length > 1 ? 'pe-5' : ''} ${activeTabId === tab.id ? 'active active-tab-override' : ''}`}
                onClick={() => onSelectTab(tab.id)}
                role="tab"
                aria-selected={activeTabId === tab.id}
                title={`${tab.title}${suffix}`}
              >
                <span
                  className="me-2 playground-tab-status"
                  style={{ backgroundColor: getConnectionStatusColor(tab.connectionStatus, tab.transportType) }}
                ></span>
                <span className="playground-tab-label">{label}</span>
                {suffix && <span className="playground-tab-index">{suffix}</span>}
              </button>
              {tabs.length > 1 && (
                <button
                  type="button"
                  className="btn-close btn-close-sm position-absolute top-50 end-0 translate-middle-y me-2"
                  style={{ zIndex: 2 }}
                  onClick={() => onCloseTab(tab.id)}
                  aria-label={`Close ${tab.title}${suffix} tab`}
                ></button>
              )}
            </div>
          );
        })}
      </div>
      {(fade.start || fade.end) && <button type="button" className="playground-tab-scroll" aria-label="Scroll sessions right" disabled={!fade.end}
        onClick={() => stripRef.current?.scrollBy({ left: stripRef.current.clientWidth * 0.7, behavior: 'smooth' })}>›</button>}
      <button
        type="button"
        className="nav-link playground-tab-new"
        onClick={onNewTab}
        aria-label={NEW_TAB_LABEL}
        title={NEW_TAB_TOOLTIP}
      >
        <span aria-hidden="true">+</span> New
      </button>
    </div>
  );
};

export default Tabs;
