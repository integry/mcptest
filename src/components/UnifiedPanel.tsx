import React, { useState, useMemo, useRef, useEffect, useId } from 'react';
import { Tool, Resource, ResourceTemplate, Prompt, SelectedTool, SelectedPrompt } from '../types';
import {
  highlightSegments,
  prepareFields,
  rankItems,
  tokenizeQuery,
  type MatchRange,
  type PreparedField,
  type RankedItem,
} from '../utils/fuzzyMatch';
import { MENU_OPEN_CLASS } from '../hooks/useMobileDrawer';
import './UnifiedPanel.css';

interface UnifiedPanelProps {
  tools: Tool[];
  resources: Resource[]; // Actual resources
  resourceTemplates: ResourceTemplate[]; // Resource templates
  prompts: Prompt[];
  selectedTool: SelectedTool | null;
  selectedResourceTemplate: ResourceTemplate | null;
  selectedPrompt: SelectedPrompt | null;
  handleSelectTool: (tool: Tool) => void;
  handleSelectResource: (resource: Resource) => void;
  handleSelectResourceTemplate: (template: ResourceTemplate) => void;
  handleSelectPrompt: (prompt: Prompt) => void;
  connectionStatus: string;
  onRefreshLists: () => void; // Add prop for refresh handler
  isConnecting: boolean; // Add isConnecting prop
  onOpenTestPlan?: () => void;
  /** Enables the `/` shortcut; only the visible playground tab should listen. */
  shortcutEnabled?: boolean;
}

type CategoryKey = 'tools' | 'resources' | 'resourceTemplates' | 'prompts';

const CATEGORY_NOUNS: Record<CategoryKey, [singular: string, plural: string]> = {
  tools: ['tool', 'tools'],
  resources: ['resource', 'resources'],
  resourceTemplates: ['template', 'templates'],
  prompts: ['prompt', 'prompts'],
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const itemTitle = (item: any): string => {
  const title = text(item?.title) || text(item?.annotations?.title);
  return title && title !== item?.name ? title : '';
};

const itemSecondaryText = (item: any): string => text(item?.description) || text(item?.uriTemplate) || text(item?.uri);

/** Search fields per item: identifiers rank above prose. */
const searchFields = (item: any): PreparedField[] => prepareFields([
  { key: 'name', text: text(item?.name), kind: 'identifier', weight: 3 },
  { key: 'title', text: itemTitle(item), kind: 'identifier', weight: 2 },
  { key: 'uri', text: text(item?.uriTemplate) || text(item?.uri), kind: 'prose', weight: 1.5 },
  { key: 'description', text: text(item?.description), kind: 'prose', weight: 1 },
]);

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
};

const Highlighted: React.FC<{ value: string; ranges?: MatchRange[] }> = ({ value, ranges }) => (
  <>
    {highlightSegments(value, ranges).map((segment, index) => (
      segment.match
        ? <mark key={index} className="capability-match">{segment.text}</mark>
        : <React.Fragment key={index}>{segment.text}</React.Fragment>
    ))}
  </>
);

