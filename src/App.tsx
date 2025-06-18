import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// Import Components
import Header from './components/Header';
import ConnectionPanel from './components/ConnectionPanel';
import { UnifiedPanel } from './components/UnifiedPanel';
import { RecentServersPanel } from './components/RecentServersPanel';
import ParamsPanel from './components/ParamsPanel';
import ResponsePanel from './components/ResponsePanel';
// Placeholders for new components
import SideNav from './components/SideNav'; // New
import SpacesView from './components/SpacesView'; // New
// Documentation components
import WhatIsMcp from './components/docs/WhatIsMcp';
import RemoteVsLocal from './components/docs/RemoteVsLocal';
import TestingGuide from './components/docs/TestingGuide';
import Troubleshooting from './components/docs/Troubleshooting';

// Import Hooks
import { useLogEntries } from './hooks/useLogEntries';
import { useConnection } from './hooks/useConnection';
import { useToolsAndResources } from './hooks/useToolsAndResources';
import { useResourceAccess } from './hooks/useResourceAccess';
// Import MCP SDK Components needed for stateless execution
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Import Types
import {
  Prompt, ResourceTemplate, SelectedPrompt, SelectedTool, Space, SpaceCard,
  AccessResourceResultSchema // Import the result schema
} from './types';

// Import Utils
import { parseUriTemplateArgs } from './utils/uriUtils';
import { generateSpaceSlug, findSpaceBySlug, getSpaceUrl, extractSlugFromPath } from './utils/urlUtils';

// Constants for localStorage keys
const TOOL_HISTORY_KEY = 'mcpToolCallHistory';
const RESOURCE_HISTORY_KEY = 'mcpResourceAccessHistory';
const SPACES_KEY = 'mcpSpaces'; // New key for spaces
const MAX_HISTORY_ITEMS = 10;

// Helper to load history/spaces from localStorage
const loadData = <T extends {}>(key: string, defaultValue: T): T => {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      let parsed = JSON.parse(stored);
      // Basic validation
      if (typeof parsed === typeof defaultValue && parsed !== null) {
        // Specifically for SPACES_KEY, strip transient fields from cards
        if (key === SPACES_KEY && Array.isArray(parsed)) {
          parsed = (parsed as Space[]).map(space => ({
            ...space,
            cards: space.cards.map(card => {
              // Omit transient fields when loading
              const { loading, error, responseData, responseType, ...restOfCard } = card;
              return restOfCard;
            })
          }));
        }
        return parsed as T;
      }
    }
  } catch (e) {
    console.error(`Failed to load or parse data from localStorage key "${key}":`, e);
  }
  return defaultValue;
};

