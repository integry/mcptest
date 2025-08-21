import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Tool, Resource, ResourceTemplate, Prompt, SelectedTool, SelectedPrompt } from '../types'; // Added Resource type
import './UnifiedPanel.css'; // We'll create this CSS file next

interface UnifiedPanelProps {
  tools: Tool[];
  resources: Resource[]; // Actual resources
  resourceTemplates: ResourceTemplate[]; // Resource templates
  prompts: Prompt[];
  selectedTool: SelectedTool | null;
  selectedResourceTemplate: ResourceTemplate | null;
  selectedPrompt: SelectedPrompt | null;
  handleSelectTool: (tool: Tool) => void;
  handleSelectResourceTemplate: (template: ResourceTemplate) => void;
  handleSelectPrompt: (prompt: Prompt) => void;
  connectionStatus: string;
  onRefreshLists: () => void; // Add prop for refresh handler
  isConnecting: boolean; // Add isConnecting prop
}

// Helper to truncate description
const truncateDescription = (text: string | undefined, length = 50): string => {
    if (!text) return '';
    return text.length > length ? text.substring(0, length) + '...' : text;
};


export const UnifiedPanel: React.FC<UnifiedPanelProps> = ({
  tools,
  resources,
  resourceTemplates,
  prompts,
  selectedTool,
  selectedResourceTemplate,
  selectedPrompt,
  handleSelectTool,
  handleSelectResourceTemplate,
  handleSelectPrompt,
  connectionStatus,
  onRefreshLists, // Destructure the new prop
  isConnecting, // Destructure isConnecting
}) => {
  const [filterText, setFilterText] = useState('');
  const [expandedCategories, setExpandedCategories] = useState({
    tools: true,
    resources: true,
    resourceTemplates: true,
    prompts: true,
  });
  const [focusedIndex, setFocusedIndex] = useState<{ [key: string]: number }>({});
  const listRefs = useRef<{ [key: string]: (HTMLLIElement | null)[] }>({});

  useEffect(() => {
    // Reset focus when filter text changes
    setFocusedIndex({});
  }, [filterText]);

  const isConnected = connectionStatus === 'Connected';

  const filteredItems = useMemo(() => {
    const lowerCaseFilter = filterText.toLowerCase();
    if (!lowerCaseFilter) {
      return { 
        filteredTools: tools, 
        filteredResources: resources, 
        filteredResourceTemplates: resourceTemplates, 
        filteredPrompts: prompts 
      };
    }

    const filteredTools = tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(lowerCaseFilter) ||
        tool.description?.toLowerCase().includes(lowerCaseFilter)
    );
    const filteredResources = resources.filter(
      (res) =>
        res.name?.toLowerCase().includes(lowerCaseFilter) ||
        res.uri?.toLowerCase().includes(lowerCaseFilter) ||
        res.description?.toLowerCase().includes(lowerCaseFilter)
    );
    const filteredResourceTemplates = resourceTemplates.filter(
      (template) =>
        template.name?.toLowerCase().includes(lowerCaseFilter) ||
        template.uriTemplate?.toLowerCase().includes(lowerCaseFilter) ||
        template.description?.toLowerCase().includes(lowerCaseFilter)
    );
    const filteredPrompts = prompts.filter(
      (prompt) =>
        prompt.name.toLowerCase().includes(lowerCaseFilter) ||
        prompt.description?.toLowerCase().includes(lowerCaseFilter)
    );

    return { filteredTools, filteredResources, filteredResourceTemplates, filteredPrompts };
  }, [filterText, tools, resources, resourceTemplates, prompts]);

  const { filteredTools, filteredResources, filteredResourceTemplates, filteredPrompts } = filteredItems;

  const handleKeyDown = (e: React.KeyboardEvent, category: string, items: any[]) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const newIndex = (focusedIndex[category] ?? -1) + 1;
      if (newIndex < items.length) {
        setFocusedIndex({ ...focusedIndex, [category]: newIndex });
        listRefs.current[category]?.[newIndex]?.focus();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const newIndex = (focusedIndex[category] ?? 0) - 1;
      if (newIndex >= 0) {
        setFocusedIndex({ ...focusedIndex, [category]: newIndex });
        listRefs.current[category]?.[newIndex]?.focus();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const index = focusedIndex[category];
      if (index !== undefined && items[index]) {
        const item = items[index];
        if (category === 'tools') handleSelectTool(item);
        if (category === 'resourceTemplates') handleSelectResourceTemplate(item);
        if (category === 'prompts') handleSelectPrompt(item);
      }
    }
  };

  // Separate supported and unsupported capabilities
  // Use original arrays (not filtered) to determine if a capability is supported
  const allCapabilities = [
    { key: 'tools', items: filteredTools, originalItems: tools, label: 'Tools', handler: handleSelectTool },
    { key: 'resources', items: filteredResources, originalItems: resources, label: 'Resources', handler: null },
    { key: 'resourceTemplates', items: filteredResourceTemplates, originalItems: resourceTemplates, label: 'Resource Templates', handler: handleSelectResourceTemplate },
    { key: 'prompts', items: filteredPrompts, originalItems: prompts, label: 'Prompts', handler: handleSelectPrompt }
  ];

  const supportedCapabilities = allCapabilities.filter(cap => cap.originalItems.length > 0);
  const unsupportedCapabilities = allCapabilities.filter(cap => cap.originalItems.length === 0 && isConnected);

  const toggleCategory = (category: keyof typeof expandedCategories) => {
    setExpandedCategories((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  return (
    <div className={`card unified-panel ${!isConnected ? 'unified-panel-deactivated' : ''}`}>
      {/* Panel Header with Title and Refresh Button */}
      <div className="card-header d-flex justify-content-between align-items-center">
        <h5 className="mb-0">Capabilities</h5>
        <button
          className="btn btn-sm btn-outline-secondary refresh-button"
          onClick={onRefreshLists}
          disabled={!isConnected || isConnecting} // Disable if not connected or connecting
          title="Refresh Tools, Resources, and Prompts"
        >
          Refresh
        </button>
      </div>
      <input
        type="text"
        placeholder="Filter by name or description..."
        value={filterText}
        onChange={(e) => setFilterText(e.target.value)}
        className="filter-input"
        disabled={!isConnected}
      />
      <nav className="tree-view" aria-label="Playground tool lists">
        {/* Supported Capabilities - Only show sections with items */}
        {supportedCapabilities.map((capability) => {
          const { key, items, label, handler } = capability;
          const isExpanded = expandedCategories[key as keyof typeof expandedCategories];
          listRefs.current[key] = [];

          return (
            <details key={key} open={isExpanded} onToggle={(e) => setExpandedCategories(prev => ({...prev, [key]: (e.target as HTMLDetailsElement).open}))}>
              <summary onClick={(e) => { e.preventDefault(); toggleCategory(key as keyof typeof expandedCategories); }}>
                <span className={`category-toggle ${isExpanded ? 'expanded' : ''}`}>▶</span>
                {label} ({items.length})
              </summary>
              {isExpanded && (
                <ul onKeyDown={(e) => handleKeyDown(e, key, items)} role="listbox">
                  {items.map((item: any, index: number) => {
                    const isSelected =
                      (key === 'tools' && selectedTool?.name === item.name) ||
                      (key === 'resourceTemplates' && selectedResourceTemplate?.uriTemplate === item.uriTemplate) ||
                      (key === 'prompts' && selectedPrompt?.name === item.name);

                    return (
                      <li
                        key={item.name || item.uriTemplate || item.uri}
                        ref={el => listRefs.current[key][index] = el}
                        className={`tree-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => isConnected && handler && handler(item)}
                        title={item.description}
                        tabIndex={focusedIndex[key] === index ? 0 : -1}
                        role="option"
                        aria-selected={isSelected}
                        onFocus={() => setFocusedIndex({ ...focusedIndex, [key]: index })}
                      >
                        <div className="item-name">{item.name}</div>
                        <div className="item-uri">{truncateDescription(item.description || item.uriTemplate || item.uri)}</div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </details>
          );
        })}

        {/* Show message if no supported capabilities when connected */}
        {isConnected && supportedCapabilities.length === 0 && (
          <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            This server has no tools to display.
          </div>
        )}

        {/* Show message when not connected */}
        {!isConnected && (
          <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Connect to server to see capabilities
          </div>
        )}

        {/* Unsupported Methods Section */}
        {unsupportedCapabilities.length > 0 && (
          <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
            <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem', paddingLeft: '0.5rem' }}>
              Unsupported Methods
            </h4>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', paddingLeft: '0.5rem' }}>
              {unsupportedCapabilities.map((cap, index) => (
                <span key={cap.key}>
                  {cap.label}{index < unsupportedCapabilities.length - 1 ? ', ' : ''}
                </span>
              ))}
            </div>
          </div>
        )}
      </nav>
    </div>
  );
};