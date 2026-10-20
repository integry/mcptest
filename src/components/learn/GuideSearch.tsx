import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchGuides, type GuideSearchResult, type PreparedGuideSearch } from '../../content/guideSearch';
import { highlightSegments, type MatchRange } from '../../utils/fuzzyMatch';
import { loadGuideSearch, type GuideSearchLoader } from './guideSearchIndex';
import { registerGuideSearchShortcut } from './guideSearchShortcut';
import './GuideSearch.css';

interface GuideSearchProps {
  /** Keeps element ids unique when several search fields are mounted. */
  idPrefix: string;
  variant?: 'sidebar' | 'page';
  /** Whether `/` may focus this field; callers pass true only on content views. */
  shortcutEnabled?: boolean;
  /** The highest-priority enabled field takes the shortcut. */
  shortcutPriority?: number;
  /** Icon-only sidebar: shows a search button that expands the sidebar first. */
  collapsed?: boolean;
  onExpandSidebar?: () => void;
  /** Called after a result is opened, e.g. to close the mobile drawer. */
  onNavigate?: () => void;
  loadIndex?: GuideSearchLoader;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

const Highlighted: React.FC<{ value: string; ranges?: readonly MatchRange[] }> = ({ value, ranges }) => (
  <>
    {highlightSegments(value, ranges).map((segment, index) => (
      segment.match
        ? <mark key={index} className="guide-search-match">{segment.text}</mark>
        : <React.Fragment key={index}>{segment.text}</React.Fragment>
    ))}
  </>
);

const resultLabel = (count: number) => `${count} ${count === 1 ? 'guide' : 'guides'}`;

/**
 * Search across every guide: fuzzy on titles and headings, substring on
 * section excerpts, results grouped by track and linked to the matched
 * section. A combobox whose options stay in the DOM focus order of the input.
 */
const GuideSearch: React.FC<GuideSearchProps> = ({
  idPrefix,
  variant = 'sidebar',
  shortcutEnabled = false,
  shortcutPriority = 0,
  collapsed = false,
  onExpandSidebar,
  onNavigate,
  loadIndex = loadGuideSearch,
}) => {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const railButtonRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [prepared, setPrepared] = useState<PreparedGuideSearch | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [focusPending, setFocusPending] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const ensureIndex = useCallback(() => {
    if (loadState === 'loading' || loadState === 'ready') return;
    setLoadState('loading');
    loadIndex().then(
      index => {
        if (!mounted.current) return;
        setPrepared(index);
        setLoadState('ready');
      },
      () => {
        if (mounted.current) setLoadState('error');
      }
    );
  }, [loadIndex, loadState]);

  const isSearching = query.trim().length > 0;
  const groups = useMemo(() => (prepared && isSearching ? searchGuides(prepared, query) : []), [prepared, query, isSearching]);
  const results = useMemo(() => groups.flatMap(group => group.results), [groups]);
  const activeResult: GuideSearchResult | undefined = results[activeIndex];
  const listId = `${idPrefix}-guide-search-results`;
  const optionId = useCallback((result: GuideSearchResult) => `${idPrefix}-guide-search-${result.key}`, [idPrefix]);
  const expanded = isSearching && loadState === 'ready';

  useEffect(() => setActiveIndex(-1), [query]);

  useEffect(() => {
    if (!activeResult) return;
    document.getElementById(optionId(activeResult))?.scrollIntoView?.({ block: 'nearest' });
  }, [activeResult, optionId]);

  // The collapsed rail has no field; the shortcut expands the sidebar and
  // focuses the field once it renders.
  useEffect(() => {
    if (!focusPending || collapsed) return;
    setFocusPending(false);
    inputRef.current?.focus();
  }, [focusPending, collapsed]);

  useEffect(() => {
    if (!shortcutEnabled) return undefined;
    return registerGuideSearchShortcut({
      priority: shortcutPriority,
      focus: () => {
        // A control hidden by CSS (the desktop sidebar on a phone) cannot take
        // focus, so a hidden sidebar never swallows the key or expands.
        const control = collapsed ? railButtonRef.current : inputRef.current;
        if (!control || (collapsed && !onExpandSidebar)) return false;
        control.focus();
        if (document.activeElement !== control) return false;
        if (collapsed) {
          onExpandSidebar!();
          setFocusPending(true);
        } else {
          inputRef.current!.select();
        }
        return true;
      },
    });
  }, [shortcutEnabled, shortcutPriority, collapsed, onExpandSidebar]);

  const openResult = (result: GuideSearchResult) => {
    navigate(result.href);
    setQuery('');
    inputRef.current?.blur();
    onNavigate?.();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (results.length === 0) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex(current => {
        if (current < 0) return step > 0 ? 0 : results.length - 1;
        return Math.min(results.length - 1, Math.max(0, current + step));
      });
    } else if (event.key === 'Enter') {
      const target = activeResult ?? results[0];
      if (!target) return;
      event.preventDefault();
      openResult(target);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (query) setQuery('');
      else inputRef.current?.blur();
    }
  };

