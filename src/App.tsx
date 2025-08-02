import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// Import Analytics helpers
import { logPageView, logEvent } from './utils/analytics';

// Import Components
import Header from './components/Header';
import TabContent from './components/TabContent';
// Placeholders for new components
import SideNav from './components/SideNav'; // New
import SpacesView from './components/SpacesView'; // New
import Tabs from './components/Tabs'; // New
// Documentation components
import WhatIsMcp from './components/docs/WhatIsMcp';
import RemoteVsLocal from './components/docs/RemoteVsLocal';
import TestingGuide from './components/docs/TestingGuide';
import Troubleshooting from './components/docs/Troubleshooting';
import PrivacyPolicy from './components/docs/PrivacyPolicy';
import TermsOfService from './components/docs/TermsOfService';
import Contact from './components/docs/Contact';

// Import Data Sync Hook
import { useDataSync } from './hooks/useDataSync';

import { v4 as uuidv4 } from 'uuid';

// Import Types
import {
  Space, SpaceCard,
  AccessResourceResultSchema, // Import the result schema
  ConnectionTab
} from './types';

// Import Utils
import { generateSpaceSlug, findSpaceBySlug, getSpaceUrl, extractSlugFromPath, parseServerUrl, parseResultShareUrl } from './utils/urlUtils';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CorsAwareStreamableHTTPTransport } from './utils/corsAwareTransport';
import { formatErrorForDisplay } from './utils/errorHandling';

// Constants for localStorage keys
const SPACES_KEY = 'mcpSpaces'; // New key for spaces
const TABS_KEY = 'mcpConnectionTabs'; // New key for tabs

// Helper to determine initial view from URL
const getInitialView = (): 'inspector' | 'spaces' | 'docs' => {
  const path = window.location.pathname;
  if (path.startsWith('/docs/')) {
    return 'docs';
  }
  if (path.startsWith('/space/')) {
    return 'spaces';
  }
  return 'inspector';
};

// Helper to load spaces from localStorage
const loadData = <T extends {}>(key: string, defaultValue: T): T => {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);

      // For SPACES_KEY, we expect an array.
      if (key === SPACES_KEY) {
        if (Array.isArray(parsed)) {
          const spaces = (parsed as Space[]).map(space => ({
            ...space,
            cards: (space.cards || []).map(card => { // Ensure cards is an array
              const { loading, error, responseData, responseType, ...restOfCard } = card;
              return restOfCard;
            })
          }));
          return spaces as T;
        }
        // If not an array, it's invalid, fall through to return default.
      } 
      // For other keys, use the original less-strict check
      else if (typeof parsed === typeof defaultValue && parsed !== null) {
        return parsed as T;
      }
    }
  } catch (e) {
    console.error(`Failed to load or parse data from localStorage key "${key}":`, e);
  }
  // Return default if stored value is missing, invalid, or doesn't match expected type
  return defaultValue;
};

// Helper to save spaces to localStorage
const saveData = (key: string, data: any) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error(`Failed to save data to localStorage key "${key}":`, e);
  }
};


// Add isReloading to window for TypeScript
declare global {
  interface Window {
    isReloading?: boolean;
    mcpSseCallback?: (data: any) => void;
  }
}

