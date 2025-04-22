import React, { useState, useMemo } from 'react';
import { Tool, ResourceTemplate, Prompt, SelectedTool, SelectedPrompt } from '../types'; // Assuming Tool type exists or adjust as needed
import './UnifiedPanel.css'; // We'll create this CSS file next

interface UnifiedPanelProps {
  tools: Tool[];
  resources: ResourceTemplate[];
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
    prompts: true,
  });

  const isConnected = connectionStatus === 'Connected';

  const filteredItems = useMemo(() => {
    const lowerCaseFilter = filterText.toLowerCase();
    if (!lowerCaseFilter) {
      return { filteredTools: tools, filteredResources: resources, filteredPrompts: prompts };
    }

    const filteredTools = tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(lowerCaseFilter) ||
        tool.description?.toLowerCase().includes(lowerCaseFilter)
    );
    const filteredResources = resources.filter(
      (res) =>
        res.uriTemplate.toLowerCase().includes(lowerCaseFilter) ||
        res.description?.toLowerCase().includes(lowerCaseFilter)
    );
    const filteredPrompts = prompts.filter(
      (prompt) =>
        prompt.name.toLowerCase().includes(lowerCaseFilter) ||
        prompt.description?.toLowerCase().includes(lowerCaseFilter)
    );

    return { filteredTools, filteredResources, filteredPrompts };
  }, [filterText, tools, resources, prompts]);

  const { filteredTools, filteredResources, filteredPrompts } = filteredItems;

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
        {/* Tools Section */}
        <details open={expandedCategories.tools} onToggle={(e) => setExpandedCategories(prev => ({...prev, tools: (e.target as HTMLDetailsElement).open}))}>
          <summary onClick={(e) => { e.preventDefault(); toggleCategory('tools'); }}>
            <span className={`category-toggle ${expandedCategories.tools ? 'expanded' : ''}`}>▶</span>
            Tools ({filteredTools.length})
          </summary>
          {expandedCategories.tools && (
            <ul>
              {filteredTools.map((tool) => (
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
               {isConnected && filteredTools.length === 0 && <li><small>No tools match filter.</small></li>}
               {!isConnected && <li><small>Connect to server to see tools.</small></li>}
            </ul>
          )}
        </details>

        {/* Resources Section */}
         <details open={expandedCategories.resources} onToggle={(e) => setExpandedCategories(prev => ({...prev, resources: (e.target as HTMLDetailsElement).open}))}>
          <summary onClick={(e) => { e.preventDefault(); toggleCategory('resources'); }}>
            <span className={`category-toggle ${expandedCategories.resources ? 'expanded' : ''}`}>▶</span>
            Resources ({filteredResources.length})
          </summary>
          {expandedCategories.resources && (
            <ul>
              {filteredResources.map((res) => (
                <li
                  key={res.uriTemplate}
                  className={`tree-item ${selectedResourceTemplate?.uriTemplate === res.uriTemplate ? 'selected' : ''}`}
                  onClick={() => isConnected && handleSelectResourceTemplate(res)}
                   title={res.description}
                >
                  <div className="item-name">{res.uriTemplate}</div>
                  <div className="item-uri">{truncateDescription(res.description)}</div>
                </li>
              ))}
               {isConnected && filteredResources.length === 0 && <li><small>No resources match filter.</small></li>}
               {!isConnected && <li><small>Connect to server to see resources.</small></li>}
            </ul>
          )}
        </details>

        {/* Prompts Section */}
         <details open={expandedCategories.prompts} onToggle={(e) => setExpandedCategories(prev => ({...prev, prompts: (e.target as HTMLDetailsElement).open}))}>
          <summary onClick={(e) => { e.preventDefault(); toggleCategory('prompts'); }}>
            <span className={`category-toggle ${expandedCategories.prompts ? 'expanded' : ''}`}>▶</span>
            Prompts ({filteredPrompts.length})
          </summary>
          {expandedCategories.prompts && (
            <ul>
              {filteredPrompts.map((prompt) => (
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
               {isConnected && filteredPrompts.length === 0 && <li><small>No prompts match filter.</small></li>}
               {!isConnected && <li><small>Connect to server to see prompts.</small></li>}
            </ul>
          )}
        </details>
      </div>
    </div>
  );
};