  if (collapsed) {
    return (
      <div className="guide-search guide-search--collapsed">
        <button
          ref={railButtonRef}
          type="button"
          className="nav-link sidenav-link"
          onClick={() => {
            onExpandSidebar?.();
            setFocusPending(true);
          }}
          title="Search guides"
          aria-label="Search guides"
          aria-keyshortcuts={shortcutEnabled ? '/' : undefined}
        >
          <i className="bi bi-search sidenav-icon" aria-hidden="true"></i>
        </button>
      </div>
    );
  }

  let status = '';
  if (isSearching) {
    if (loadState === 'loading' || loadState === 'idle') status = 'Loading guides…';
    else if (loadState === 'error') status = 'Guide search is unavailable right now. Try again in a moment.';
    else status = results.length ? `${resultLabel(results.length)} found` : 'No guides match';
  }

  return (
    <div className={`guide-search guide-search--${variant}`} role="search" aria-label="Guides">
      <div className="guide-search-field">
        <i className="bi bi-search guide-search-icon" aria-hidden="true"></i>
        <input
          ref={inputRef}
          type="search"
          className="guide-search-input"
          placeholder="Search guides"
          aria-label="Search guides"
          aria-keyshortcuts={shortcutEnabled ? '/' : undefined}
          role="combobox"
          aria-expanded={expanded && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeResult ? optionId(activeResult) : undefined}
          value={query}
          onChange={event => {
            setQuery(event.target.value);
            ensureIndex();
          }}
          onFocus={ensureIndex}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        {shortcutEnabled && !query && <kbd className="guide-search-shortcut" aria-hidden="true">/</kbd>}
      </div>
      <p className={`guide-search-status${status ? '' : ' visually-hidden'}`} role="status" aria-live="polite">
        {status}
      </p>
      <div id={listId} className="guide-search-results" role="listbox" aria-label="Guide search results" hidden={!expanded || results.length === 0}>
        {expanded && groups.map(group => (
          <div className="guide-search-group" role="group" aria-labelledby={`${listId}-${group.track}`} key={group.track}>
            <div className="guide-search-group-label" id={`${listId}-${group.track}`} role="presentation">{group.label}</div>
            {group.results.map(result => {
              const isActive = result === activeResult;
              return (
                <a
                  key={result.key}
                  id={optionId(result)}
                  href={result.href}
                  role="option"
                  aria-selected={isActive}
                  tabIndex={-1}
                  className={`guide-search-option${isActive ? ' is-active' : ''}`}
                  // Keep focus in the field so the list does not close mid-click.
                  onMouseDown={event => event.preventDefault()}
                  onMouseMove={() => setActiveIndex(results.indexOf(result))}
                  onClick={event => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                    event.preventDefault();
                    openResult(result);
                  }}
                >
                  <span className="guide-search-option-title">
                    <Highlighted value={result.article.title} ranges={result.titleRanges} />
                  </span>
                  {result.heading && (
                    <span className="guide-search-option-heading">
                      <i className="bi bi-hash" aria-hidden="true"></i>
                      <Highlighted value={result.heading.text} ranges={result.headingRanges} />
                    </span>
                  )}
                  {result.snippet.text && (
                    <span className="guide-search-option-snippet">
                      <Highlighted value={result.snippet.text} ranges={result.snippet.ranges} />
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default GuideSearch;