// Helper to save history/spaces to localStorage
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
  // Track whether this is the first render
  const isFirstRender = useRef(true);
  const isUnmounting = useRef(false);

  // --- State ---
  const [activeView, setActiveView] = useState<'inspector' | 'spaces' | 'docs'>('inspector');
  const [activeDocPage, setActiveDocPage] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<Space[]>(() => loadData<Space[]>(SPACES_KEY, [{ id: 'default', name: 'Default Space', cards: [] }]));
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(spaces[0]?.id || 'default'); // Select first space initially

  // Router hooks
  const location = useLocation();
  const navigate = useNavigate();

  // State for call history
  const [toolCallHistory, setToolCallHistory] = useState<Record<string, any[]>>(() => loadData(TOOL_HISTORY_KEY, {}));
  const [resourceAccessHistory, setResourceAccessHistory] = useState<Record<string, any[]>>(() => loadData(RESOURCE_HISTORY_KEY, {}));



  // --- Custom Hooks ---
  const {
    responses,
    setResponses, // Get the setter function
    autoScroll,
    setAutoScroll,
    addLogEntry,
    handleClearResponse
  } = useLogEntries();

  const {
    serverUrl,
    setServerUrl,
    connectionStatus,
    isConnecting,
    client,
    recentServers,
    handleConnect,
    handleDisconnect,
    removeRecentServer
  } = useConnection(addLogEntry);

  const {
    tools,
    setTools,
    resources,
    setResources,
    selectedTool,
    setSelectedTool,
    selectedResourceTemplate,
    setSelectedResourceTemplate,
    prompts,
    setPrompts,
    selectedPrompt,
    setSelectedPrompt,
    toolParams,
    setToolParams,
    resourceArgs,
    setResourceArgs,
    promptParams,
    setPromptParams,
    handleListTools,
    handleListResources,
    handleListPrompts,
    handleExecuteTool,
    handleExecutePrompt,
    handleParamChange,
    handleResourceArgChange,
    handleSelectTool,
    handleSelectResourceTemplate,
    handleSelectPrompt
  } = useToolsAndResources(client, addLogEntry, connectionStatus, serverUrl); // Pass serverUrl

  const { handleAccessResource: accessResource } = useResourceAccess(client, addLogEntry, serverUrl); // Pass serverUrl

  // --- Effects ---

  // Save spaces whenever they change
  useEffect(() => {
    saveData(SPACES_KEY, spaces);
  }, [spaces]);

  // Handle URL routing
  useEffect(() => {
    const path = location.pathname;
    
    // Check for documentation routes
    if (path.startsWith('/docs/')) {
      const docPage = path.replace('/docs/', '');
      setActiveView('docs');
      setActiveDocPage(docPage);
      return;
    }
    
    const slug = extractSlugFromPath(path);
    
    if (slug) {
      // We're on a space URL like /space/space-title
      const space = findSpaceBySlug(spaces, slug);
      if (space) {
        setActiveView('spaces');
        setSelectedSpaceId(space.id);
        setActiveDocPage(null);
      } else {
        // Space not found, redirect to home
        navigate('/', { replace: true });
      }
    } else if (path === '/') {
      // We're on the home page
      setActiveView('inspector');
      setActiveDocPage(null);
    }
  }, [location.pathname, spaces, navigate]);

  // Wrapper function to handle resource access and save history
  const handleAccessResource = () => {
    if (!selectedResourceTemplate) return;
    const uri = selectedResourceTemplate.uriTemplate;
    accessResource(selectedResourceTemplate, resourceArgs);

    if (Object.keys(resourceArgs).length > 0) {
        setResourceAccessHistory(prevHistory => {
          const uriKey = uri as string ?? '';
          const currentList = prevHistory[uriKey] || [];
          if (JSON.stringify(currentList[0]) === JSON.stringify(resourceArgs)) {
            return prevHistory;
          }
          const updatedList = [resourceArgs, ...currentList].slice(0, MAX_HISTORY_ITEMS);
          const newHistory = { ...prevHistory, [uriKey]: updatedList };
          saveData(RESOURCE_HISTORY_KEY, newHistory);
          return newHistory;
        });
    } else {
        console.log("[DEBUG] Skipping resource history save: No arguments provided.");
    }
  };

  // Wrapper for handleParamChange to determine type
  const handleParamChangeWrapper = (paramName: string, value: any) => {
    if (selectedTool) {
      handleParamChange(paramName, value, 'tool');
    } else if (selectedPrompt) {
      handleParamChange(paramName, value, 'prompt');
    }
  };


  // Wrapper function to handle connect, accepting optional URL override
  const handleConnectWrapper = (urlToConnect?: string) => {
    handleConnect(
      setTools,
      setResources,
      setResponses, // Pass the actual setResponses setter function
      urlToConnect
    );
  };

  // Wrapper for handleExecuteTool to save history
  const handleExecuteToolWrapper = () => {
    if (!selectedTool || !client) return;
    const toolName = selectedTool.name;
    handleExecuteTool();

    if (Object.keys(toolParams).length > 0) {
        setToolCallHistory(prevHistory => {
          const toolNameKey = toolName as string ?? '';
          const currentList = prevHistory[toolNameKey] || [];
          if (JSON.stringify(currentList[0]) === JSON.stringify(toolParams)) {
            return prevHistory;
          }
          const updatedList = [toolParams, ...currentList].slice(0, MAX_HISTORY_ITEMS);
          const newHistory = { ...prevHistory, [toolNameKey]: updatedList };
          saveData(TOOL_HISTORY_KEY, newHistory);
          return newHistory;
        });
    } else {
        console.log("[DEBUG] Skipping tool history save: No parameters provided.");
    }
  };

  // Wrapper for handleExecutePrompt
  const handleExecutePromptWrapper = () => {
     if (!selectedPrompt || !client) return;
     handleExecutePrompt();
     // TODO: Add prompt history saving if required
  };

  // Wrapper for handleDisconnect to include state cleanup
  const handleDisconnectWrapper = async () => {
    await handleDisconnect();
    setTools([]);
    setResources([]);
    setPrompts([]);
    setSelectedTool(null);
    setSelectedResourceTemplate(null);
    setSelectedPrompt(null);
    setToolParams({});
    setResourceArgs({});
    setPromptParams({});
    console.log("[DEBUG] Cleared tools, resources, prompts, and params state after disconnect.");
  };


  // Effect for cleanup on unmount
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    return () => {
      isUnmounting.current = true;
      if (connectionStatus !== 'Disconnected') {
        console.log("Cleaning up connection on component unmount.");
        const isStrictModeCheck = document.visibilityState === 'visible' && document.hasFocus() && !window.isReloading;
        if (isStrictModeCheck) {
          console.log("Skipping disconnect - detected React strict mode check");
          addLogEntry({ type: 'info', data: 'Skipping disconnect during React strict mode check' });
        } else {
          addLogEntry({ type: 'info', data: 'Disconnecting on component unmount...' });
          handleDisconnect();
        }
      }
    };
  }, [connectionStatus, addLogEntry, handleDisconnect]);

  // Effect to automatically list items when connected
  useEffect(() => {
    if (connectionStatus === 'Connected') {
      console.log("[DEBUG] Connection established, automatically listing tools, resources, and prompts.");
      addLogEntry({ type: 'info', data: 'Connection established. Fetching lists...' });
      handleListTools();
      handleListResources();
      handleListPrompts();
    }
  }, [connectionStatus, handleListTools, handleListResources, handleListPrompts, addLogEntry]);


  // Determine button disabled states
  const isConnected = connectionStatus === 'Connected';
  const isDisconnected = connectionStatus === 'Disconnected';


  // Wrapper function for the refresh button
  const handleRefreshAllLists = () => {
    if (!isConnected) return;
    addLogEntry({ type: 'info', data: 'Refreshing all lists...' });
    handleListTools();
    handleListResources();
    handleListPrompts();
  };

  // --- Space Management Functions ---
  const handleCreateSpace = (name: string) => {
    const newSpace: Space = { id: Date.now().toString(), name, cards: [] };
    setSpaces(prev => [...prev, newSpace]);
    setSelectedSpaceId(newSpace.id); // Select the new space
    setActiveView('spaces'); // Switch to spaces view
    navigate(getSpaceUrl(newSpace.name)); // Navigate to new space URL
  };

  const handleSelectSpace = (id: string) => {
    const space = spaces.find(s => s.id === id);
    if (space) {
      setSelectedSpaceId(id);
      setActiveView('spaces'); // Ensure spaces view is active when selecting a space
      navigate(getSpaceUrl(space.name));
    }
  };

  const handleUpdateSpace = (id: string, updatedData: Partial<Omit<Space, 'id'>>) => {
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
        setActiveView('inspector');
        navigate('/');
      }
    }
  };

  const handleReorderSpaces = (reorderedSpaces: Space[]) => {
    setSpaces(reorderedSpaces);
  };

  // --- Space Health Check Functions ---
  const performAllSpacesHealthCheck = async () => {
    console.log('[Health Check] Starting health check for all spaces...');
    
    // Execute all cards in all spaces to refresh their status
    for (const space of spaces) {
      if (space.cards.length > 0) {
        console.log(`[Health Check] Checking ${space.cards.length} cards in space "${space.name}"`);
        // Execute all cards in this space (each card connects to its own server)
        await Promise.all(space.cards.map(card => {
          console.log(`[Health Check] Executing card "${card.title}" on server ${card.serverUrl}`);
          return handleExecuteCard(space.id, card.id);
        }));
      }
    }
    console.log('[Health Check] Completed health check for all spaces');
  };

  const getSpaceHealthColor = (spaceId: string): 'green' | 'orange' | 'red' | 'gray' => {
    const space = spaces.find(s => s.id === spaceId);
    if (!space || space.cards.length === 0) return 'gray';

    // Check if any cards are currently loading
    const hasLoadingCards = space.cards.some(card => card.loading);
    if (hasLoadingCards) return 'gray';

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

    const hasLoadingCards = space.cards.some(card => card.loading);
    const totalCount = space.cards.length;
    const successCount = space.cards.filter(card => 
      !card.error && card.responseData && !card.loading
    ).length;

    return {
      loading: hasLoadingCards,
      successCount,
      totalCount
    };
  };

  // Preload health checks on page load (cards connect to their own servers)
  useEffect(() => {
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
      console.log('[Health Check] No spaces with cards found, skipping auto health check');
    }
  }, []); // Run once on mount

  // --- Add to Space Functionality ---
  const handleAddCardToSpace = (spaceId: string, cardData: Omit<Space['cards'][0], 'id'>) => {
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
    setSpaces(prev => prev.map(space => {
      if (space.id === spaceId) {
        return { ...space, cards: space.cards.filter(card => card.id !== cardId) };
      }
      return space;
    }));
    console.log(`[DEBUG] Deleted card ${cardId} from space ${spaceId}`);
  };

  const handleMoveCard = (sourceSpaceId: string, targetSpaceId: string, cardId: string) => {
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
        const transport = new StreamableHTTPClientTransport(connectUrl);

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
          setSpaces(prev => updateCardState(prev, spaceId, cardId, { loading: false, error: err.message || err, responseData: null, responseType: 'error' }));
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
                     setSpaces(prev => updateCardState(prev, spaceId, cardId, { loading: false, error: `Failed to close temp client: ${closeError}` }));
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
      if (activeView === 'spaces' && selectedSpaceId) {
        const currentSpace = spaces.find(s => s.id === selectedSpaceId);
        if (currentSpace) {
          console.log(`[DEBUG] Entering space "${currentSpace.name}", refreshing ${currentSpace.cards.length} cards sequentially.`);
          // Use for...of loop to allow await inside
          for (const card of currentSpace.cards) {
            // Don't trigger if already loading to avoid redundant calls
            if (!card.loading) {
               console.log(`[DEBUG] Effect loop: Awaiting handleExecuteCard for card ${card.id}.`);
               await handleExecuteCard(selectedSpaceId, card.id); // Await execution
               console.log(`[DEBUG] Effect loop: Finished handleExecuteCard for card ${card.id}.`);
            } else {
               console.log(`[DEBUG] Effect loop: Skipping execution for card ${card.id} because loading is true.`);
            }
          }
           console.log(`[DEBUG] Finished sequential refresh for space "${currentSpace.name}".`);
        }
      }
    };

    refreshCardsSequentially(); // Call the async function

    // Dependencies: Trigger only when view changes or selected space changes.
  }, [activeView, selectedSpaceId]); // Keep dependencies minimal


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
      <div className="mobile-sidebar">
        <button 
          className="mobile-close-btn"
          onClick={() => document.body.classList.remove('menu-open')}
          aria-label="Close navigation menu"
        >
          ×
        </button>
        <SideNav
          activeView={activeView}
          setActiveView={setActiveView}
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
        <div className="desktop-sidebar col-auto bg-light border-end p-2" style={{ width: '250px', overflowY: 'auto' }}>
          <SideNav
            activeView={activeView}
            setActiveView={setActiveView}
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

        {/* Main Panel (Inspector, Spaces, or Docs) */}
        <div className="main-content col overflow-auto p-3">
          {activeView === 'docs' && (
            <>
              {activeDocPage === 'what-is-mcp' && <WhatIsMcp />}
              {activeDocPage === 'remote-vs-local' && <RemoteVsLocal />}
              {activeDocPage === 'testing-guide' && <TestingGuide />}
              {activeDocPage === 'troubleshooting' && <Troubleshooting />}
              {!['what-is-mcp', 'remote-vs-local', 'testing-guide', 'troubleshooting'].includes(activeDocPage || '') && (
                <div className="alert alert-warning">
                  Documentation page not found. Please select a page from the navigation.
                </div>
              )}
            </>
          )}
          {activeView === 'inspector' && (
            <div className="inspector-layout row">
              {/* Left Panel */}
              <div className={isConnected ? "col-md-4" : "col-12"}>
                <ConnectionPanel
                  serverUrl={serverUrl}
                  setServerUrl={setServerUrl}
                  connectionStatus={connectionStatus}
                  isConnecting={isConnecting}
                  isConnected={isConnected}
                  isDisconnected={isDisconnected}
                  handleConnect={handleConnectWrapper}
                  handleDisconnect={handleDisconnectWrapper}
                  recentServers={recentServers}
                />
                <RecentServersPanel
                   recentServers={recentServers}
                   setServerUrl={setServerUrl}
                   handleConnect={handleConnectWrapper}
                   removeRecentServer={removeRecentServer}
                   isConnected={isConnected}
                   isConnecting={isConnecting}
                />
                {isConnected && (
                  <UnifiedPanel
                    tools={tools}
                    resources={resources}
                    prompts={prompts}
                    selectedTool={selectedTool}
                    selectedResourceTemplate={selectedResourceTemplate}
                    selectedPrompt={selectedPrompt}
                    handleSelectTool={handleSelectTool}
                    handleSelectResourceTemplate={handleSelectResourceTemplate}
                    handleSelectPrompt={handleSelectPrompt}
                    connectionStatus={connectionStatus}
                    onRefreshLists={handleRefreshAllLists}
                    isConnecting={isConnecting}
                  />
                )}
              </div>

              {/* Right Panel - Stacked Parameters and Logs */}
              <div className="col-md-8">
                {isConnected && (
                  <>
                    {/* Parameters / Arguments Panel */}
                    <ParamsPanel
                      selectedTool={selectedTool}
                      selectedResourceTemplate={selectedResourceTemplate}
                      selectedPrompt={selectedPrompt}
                      toolParams={toolParams}
                      resourceArgs={resourceArgs}
                      promptParams={promptParams}
                      isConnected={isConnected}
                      isConnecting={isConnecting}
                      handleParamChange={handleParamChangeWrapper}
                      handleResourceArgChange={handleResourceArgChange}
                      handleExecuteTool={handleExecuteToolWrapper}
                      handleExecutePrompt={handleExecutePromptWrapper}
                      handleAccessResource={handleAccessResource}
                      parseUriTemplateArgs={parseUriTemplateArgs}
                      toolHistory={toolCallHistory[selectedTool?.name as string ?? ''] || []}
                      resourceHistory={resourceAccessHistory[selectedResourceTemplate?.uriTemplate as string ?? ''] || []}
                      setToolParams={setToolParams}
                      setResourceArgs={setResourceArgs}
                    />

                    {/* Logs & Events Panel */}
                    <ResponsePanel
                      responses={responses}
                      autoScroll={autoScroll}
                      setAutoScroll={setAutoScroll}
                      handleClearResponse={handleClearResponse}
                      isConnected={isConnected}
                      // Pass necessary props for "Add to Space"
                      spaces={spaces}
                      onAddCardToSpace={handleAddCardToSpace}
                      serverUrl={serverUrl} // Pass current server URL
                      selectedTool={selectedTool} // Pass selected tool
                      selectedResourceTemplate={selectedResourceTemplate} // Pass selected resource
                      toolParams={toolParams} // Pass current tool params
                      resourceArgs={resourceArgs} // Pass current resource args
                    />
                  </>
                )}
              </div>
            </div>
          )}

          {activeView === 'spaces' && selectedSpace && (
            <SpacesView
              space={selectedSpace}
              onUpdateSpace={handleUpdateSpace}
              onDeleteSpace={handleDeleteSpace}
              // Pass card handlers and execution function
              onUpdateCard={handleUpdateCard}
              onDeleteCard={handleDeleteCard}
              onExecuteCard={handleExecuteCard}
              onMoveCard={handleMoveCard} // Pass move card function
              onAddCard={handleAddCardToSpace} // Pass add card function
            />
          )}
           {activeView === 'spaces' && !selectedSpace && (
              <div className="alert alert-warning">No space selected or available. Create one from the side menu.</div>
           )}
        </div>
      </div>
    </div>
  );
}

export default App;