export const UnifiedPanel: React.FC<UnifiedPanelProps> = ({
  tools,
  resources,
  resourceTemplates,
  prompts,
  selectedTool,
  selectedResourceTemplate,
  selectedPrompt,
  handleSelectTool,
  handleSelectResource,
  handleSelectResourceTemplate,
  handleSelectPrompt,
  connectionStatus,
  onRefreshLists, // Destructure the new prop
  isConnecting, // Destructure isConnecting
  onOpenTestPlan,
  shortcutEnabled = false,
}) => {
  const [filterText, setFilterText] = useState('');
  const [expandedCategories, setExpandedCategories] = useState({
    tools: true,
    resources: true,
    resourceTemplates: true,
    prompts: true,
  });
  const [focusedIndex, setFocusedIndex] = useState<{ [key: string]: number }>({});
  // Index into the flat list of visible results, driven from the search field.
  const [activeIndex, setActiveIndex] = useState(-1);
  const listRefs = useRef<{ [key: string]: (HTMLLIElement | null)[] }>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const idPrefix = useId();

  useEffect(() => {
    // Reset focus when filter text changes
    setFocusedIndex({});
    setActiveIndex(-1);
  }, [filterText]);

  const isConnected = connectionStatus === 'Connected';

  // Preparing fields per list keeps each keystroke to a scan of lowercase text.
  const preparedTools = useMemo(() => tools.map(searchFields), [tools]);
  const preparedResources = useMemo(() => resources.map(searchFields), [resources]);
  const preparedTemplates = useMemo(() => resourceTemplates.map(searchFields), [resourceTemplates]);
  const preparedPrompts = useMemo(() => prompts.map(searchFields), [prompts]);

  const ranked = useMemo<Record<CategoryKey, RankedItem<any>[]>>(() => ({
    tools: rankItems(tools, preparedTools, filterText),
    resources: rankItems(resources, preparedResources, filterText),
    resourceTemplates: rankItems(resourceTemplates, preparedTemplates, filterText),
    prompts: rankItems(prompts, preparedPrompts, filterText),
  }), [
    filterText, tools, resources, resourceTemplates, prompts,
    preparedTools, preparedResources, preparedTemplates, preparedPrompts,
  ]);
  const isSearching = tokenizeQuery(filterText).length > 0;

  const selectItem = (category: string, item: any) => {
    if (!isConnected) return;
    if (category === 'tools') handleSelectTool(item);
    if (category === 'resources') handleSelectResource(item);
    if (category === 'resourceTemplates') handleSelectResourceTemplate(item);
    if (category === 'prompts') handleSelectPrompt(item);
  };

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
      if (index !== undefined && items[index]) selectItem(category, items[index]);
    } else if (e.key === 'Escape' && filterText) {
      e.preventDefault();
      setFilterText('');
      searchRef.current?.focus();
    }
  };

  // Separate supported and unsupported capabilities
  // Use original arrays (not filtered) to determine if a capability is supported
  const allCapabilities: Array<{ key: CategoryKey; items: RankedItem<any>[]; originalItems: unknown[]; label: string }> = [
    { key: 'tools', items: ranked.tools, originalItems: tools, label: 'Tools' },
    { key: 'resources', items: ranked.resources, originalItems: resources, label: 'Resources' },
    { key: 'resourceTemplates', items: ranked.resourceTemplates, originalItems: resourceTemplates, label: 'Resource Templates' },
    { key: 'prompts', items: ranked.prompts, originalItems: prompts, label: 'Prompts' },
  ];

  const supportedCapabilities = allCapabilities.filter(cap => cap.originalItems.length > 0);

  // Results reachable with the arrow keys from the search field, in display order.
  const visibleResults = supportedCapabilities.flatMap(({ key, items }) => (
    expandedCategories[key] ? items.map((result, index) => ({ key, result, index })) : []
  ));
  const activeResult = activeIndex >= 0 ? visibleResults[activeIndex] : undefined;
  const optionId = (key: string, index: number) => `${idPrefix}-${key}-${index}`;

  useEffect(() => {
    if (!activeResult) return;
    listRefs.current[activeResult.key]?.[activeResult.index]?.scrollIntoView?.({ block: 'nearest' });
  }, [activeResult]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (visibleResults.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => {
        if (current < 0) return step > 0 ? 0 : visibleResults.length - 1;
        return Math.min(visibleResults.length - 1, Math.max(0, current + step));
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = activeResult ?? (isSearching ? visibleResults[0] : undefined);
      if (target) selectItem(target.key, target.result.item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (filterText) setFilterText('');
      else searchRef.current?.blur();
    }
  };

  useEffect(() => {
    if (!shortcutEnabled || !isConnected) return;
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return;
      // An open dialog or drawer owns the keyboard. The mobile drawer stays
      // mounted as a modal dialog, so it counts only while the menu is open.
      if (document.body.classList.contains(MENU_OPEN_CLASS)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]:not(.mobile-sidebar)')) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [shortcutEnabled, isConnected]);

  const toggleCategory = (category: keyof typeof expandedCategories) => {
    setExpandedCategories((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  const matchSummary = supportedCapabilities
    .map(({ key, items }) => `${items.length} ${CATEGORY_NOUNS[key][items.length === 1 ? 0 : 1]}`)
    .join(' · ');
  const treeId = `${idPrefix}-capability-tree`;

  return (
    <div className={`card unified-panel ${!isConnected ? 'unified-panel-deactivated' : ''}`}>
      {/* Panel Header with Title and Refresh Button */}
      <div className="card-header d-flex justify-content-between align-items-center">
        <div>
          <h5 className="mb-0">Capabilities</h5>
        </div>
        <div className="d-flex gap-2 align-items-center">
          {onOpenTestPlan && (
            <button
              className="btn btn-sm btn-outline-primary test-plan-button"
              onClick={onOpenTestPlan}
              disabled={!isConnected || isConnecting || tools.length === 0}
              title="Create and run deterministic tool tests"
            >
              <i className="bi bi-clipboard-check" aria-hidden="true"></i>
              <span>Test tools</span>
            </button>
          )}
          <button
            className="btn btn-sm btn-ghost refresh-button"
            onClick={onRefreshLists}
            disabled={!isConnected || isConnecting}
            title="Refresh Tools, Resources, and Prompts"
          >
            <i className="bi bi-arrow-clockwise" aria-hidden="true"></i>
            <span className="visually-hidden">Refresh capabilities</span>
          </button>
        </div>
      </div>
      <div className="capability-search">
        <i className="bi bi-search capability-search-icon" aria-hidden="true"></i>
        <input
          ref={searchRef}
          type="search"
          placeholder="Search capabilities"
          aria-label="Search tools, resources and prompts"
          aria-keyshortcuts="/"
          role="combobox"
          aria-expanded={visibleResults.length > 0}
          aria-controls={treeId}
          aria-autocomplete="list"
          aria-activedescendant={activeResult ? optionId(activeResult.key, activeResult.index) : undefined}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          className="filter-input capability-search-input"
          disabled={!isConnected}
          autoComplete="off"
          spellCheck={false}
        />
        {!filterText && <kbd className="capability-search-shortcut" aria-hidden="true">/</kbd>}
      </div>
      {isConnected && supportedCapabilities.length > 0 && (
        <p className="capability-search-summary" role="status" aria-live="polite">
          {isSearching ? `${matchSummary} match` : matchSummary}
        </p>
      )}
      <nav className="tree-view" aria-label="Playground tool lists" id={treeId}>
        {/* Supported Capabilities - Only show sections with items */}
        {supportedCapabilities.map((capability) => {
          const { key, items, originalItems, label } = capability;
          const isExpanded = expandedCategories[key as keyof typeof expandedCategories];
          listRefs.current[key] = [];
          const plainItems = items.map((result) => result.item);

          return (
            <details key={key} open={isExpanded} onToggle={(e) => setExpandedCategories(prev => ({...prev, [key]: (e.target as HTMLDetailsElement).open}))}>
              <summary onClick={(e) => { e.preventDefault(); toggleCategory(key as keyof typeof expandedCategories); }}>
                <span className={`category-toggle ${isExpanded ? 'expanded' : ''}`}>▶</span>
                {label} ({isSearching ? `${items.length} of ${originalItems.length}` : items.length})
              </summary>
              {isExpanded && (
                <ul onKeyDown={(e) => handleKeyDown(e, key, plainItems)} role="listbox" aria-label={label}>
                  {items.length === 0 && isSearching && (
                    <li className="tree-item-empty" role="presentation">No matching {CATEGORY_NOUNS[key][1]}</li>
                  )}
                  {items.map(({ item, ranges }, index: number) => {
                    const isSelected =
                      (key === 'tools' && selectedTool?.name === item.name) ||
                      (key === 'resources' && selectedResourceTemplate?.uriTemplate === item.uri) ||
                      (key === 'resourceTemplates' && selectedResourceTemplate?.uriTemplate === item.uriTemplate) ||
                      (key === 'prompts' && selectedPrompt?.name === item.name);
                    const isActive = activeResult?.key === key && activeResult.index === index;
                    const title = itemTitle(item);
                    const secondary = itemSecondaryText(item);
                    const secondaryRanges = item.description ? ranges.description : ranges.uri;

                    return (
                      <li
                        key={item.name || item.uriTemplate || item.uri}
                        id={optionId(key, index)}
                        ref={(el) => { listRefs.current[key][index] = el; }}
                        className={`tree-item ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''}`}
                        onClick={() => selectItem(key, item)}
                        title={item.description}
                        tabIndex={focusedIndex[key] === index ? 0 : -1}
                        role="option"
                        aria-selected={isSelected}
                        onFocus={() => setFocusedIndex({ ...focusedIndex, [key]: index })}
                      >
                        <div className="item-name"><Highlighted value={text(item.name) || secondary} ranges={ranges.name} /></div>
                        {(title || secondary) && (
                          <div className="item-uri">
                            {title && <span className="item-title"><Highlighted value={title} ranges={ranges.title} /></span>}
                            {title && secondary && ' · '}
                            {secondary && <Highlighted value={secondary} ranges={secondaryRanges} />}
                          </div>
                        )}
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
            This server did not advertise any capabilities.
          </div>
        )}

        {/* Show message when not connected */}
        {!isConnected && (
          <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Connect to server to see capabilities
          </div>
        )}

      </nav>
    </div>
  );
};