function App() {
  // --- State ---
  const [spaces, setSpaces] = useState<Space[]>(() => loadData<Space[]>(SPACES_KEY, [{ id: 'default', name: 'Default Space', cards: [] }]));
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(spaces[0]?.id || 'default'); // Select first space initially
  const [healthCheckLoading, setHealthCheckLoading] = useState<boolean>(true);
  const [loadedSpaces, setLoadedSpaces] = useState<Set<string>>(new Set()); // Track which spaces have been loaded
  
  // Tab state
  const [tabs, setTabs] = useState<ConnectionTab[]>(() => {
    const savedTabs = localStorage.getItem(TABS_KEY);
    return savedTabs ? JSON.parse(savedTabs) : [{ id: uuidv4(), title: 'New Connection', serverUrl: '', connectionStatus: 'Disconnected' }];
  });
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0]?.id || '');

  // Router hooks
  const location = useLocation();
  const navigate = useNavigate();
  
  // Activate the data sync hook
  useDataSync({ spaces, tabs, setSpaces, setTabs });
  
  // Derive active view and doc page from location
  const { activeView, activeDocPage } = useMemo(() => {
    const path = location.pathname;
    
    // Check for documentation routes
    if (path.startsWith('/docs/')) {
      const docPage = path.replace('/docs/', '');
      return { activeView: 'docs' as const, activeDocPage: docPage };
    }
    
    // Check for space routes
    const slug = extractSlugFromPath(path);
    if (slug) {
      const space = findSpaceBySlug(spaces, slug);
      if (space) {
        return { activeView: 'spaces' as const, activeDocPage: null };
      }
    }
    
    // Default to inspector
    return { activeView: 'inspector' as const, activeDocPage: null };
  }, [location.pathname, spaces]);


  // --- Effects ---

  // Save spaces whenever they change
  useEffect(() => {
    saveData(SPACES_KEY, spaces);
  }, [spaces]);

  // Save tabs whenever they change
  useEffect(() => {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  }, [tabs]);

  // Handle URL routing and page view tracking
  useEffect(() => {
    const path = location.pathname;
    let pageTitle = 'Inspector'; // Default title

    // Check for documentation routes
    if (path.startsWith('/docs/')) {
      const docPage = path.replace('/docs/', '');
      pageTitle = `Docs: ${docPage.replace(/-/g, ' ')}`;
      logPageView(path, pageTitle);
      return;
    }
    
    // Check for server URL routes
    const serverUrlData = parseServerUrl(path);
    if (serverUrlData) {
      console.log('[Server URL Route] Detected server URL:', serverUrlData);
      
      // Auto-connect to the specified server
      handleServerUrlConnection(serverUrlData.serverUrl, serverUrlData.transportMethod);
      
      pageTitle = `Server: ${serverUrlData.serverUrl}`;
      logPageView(path, pageTitle);
      return;
    }
    
    // Check for result share URL routes
    const resultShareData = parseResultShareUrl(path, location.search);
    if (resultShareData) {
      console.log('[Result Share Route] Detected result share URL:', resultShareData);
      
      // Auto-connect and execute the tool/resource
      handleResultShareConnection(resultShareData);
      
      pageTitle = `Result: ${resultShareData.name}`;
      logPageView(path, pageTitle);
      return;
    }
    
    const slug = extractSlugFromPath(path);
    
    if (slug) {
      const space = findSpaceBySlug(spaces, slug);
      if (space) {
        setSelectedSpaceId(space.id);
        pageTitle = `Space: ${space.name}`;
      } else {
        navigate('/', { replace: true });
        pageTitle = 'Inspector'; // Redirected
      }
    } else if (path === '/') {
      pageTitle = 'Inspector';
    }
    
    logPageView(path, pageTitle); // Log view change
  }, [location.pathname, spaces, navigate]);

  // Server URL and result share handlers
  const handleServerUrlConnection = (serverUrl: string, transportMethod?: string) => {
    logEvent('server_url_connection', { serverUrl, transportMethod });
    
    // Find or create a tab for this server
    let targetTab = tabs.find(tab => tab.serverUrl === serverUrl);
    
    if (!targetTab) {
      // Create new tab with the server URL
      targetTab = {
        id: uuidv4(),
        title: `Server: ${serverUrl}`,
        serverUrl: serverUrl,
        connectionStatus: 'Disconnected',
      };
      setTabs(prev => [...prev, targetTab!]);
    }
    
    // Set as active tab
    setActiveTabId(targetTab.id);
    
    // Update the tab's server URL and trigger connection
    handleUpdateTab(targetTab.id, { 
      serverUrl: serverUrl,
      title: `Server: ${serverUrl}`
    });
  };

  const handleResultShareConnection = (resultData: {
    serverUrl: string;
    type: 'tool' | 'resource';
    name: string;
    params?: Record<string, any>;
  }) => {
    logEvent('result_share_connection', { 
      serverUrl: resultData.serverUrl, 
      type: resultData.type, 
      name: resultData.name 
    });
    
    // Find or create a tab for this server
    let targetTab = tabs.find(tab => tab.serverUrl === resultData.serverUrl);
    
    if (!targetTab) {
      // Create new tab with the server URL
      targetTab = {
        id: uuidv4(),
        title: `Result: ${resultData.name}`,
        serverUrl: resultData.serverUrl,
        connectionStatus: 'Disconnected',
        resultShareData: {
          type: resultData.type,
          name: resultData.name,
          params: resultData.params
        }
      };
      setTabs(prev => [...prev, targetTab!]);
    }
    
    // Set as active tab
    setActiveTabId(targetTab.id);
    
    // Update the tab's server URL and trigger connection
    handleUpdateTab(targetTab.id, { 
      serverUrl: resultData.serverUrl,
      title: `Result: ${resultData.name}`,
      resultShareData: {
        type: resultData.type,
        name: resultData.name,
        params: resultData.params
      }
    });
  };

  // Tab handler functions
  const handleNewTab = () => {
    logEvent('create_tab');
    const newTab: ConnectionTab = {
      id: uuidv4(),
      title: 'New Connection',
      serverUrl: '',
      connectionStatus: 'Disconnected',
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newTab.id);
  };

  const handleSelectTab = (id: string) => {
    logEvent('select_tab');
    setActiveTabId(id);
  };

  const handleCloseTab = (id: string) => {
    logEvent('close_tab', { tab_count: tabs.length > 1 ? tabs.length - 1 : 1 });
    const newTabs = tabs.filter(tab => tab.id !== id);
    
    // Ensure at least one tab always exists
    if (newTabs.length === 0) {
      const defaultTab: ConnectionTab = {
        id: uuidv4(),
        title: 'New Connection',
        serverUrl: '',
        connectionStatus: 'Disconnected',
      };
      setTabs([defaultTab]);
      setActiveTabId(defaultTab.id);
    } else {
      setTabs(newTabs);
      if (activeTabId === id) {
        setActiveTabId(newTabs[0].id);
      }
    }
  };

  // Function to update a specific tab
  const handleUpdateTab = useCallback((tabId: string, updates: Partial<ConnectionTab>) => {
    setTabs(prevTabs => prevTabs.map(tab => 
      tab.id === tabId ? { ...tab, ...updates } : tab
    ));
  }, []);

  // --- Space Management Functions ---
  const handleCreateSpace = (name: string) => {
    logEvent('create_space');
    const newSpace: Space = { id: Date.now().toString(), name, cards: [] };
    setSpaces(prev => [...prev, newSpace]);
    setSelectedSpaceId(newSpace.id); // Select the new space
    navigate(getSpaceUrl(newSpace.name)); // Navigate to new space URL
  };

  const handleSelectSpace = (id: string) => {
    const space = spaces.find(s => s.id === id);
    if (space) {
      logEvent('select_space');
      setSelectedSpaceId(id);
      navigate(getSpaceUrl(space.name));
    }
  };

  const handleUpdateSpace = (id: string, updatedData: Partial<Omit<Space, 'id'>>) => {
    logEvent('update_space', { updated_keys: Object.keys(updatedData).join(',') });
    setSpaces(prev => prev.map(space => {
      if (space.id === id) {
        const updatedSpace = { ...space, ...updatedData };
        // If we're updating the currently selected space and the name changed, update URL
        if (selectedSpaceId === id && updatedData.name && updatedData.name !== space.name) {
          navigate(getSpaceUrl(updatedData.name), { replace: true });
        }
        return updatedSpace;
      }
      return space;
    }));
  };

  const handleDeleteSpace = (id: string) => {
    logEvent('delete_space');
    const deletedSpace = spaces.find(s => s.id === id);
    setSpaces(prev => prev.filter(space => space.id !== id));
    
    // If the deleted space was selected, handle navigation
    if (selectedSpaceId === id) {
      const remainingSpaces = spaces.filter(s => s.id !== id);
      if (remainingSpaces.length > 0) {
        // Select the first remaining space
        const firstSpace = remainingSpaces[0];
        setSelectedSpaceId(firstSpace.id);
        navigate(getSpaceUrl(firstSpace.name));
      } else {
        // No spaces left, go to inspector
        navigate('/');
      }
    }
  };

  const handleReorderSpaces = (reorderedSpaces: Space[]) => {
    logEvent('reorder_spaces');
    setSpaces(reorderedSpaces);
  };

  // --- Space Health Check Functions ---
  const performAllSpacesHealthCheck = async () => {
    logEvent('health_check_all_spaces', { space_count: spaces.length });
    console.log('[Health Check] Starting health check for all spaces...');
    setHealthCheckLoading(true);
    
    // Don't clear loaded spaces - we want to track which spaces have been navigated to
    // This health check is for updating status, not for initial loading
    
    // Execute all cards in all spaces to refresh their status
    for (const space of spaces) {
      if (space.cards.length > 0) {
        console.log(`[Health Check] Checking ${space.cards.length} cards in space "${space.name}"`);
        // Execute all cards in this space (each card connects to its own server)
        await Promise.all(space.cards.map(card => {
          console.log(`[Health Check] Executing card "${card.title}" on server ${card.serverUrl}`);
          return handleExecuteCard(space.id, card.id);
        }));
        
        // Mark spaces as loaded after health check
        setLoadedSpaces(prev => new Set(prev).add(space.id));
      }
    }
    console.log('[Health Check] Completed health check for all spaces');
    setHealthCheckLoading(false);
  };
  
  const refreshCurrentSpace = async () => {
    if (activeView === 'spaces' && selectedSpaceId) {
      const currentSpace = spaces.find(s => s.id === selectedSpaceId);
      if (currentSpace && currentSpace.cards.length > 0) {
        logEvent('refresh_current_space', { space_id: selectedSpaceId });
        console.log(`[Refresh] Manually refreshing space "${currentSpace.name}"`);
        setHealthCheckLoading(true);
        
        // Remove from loaded spaces to force refresh
        setLoadedSpaces(prev => {
          const newSet = new Set(prev);
          newSet.delete(selectedSpaceId);
          return newSet;
        });
        
        // Refresh all cards in the space
        for (const card of currentSpace.cards) {
          if (!card.loading) {
            await handleExecuteCard(selectedSpaceId, card.id);
          }
        }
        
        // Re-add to loaded spaces
        setLoadedSpaces(prev => new Set(prev).add(selectedSpaceId));
        setHealthCheckLoading(false);
      }
    }
  };

  const getSpaceHealthColor = (spaceId: string): 'green' | 'orange' | 'red' | 'gray' => {
    const space = spaces.find(s => s.id === spaceId);
    if (!space || space.cards.length === 0) return 'gray';

    // Check if any cards are currently loading
    if (healthCheckLoading) return 'gray';

    // Count successful vs failed cards
    const totalCards = space.cards.length;
    const successfulCards = space.cards.filter(card => 
      !card.error && card.responseData && !card.loading
    ).length;
    
    const failureRate = (totalCards - successfulCards) / totalCards;
    
    if (failureRate === 0) return 'green';
    if (failureRate <= 0.2) return 'orange';
    return 'red';
  };

  const getSpaceHealthStatus = (spaceId: string) => {
    const space = spaces.find(s => s.id === spaceId);
    if (!space) return { loading: false, successCount: 0, totalCount: 0 };

    const totalCount = space.cards.length;
    const loadingCount = space.cards.filter(card => card.loading).length;
    const successCount = space.cards.filter(card => 
      !card.error && card.responseData && !card.loading
    ).length;

    // Space is loading if any of its cards are loading
    const isLoading = loadingCount > 0;

    return {
      loading: isLoading,
      successCount,
      totalCount
    };
  };

  // Preload health checks on page load (cards connect to their own servers)
  useEffect(() => {
    // Skip health check if we're loading with a result share URL or server URL
    const path = window.location.pathname;
    const isResultShareUrl = parseResultShareUrl(path, window.location.search) !== null;
    const isServerUrl = parseServerUrl(path) !== null;
    
    if (isResultShareUrl || isServerUrl) {
      console.log('[Health Check] Skipping auto health check due to deep link URL');
      setHealthCheckLoading(false);
      return;
    }
    
    const spacesWithCards = spaces.filter(space => space.cards.length > 0);
    console.log('[Health Check] Page loaded, checking for spaces with cards...', {
      totalSpaces: spaces.length,
      spacesWithCards: spacesWithCards.length,
      totalCards: spaces.reduce((sum, space) => sum + space.cards.length, 0)
    });
    
    // Run health checks if we have any spaces with cards
    if (spacesWithCards.length > 0) {
      console.log('[Health Check] Found spaces with cards, starting auto health check...');
      // Add a small delay to ensure component is fully mounted
      setTimeout(() => {
        performAllSpacesHealthCheck().then(() => {
          console.log('[Health Check] Auto-preload completed successfully');
        }).catch((error) => {
          console.error('[Health Check] Auto-preload failed:', error);
        });
      }, 2000); // 2 second delay to ensure everything is ready
    } else {
      setHealthCheckLoading(false);
      console.log('[Health Check] No spaces with cards found, skipping auto health check');
    }
  }, []); // Run once on mount

  // --- Add to Space Functionality ---
  const handleAddCardToSpace = (spaceId: string, cardData: Omit<Space['cards'][0], 'id'>) => {
      logEvent('add_card_to_space', { 
          card_type: cardData.type
      });
      const newCard = { ...cardData, id: Date.now().toString() };
      setSpaces(prev => prev.map(space => {
          if (space.id === spaceId) {
              return { ...space, cards: [...space.cards, newCard] };
          }
          return space;
      }));
      console.log(`[DEBUG] Added card to space ${spaceId}:`, newCard);
  };

  // --- Card Management Functions ---
  const handleUpdateCard = (spaceId: string, cardId: string, updatedData: Partial<Omit<SpaceCard, 'id'>>) => {
    logEvent('update_card');
    setSpaces(prev => prev.map(space => {
      if (space.id === spaceId) {
        return {
          ...space,
          cards: space.cards.map(card =>
            card.id === cardId ? { ...card, ...updatedData } : card
          )
        };
      }
      return space;
    }));
     console.log(`[DEBUG] Updated card ${cardId} in space ${spaceId}:`, updatedData);
  };

  const handleDeleteCard = (spaceId: string, cardId: string) => {
    logEvent('delete_card');
    setSpaces(prev => prev.map(space => {
      if (space.id === spaceId) {
        return { ...space, cards: space.cards.filter(card => card.id !== cardId) };
      }
      return space;
    }));
    console.log(`[DEBUG] Deleted card ${cardId} from space ${spaceId}`);
  };

  const handleMoveCard = (sourceSpaceId: string, targetSpaceId: string, cardId: string) => {
    logEvent('move_card');
    setSpaces(prev => {
      // Find the card to move
      const sourceSpace = prev.find(space => space.id === sourceSpaceId);
      if (!sourceSpace) return prev;
      
      const cardToMove = sourceSpace.cards.find(card => card.id === cardId);
      if (!cardToMove) return prev;
      
      // Remove card from source space and add to target space
      return prev.map(space => {
        if (space.id === sourceSpaceId) {
          return { ...space, cards: space.cards.filter(card => card.id !== cardId) };
        } else if (space.id === targetSpaceId) {
          return { ...space, cards: [...space.cards, cardToMove] };
        }
        return space;
      });
    });
    console.log(`[DEBUG] Moved card ${cardId} from space ${sourceSpaceId} to space ${targetSpaceId}`);
  };

  // --- Helper Function for Card State Update (Moved Outside) ---
  const updateCardState = (
      currentSpaces: Space[],
      sId: string,
      cId: string,
      newState: Partial<Pick<SpaceCard, 'loading' | 'error' | 'responseData' | 'responseType'>>
  ): Space[] => {
      return currentSpaces.map(space => {
          if (space.id === sId) {
              return {
                  ...space,
                  cards: space.cards.map(c =>
                      c.id === cId ? { ...c, ...newState } : c
                  )
              };
          }
          return space;
      });
  };

  // --- Card Execution Function (Stateless with Retries) ---
  const handleExecuteCard = async (spaceId: string, cardId: string) => {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 250; // Wait 250ms between retries

    const spaceIndex = spaces.findIndex(s => s.id === spaceId);
    if (spaceIndex === -1) return;

    const cardIndex = spaces[spaceIndex].cards.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return;

    const card = spaces[spaceIndex].cards[cardIndex];
    if (card) {
        logEvent('execute_card', {
            card_type: card.type
        });
    }

    // Set initial loading state
    setSpaces(prev => updateCardState(prev, spaceId, cardId, { loading: true, error: null, responseData: null, responseType: null }));

    let tempClient: any = null;
    let lastError: any = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[Execute Card ${cardId} Attempt ${attempt}/${MAX_RETRIES}] Starting execution. Card URL: ${card.serverUrl}`);
        lastError = null; // Clear last error on new attempt

        // --- Connection and Request Logic ---
        let connectUrl: URL;
        try {
            connectUrl = new URL(card.serverUrl);
            if (!connectUrl.pathname.endsWith('/mcp')) {
                connectUrl.pathname = (connectUrl.pathname.endsWith('/') ? connectUrl.pathname : connectUrl.pathname + '/') + 'mcp';
            }
        } catch (e) {
            throw new Error(`Invalid Server URL format in card: ${card.serverUrl}`);
        }

        tempClient = new Client({ name: `mcp-card-executor-${cardId}-${attempt}`, version: "1.0.0" });
        const transport = new CorsAwareStreamableHTTPTransport(connectUrl);

        console.log(`[Execute Card ${cardId} Attempt ${attempt}] Connecting temporary client...`);
        await tempClient.connect(transport);
        console.log(`[Execute Card ${cardId} Attempt ${attempt}] Temporary client connected.`);

        let result: any;
        if (card.type === 'tool') {
            console.log(`[Execute Card ${cardId} Attempt ${attempt}] Calling tool: ${card.name}`);
            result = await tempClient.callTool({ name: card.name, arguments: card.params });
            console.log(`[Execute Card ${cardId} Attempt ${attempt}] Tool result received.`);
            setSpaces(prev => updateCardState(prev, spaceId, cardId, { loading: false, responseData: result.content, responseType: 'tool_result', error: null }));
        } else if (card.type === 'resource') {
            console.log(`[Execute Card ${cardId} Attempt ${attempt}] Accessing resource: ${card.name}`);
            result = await tempClient.request({
                method: 'resources/access',
                params: { uri: card.name, arguments: card.params }
            }, AccessResourceResultSchema);
            console.log(`[Execute Card ${cardId} Attempt ${attempt}] Resource result received.`);
            setSpaces(prev => updateCardState(prev, spaceId, cardId, { loading: false, responseData: result.content, responseType: 'resource_result', error: null }));
        }
        // --- Success: Break the retry loop ---
        break;

      } catch (err: any) {
        console.warn(`[Execute Card ${cardId} Attempt ${attempt}] Error:`, err);
        lastError = err; // Store the error

        // --- Check if it's a retryable conflict error ---
        // This check might need adjustment based on how the SDK/server surfaces the 409 error
        const isConflict = err.message?.includes('Conflict') || err.message?.includes('409') || err.status === 409;

        if (isConflict && attempt < MAX_RETRIES) {
          console.log(`[Execute Card ${cardId} Attempt ${attempt}] Conflict detected, retrying after ${RETRY_DELAY_MS}ms...`);
          // Close the potentially conflicted client before retrying
          if (tempClient) {
              try { await tempClient.close(); } catch { /* ignore close error on retry */ }
              tempClient = null;
          }
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS)); // Wait before retrying
          continue; // Go to the next iteration
        } else {
          // --- Non-retryable error or max retries reached: Set final error state and break ---
          console.error(`[Execute Card ${cardId}] Unrecoverable error or max retries reached.`);
          
          // Use enhanced error formatting for better debugging information
          const errorDetails = formatErrorForDisplay(err, {
            serverUrl: card.serverUrl,
            operation: card.type === 'tool' ? `execute tool ${card.name}` : `access resource ${card.name}`
          });
          
          setSpaces(prev => updateCardState(prev, spaceId, cardId, { loading: false, error: errorDetails, responseData: null, responseType: 'error' }));
          break; // Exit the loop
        }
      } finally {
          // --- Ensure client is closed after each attempt (if not already closed for retry) ---
          if (tempClient) {
              console.log(`[Execute Card ${cardId} Attempt ${attempt}] Closing temporary client in finally block.`);
              try { await tempClient.close(); } catch (closeError) {
                  console.error(`[Execute Card ${cardId} Attempt ${attempt}] Error closing temporary client:`, closeError);
                  // Avoid overwriting a more specific execution error with a close error
                  if (!lastError) {
                     const closeErrorDetails = formatErrorForDisplay(closeError, {
                       serverUrl: card.serverUrl,
                       operation: 'close temporary client'
                     });
                     setSpaces(prev => updateCardState(prev, spaceId, cardId, { loading: false, error: `Failed to close temp client: ${closeErrorDetails}` }));
                  }
              }
              tempClient = null; // Nullify ref after closing attempt
          }
      }
    } // End of retry loop
  };

  // --- Effect to Auto-Refresh Cards on Space Entry (Sequentially with Retries) ---
  useEffect(() => {
    const refreshCardsSequentially = async () => {
      // Only refresh if we're viewing spaces AND this specific space hasn't been loaded yet
      // AND it has cards that have never been executed (no responseData)
      if (activeView === 'spaces' && selectedSpaceId && !loadedSpaces.has(selectedSpaceId)) {
        const currentSpace = spaces.find(s => s.id === selectedSpaceId);
        if (currentSpace && currentSpace.cards.length > 0) {
          // Check if any cards need initial loading (no responseData yet)
          const needsInitialLoad = currentSpace.cards.some(card => !card.responseData && !card.loading);
          
          if (needsInitialLoad) {
            console.log(`[DEBUG] First time entering space "${currentSpace.name}", refreshing ${currentSpace.cards.length} cards sequentially.`);
            setHealthCheckLoading(true);
            
            // Use for...of loop to allow await inside
            for (const card of currentSpace.cards) {
              // Only execute cards that haven't been loaded yet
              if (!card.loading && !card.responseData) {
                 console.log(`[DEBUG] Effect loop: Awaiting handleExecuteCard for card ${card.id}.`);
                 await handleExecuteCard(selectedSpaceId, card.id); // Await execution
                 console.log(`[DEBUG] Effect loop: Finished handleExecuteCard for card ${card.id}.`);
              } else {
                 console.log(`[DEBUG] Effect loop: Skipping execution for card ${card.id} because it's already loaded or loading.`);
              }
            }
            setHealthCheckLoading(false);
             console.log(`[DEBUG] Finished sequential refresh for space "${currentSpace.name}".`);
          }
          
          // Mark this space as loaded regardless
          setLoadedSpaces(prev => new Set(prev).add(selectedSpaceId));
        }
      } else if (activeView === 'spaces' && selectedSpaceId && loadedSpaces.has(selectedSpaceId)) {
        console.log(`[DEBUG] Space already loaded, skipping refresh.`);
      }
    };

    refreshCardsSequentially(); // Call the async function

    // Dependencies: Trigger only when view changes or selected space changes.
  }, [activeView, selectedSpaceId]); // Remove loadedSpaces from dependencies to avoid infinite loop


 // --- Render Logic ---
  const selectedSpace = spaces.find(s => s.id === selectedSpaceId);

  return (
    <div className="container-fluid vh-100 d-flex flex-column p-0">
      {/* Mobile Menu Toggle */}
      <button 
        className="mobile-menu-toggle"
        onClick={() => document.body.classList.toggle('menu-open')}
        aria-label="Toggle navigation menu"
      >
        <span className="hamburger"></span>
      </button>

      {/* Mobile Sidebar Overlay */}
      <div 
        className="mobile-sidebar-overlay"
        onClick={() => document.body.classList.remove('menu-open')}
      ></div>

      {/* Mobile Sidebar */}
      <div className="mobile-sidebar d-flex flex-column">
        <button 
          className="mobile-close-btn"
          onClick={() => document.body.classList.remove('menu-open')}
          aria-label="Close navigation menu"
        >
          ×
        </button>
        <SideNav
          activeView={activeView}
          spaces={spaces}
          selectedSpaceId={selectedSpaceId}
          handleSelectSpace={handleSelectSpace}
          handleCreateSpace={handleCreateSpace}
          handleReorderSpaces={handleReorderSpaces}
          getSpaceHealthStatus={getSpaceHealthStatus}
          getSpaceHealthColor={getSpaceHealthColor}
          performAllSpacesHealthCheck={performAllSpacesHealthCheck}
          onMoveCard={handleMoveCard}
        />
      </div>

      <Header />

      <div className="flex-grow-1 d-flex overflow-hidden"> {/* Main content area */}
        {/* Desktop Side Navigation */}
        <div className="desktop-sidebar col-auto bg-light border-end p-2 d-flex flex-column" style={{ width: '250px', height: '100%' }}>
          <SideNav
            activeView={activeView}
            spaces={spaces}
            selectedSpaceId={selectedSpaceId}
            handleSelectSpace={handleSelectSpace}
            handleCreateSpace={handleCreateSpace} // Pass create function
            handleReorderSpaces={handleReorderSpaces} // Pass reorder function
            getSpaceHealthStatus={getSpaceHealthStatus}
            getSpaceHealthColor={getSpaceHealthColor}
            performAllSpacesHealthCheck={performAllSpacesHealthCheck}
            onMoveCard={handleMoveCard} // Pass move card function
          />
        </div>

        {/* Main Panel (Inspector, Spaces, or Docs) - All views kept in DOM */}
        <div className="main-content col overflow-auto p-3 position-relative">
          
          {/* Documentation View */}
          <div className={`view-panel ${activeView === 'docs' ? '' : 'd-none'}`} style={{ height: '100%' }}>
            <div className={activeDocPage === 'what-is-mcp' ? '' : 'd-none'}>
              <WhatIsMcp />
            </div>
            <div className={activeDocPage === 'remote-vs-local' ? '' : 'd-none'}>
              <RemoteVsLocal />
            </div>
            <div className={activeDocPage === 'testing-guide' ? '' : 'd-none'}>
              <TestingGuide />
            </div>
            <div className={activeDocPage === 'troubleshooting' ? '' : 'd-none'}>
              <Troubleshooting />
            </div>
            <div className={activeDocPage === 'privacy-policy' ? '' : 'd-none'}>
              <PrivacyPolicy />
            </div>
            <div className={activeDocPage === 'terms-of-service' ? '' : 'd-none'}>
              <TermsOfService />
            </div>
            <div className={activeDocPage === 'contact' ? '' : 'd-none'}>
              <Contact />
            </div>
            {activeDocPage && !['what-is-mcp', 'remote-vs-local', 'testing-guide', 'troubleshooting', 'privacy-policy', 'terms-of-service', 'contact'].includes(activeDocPage) && (
              <div className="alert alert-warning">
                Documentation page not found. Please select a page from the navigation.
              </div>
            )}
          </div>

          {/* Inspector View */}
          <div className={`view-panel ${activeView === 'inspector' ? '' : 'd-none'}`} style={{ height: '100%' }}>
            <div className="h-100 d-flex flex-column">
              <div style={{ marginTop: '-0.75rem', marginBottom: '0.5rem' }}>
                <Tabs
                  tabs={tabs}
                  activeTabId={activeTabId}
                  onSelectTab={handleSelectTab}
                  onCloseTab={handleCloseTab}
                  onNewTab={handleNewTab}
                />
              </div>
              <div className="flex-grow-1 position-relative">
                {tabs.map(tab => (
                  <TabContent
                    key={tab.id}
                    tab={tab}
                    isActive={activeTabId === tab.id && activeView === 'inspector'}
                    onUpdateTab={handleUpdateTab}
                    spaces={spaces}
                    onAddCardToSpace={handleAddCardToSpace}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Spaces View */}
          <div className={`view-panel ${activeView === 'spaces' ? '' : 'd-none'}`} style={{ height: '100%' }}>
            {selectedSpace ? (
              <SpacesView
                space={selectedSpace}
                onUpdateSpace={handleUpdateSpace}
                onDeleteSpace={handleDeleteSpace}
                onUpdateCard={handleUpdateCard}
                onDeleteCard={handleDeleteCard}
                onExecuteCard={handleExecuteCard}
                onMoveCard={handleMoveCard}
                onAddCard={handleAddCardToSpace}
                onRefreshSpace={refreshCurrentSpace}
                isRefreshing={healthCheckLoading}
              />
            ) : (
              <div className="alert alert-warning">No space selected or available. Create one from the side menu.</div>
            )}
          </div>

          {/* Keep TabContent components alive even when not in inspector */}
          {activeView !== 'inspector' && (
            <div className="d-none">
              {tabs.map(tab => (
                <TabContent
                  key={tab.id}
                  tab={tab}
                  isActive={false}
                  onUpdateTab={handleUpdateTab}
                  spaces={spaces}
                  onAddCardToSpace={handleAddCardToSpace}
                />
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default App;