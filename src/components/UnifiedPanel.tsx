import React, { useState, useMemo } from 'react';
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

  // Separate supported and unsupported capabilities
  // Use original arrays (not filtered) to determine if a capability is supported
  const allCapabilities = [
    { key: 'tools', items: filteredTools, originalItems: tools, label: 'Tools' },
    { key: 'resources', items: filteredResources, originalItems: resources, label: 'Resources' },
    { key: 'resourceTemplates', items: filteredResourceTemplates, originalItems: resourceTemplates, label: 'Resource Templates' },
    { key: 'prompts', items: filteredPrompts, originalItems: prompts, label: 'Prompts' }
  ];

  const supportedCapabilities = allCapabilities.filter(cap => cap.originalItems.length > 0);
  const unsupportedCapabilities = allCapabilities.filter(cap => cap.originalItems.length === 0 && isConnected);

  const toggleCategory = (category: keyof typeof expandedCategories) => {
    setExpandedCategories((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  return (
    <div className={`panel unified-panel ${!isConnected ? 'unified-panel-deactivated' : ''}`}>
      {/* Panel Header with Title and Refresh Button */}
      <div className="unified-panel-header">
        <h3>Capabilities</h3>
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
      <div className="tree-view">
        {/* Supported Capabilities - Only show sections with items */}
        {supportedCapabilities.map((capability) => {
          const { key, items, label } = capability;
          const isExpanded = expandedCategories[key as keyof typeof expandedCategories];
          
          return (
            <details key={key} open={isExpanded} onToggle={(e) => setExpandedCategories(prev => ({...prev, [key]: (e.target as HTMLDetailsElement).open}))}>
              <summary onClick={(e) => { e.preventDefault(); toggleCategory(key as keyof typeof expandedCategories); }}>
                <span className={`category-toggle ${isExpanded ? 'expanded' : ''}`}>▶</span>
                {label} ({items.length})
              </summary>
              {isExpanded && (
                <ul>
                  {key === 'tools' && items.map((tool: any) => (
                    <li
                      key={tool.name}
                      className={`tree-item ${selectedTool?.name === tool.name ? 'selected' : ''}`}
                      onClick={() => isConnected && handleSelectTool(tool)}
                      title={tool.description}
                    >
                      <div className="item-name">{tool.name}</div>
                      <div className="item-uri">{truncateDescription(tool.description)}</div>
                    </li>
                  ))}
                  {key === 'resources' && items.map((res: any) => (
                    <li
                      key={res.uri || res.name}
                      className={`tree-item`}
                      title={res.description}
                    >
                      <div className="item-name">{res.name}</div>
                      <div className="item-uri">{res.uri && truncateDescription(res.uri)} {res.description && truncateDescription(res.description)}</div>
                    </li>
                  ))}
                  {key === 'resourceTemplates' && items.map((template: any) => (
                    <li
                      key={template.uriTemplate}
                      className={`tree-item ${selectedResourceTemplate?.uriTemplate === template.uriTemplate ? 'selected' : ''}`}
                      onClick={() => isConnected && handleSelectResourceTemplate(template)}
                      title={template.description}
                    >
                      <div className="item-name">{template.name}</div>
                      <div className="item-uri">{truncateDescription(template.uriTemplate)} {template.description && truncateDescription(template.description)}</div>
                    </li>
                  ))}
                  {key === 'prompts' && items.map((prompt: any) => (
                    <li
                      key={prompt.name}
                      className={`tree-item ${selectedPrompt?.name === prompt.name ? 'selected' : ''}`}
                      onClick={() => isConnected && handleSelectPrompt(prompt)}
                      title={prompt.description}
                    >
                      <div className="item-name">{prompt.name}</div>
                      <div className="item-uri">{truncateDescription(prompt.description)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          );
        })}

        {/* Show message if no supported capabilities when connected */}
        {isConnected && supportedCapabilities.length === 0 && (
          <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            No supported capabilities found
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
      </div>
    </div>
  );
};