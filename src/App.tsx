import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// Import Analytics helpers
import { logPageView, logEvent } from './utils/analytics';

// Import Components
import Header from './components/Header';
import TabContent from './components/TabContent';
import NotificationPopup from './components/NotificationPopup';
// Placeholders for new components
import SideNav from './components/SideNav'; // New
import DashboardsView from './components/DashboardsView'; // New
import ReportView from './components/ReportView'; // New
import Tabs from './components/Tabs'; // New
// Documentation components
import WhatIsMcp from './components/docs/WhatIsMcp';
import RemoteVsLocal from './components/docs/RemoteVsLocal';
import TestingGuide from './components/docs/TestingGuide';
import Troubleshooting from './components/docs/Troubleshooting';
import PrivacyPolicy from './components/docs/PrivacyPolicy';
import TermsOfService from './components/docs/TermsOfService';
import Contact from './components/docs/Contact';
// OAuth callback component
import OAuthCallback from './components/OAuthCallback';
import OAuthConfig from './components/OAuthConfig';

// Import Data Sync Hook
import { useDataSync } from './hooks/useDataSync';
import { useMetaTags } from './hooks/useMetaTags';

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
import { CorsAwareSSETransport } from './utils/corsAwareSseTransport';
import { formatErrorForDisplay } from './utils/errorHandling';

// Constants for localStorage keys
const SPACES_KEY = 'mcpSpaces'; // New key for dashboards
const TABS_KEY = 'mcpConnectionTabs'; // New key for tabs

// Helper function to get the initial theme
const getInitialTheme = (): 'light' | 'dark' => {
  // 1. Check for a saved theme in localStorage
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light' || savedTheme === 'dark') {
    return savedTheme;
  }

  // 2. If no saved theme, check system preference
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  
  // 3. Default to light theme
  return 'light';
};

// Helper to determine initial view from URL
const getInitialView = (): 'playground' | 'dashboards' | 'docs' | 'report' => {
  const path = window.location.pathname;
  if (path.startsWith('/docs/')) {
    return 'docs';
  }
  if (path.startsWith('/space/')) {
    return 'dashboards';
  }
  if (path.startsWith('/report')) {
    return 'report';
  }
  return 'playground';
};

// Helper to load dashboards from localStorage
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

// Helper to save dashboards to localStorage
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
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);
  const [spaces, setSpaces] = useState<Space[]>(() => {
    const loaded = loadData<Space[]>(SPACES_KEY, [{ id: 'default', name: 'Default Dashboard', cards: [] }]);
    console.log('[DEBUG] Initial dashboards loaded from localStorage:', loaded.map(s => ({
      id: s.id,
      name: s.name,
      cardCount: s.cards.length
    })));
    return loaded;
  });
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(spaces[0]?.id || 'default'); // Select first dashboard initially
  const [healthCheckLoading, setHealthCheckLoading] = useState<boolean>(true);
  const [loadedSpaces, setLoadedSpaces] = useState<Set<string>>(new Set()); // Track which dashboards have been loaded
  const [notification, setNotification] = useState<{ message: string; show: boolean }>({ message: '', show: false });
  const [needsOAuthConfig, setNeedsOAuthConfig] = useState(false);
  const [oauthConfigServerUrl, setOAuthConfigServerUrl] = useState<string | null>(null);
  
  // Tab state
  const [tabs, setTabs] = useState<ConnectionTab[]>(() => {
    const savedTabs = localStorage.getItem(TABS_KEY);
    if (savedTabs) {
      const parsedTabs = JSON.parse(savedTabs);
      if (Array.isArray(parsedTabs) && parsedTabs.length > 0) {
        return parsedTabs;
      }
    }
    return [{ id: uuidv4(), title: 'New Connection', serverUrl: '', connectionStatus: 'Disconnected', useProxy: true }];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    // Ensure we always have a valid initial activeTabId
    if (tabs.length > 0) {
      return tabs[0].id;
    }
    // This should never happen, but just in case
    return '';
  });

  // Router hooks
  const location = useLocation();
  const navigate = useNavigate();
  
  // Activate the data sync hook
  useDataSync({ spaces, tabs, setSpaces, setTabs });
  
  // Add dynamic meta tags based on URL
  useMetaTags();
  
  // Derive active view and doc page from location
  const { activeView, activeDocPage } = useMemo(() => {
    const path = location.pathname;
    console.log('[ActiveView Calculation] Path:', path, 'Spaces count:', spaces.length);
    
    // Check for documentation routes
    if (path.startsWith('/docs/')) {
      const docPage = path.replace('/docs/', '');
      console.log('[ActiveView] Detected docs view');
      return { activeView: 'docs' as const, activeDocPage: docPage };
    }

    // Check for report routes
    if (path.startsWith('/report')) {
      console.log('[ActiveView] Detected report view');
      return { activeView: 'report' as const, activeDocPage: null };
    }
    
    // Check for dashboard routes
    const slug = extractSlugFromPath(path);
    if (slug) {
      const space = findSpaceBySlug(spaces, slug);
      console.log('[ActiveView] Checking slug:', slug, 'Found space:', !!space);
      if (space) {
        console.log('[ActiveView] Detected dashboards view for space:', space.name);
        return { activeView: 'dashboards' as const, activeDocPage: null };
      }
      // If we have a slug but no matching space yet (e.g., during OAuth callback when spaces aren't loaded),
      // still treat it as a dashboard view to prevent flashing
      if (spaces.length === 0 || sessionStorage.getItem('oauth_return_view')) {
        console.log('[ActiveView] Dashboard path detected, waiting for spaces to load');
        return { activeView: 'dashboards' as const, activeDocPage: null };
      }
    }
    
    // Default to inspector
    console.log('[ActiveView] Defaulting to playground view');
    return { activeView: 'playground' as const, activeDocPage: null };
  }, [location.pathname, spaces]);


  // --- Effects ---

  // Save dashboards whenever they change

  // Manage theme attribute and localStorage
  useEffect(() => {
    // Apply the theme to the root element and save the preference
    const root = window.document.documentElement;
    
    // Set the data-theme attribute based on the current theme
    root.setAttribute('data-theme', theme);

    // Save the current theme to localStorage
    localStorage.setItem('theme', theme);
    logEvent('theme_changed', { theme_name: theme });
  }, [theme]);

  // Save spaces whenever they change

  useEffect(() => {
    // Create a sanitized version of dashboards for persistence
    const spacesToSave = spaces.map(space => ({
      ...space,
      cards: space.cards.map(card => {
        // Omit transient fields before saving
        const { loading, error, responseData, responseType, ...restOfCard } = card;
        return restOfCard;
      })
    }));
    
    // Add logging to debug the issue
    console.log('[DEBUG] Saving dashboards to localStorage:', spacesToSave.map(s => ({
      id: s.id,
      name: s.name,
      cardCount: s.cards.length
    })));
    saveData(SPACES_KEY, spacesToSave);
  }, [spaces]);

  // Save tabs whenever they change
  useEffect(() => {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  }, [tabs]);

  // Ensure activeTabId is valid when tabs change
  useEffect(() => {
    // If current activeTabId is not in the tabs array, set it to the first tab
    if (tabs.length > 0 && !tabs.find(tab => tab.id === activeTabId)) {
      console.log(`[DEBUG] Active tab ID "${activeTabId}" not found in tabs, setting to first tab: ${tabs[0].id}`);
      setActiveTabId(tabs[0].id);
    }
  }, [tabs, activeTabId]);

  // Handle URL routing and page view tracking
  useEffect(() => {
    const path = location.pathname;
    let pageTitle = 'Playground'; // Default title

    // Check for OAuth callback route
    if (path === '/oauth/callback') {
      // OAuth callback is handled by the OAuthCallback component
      return;
    }

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
        pageTitle = `Dashboard: ${space.name}`;
        console.log('[Routing] Selected dashboard:', space.name, 'with id:', space.id);
      } else {
        // Don't immediately redirect if we just completed OAuth and might be waiting for spaces to load
        const justCompletedOAuth = sessionStorage.getItem('oauth_completed_time');
        const isRecentOAuth = justCompletedOAuth && (Date.now() - parseInt(justCompletedOAuth) < 5000); // 5 seconds
        
        if (!isRecentOAuth) {
          console.log('[Routing] Dashboard not found for slug:', slug, 'Available spaces:', spaces.map(s => ({ name: s.name, slug: generateSpaceSlug(s.name) })));
          navigate('/', { replace: true });
          pageTitle = 'Playground'; // Redirected
        } else {
          console.log('[Routing] Dashboard not found but OAuth just completed, waiting for spaces to load...');
          pageTitle = 'Loading...';
        }
      }
    } else if (path === '/') {
      pageTitle = 'Playground';
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
        useProxy: true,
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
        useProxy: true,
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
      useProxy: true,
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
        useProxy: true,
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

  // Handle OAuth callback state
  useEffect(() => {
    const state = location.state as any;
    
    // Prevent processing the same OAuth success multiple times
    if (state?.oauthSuccess) {
      const processedKey = 'oauth_success_processed';
      const alreadyProcessed = sessionStorage.getItem(processedKey) === 'true';
      
      if (alreadyProcessed) {
        // Already processed this OAuth success, clear the state and return
        navigate(location.pathname, { replace: true });
        return;
      }
      
      // Mark as processed immediately
      sessionStorage.setItem(processedKey, 'true');
      
      // Clear the flag after a short delay to allow for future OAuth flows
      setTimeout(() => {
        sessionStorage.removeItem(processedKey);
      }, 5000);
    }
    
    // Check for OAuth callback logs in sessionStorage
    const oauthLogsJson = sessionStorage.getItem('oauth_callback_logs');
    if (oauthLogsJson) {
      try {
        const oauthLogs = JSON.parse(oauthLogsJson);
        if (oauthLogs && oauthLogs.length > 0) {
          // Get the OAuth server URL and tab ID from sessionStorage
          const oauthServerUrl = sessionStorage.getItem('oauth_server_url');
          const oauthTabId = sessionStorage.getItem('oauth_tab_id');
          
          // Find the specific tab that initiated OAuth
          let oauthTab = null;
          if (oauthTabId) {
            oauthTab = tabs.find(tab => tab.id === oauthTabId);
          }
          // Fallback to finding by isAuthFlowActive if tab ID not found
          if (!oauthTab) {
            oauthTab = tabs.find(tab => tab.isAuthFlowActive);
          }
          
          if (oauthTab) {
            // Add the OAuth logs to the tab's log entries
            const logEntries = oauthLogs.map((log: any) => ({
              type: log.type,
              data: log.message,
              timestamp: new Date(log.timestamp).toLocaleTimeString()
            }));
            
            const updateData: any = { oauthCallbackLogs: logEntries };
            if (oauthServerUrl && oauthTab.serverUrl !== oauthServerUrl) {
              updateData.serverUrl = oauthServerUrl;
              console.log('[OAuth] Updating tab server URL from logs:', oauthServerUrl);
            }
            
            // Update the tab with the OAuth logs and possibly the server URL
            handleUpdateTab(oauthTab.id, updateData);
            
            // Make sure this tab is selected
            setActiveTabId(oauthTab.id);
          }
          
          // Clear the logs from sessionStorage
          sessionStorage.removeItem('oauth_callback_logs');
          sessionStorage.removeItem('oauth_tab_id');
        }
      } catch (e) {
        console.error('Failed to parse OAuth callback logs:', e);
      }
    }
    
    if (state?.oauthSuccess) {
      // OAuth was successful, trigger reconnection
      console.log('[OAuth] Authentication successful, triggering reconnection...');
      
      // If we're returning from OAuth with a specific space target, set it immediately
      if (state?.fromOAuthReturn && state?.targetSpaceId) {
        console.log('[OAuth] Setting selectedSpaceId from OAuth return:', state.targetSpaceId);
        setSelectedSpaceId(state.targetSpaceId);
      }
      
      // Clear the location state immediately to prevent re-triggering
      navigate(location.pathname, { replace: true });
      
      // Mark OAuth completion time to prevent health checks from interfering
      sessionStorage.setItem('oauth_completed_time', Date.now().toString());
      
      // Clear OAuth authentication state on tabs
      setTabs(prevTabs => prevTabs.map(tab => ({ ...tab, isAuthFlowActive: false })));
      
      // Restore tabs that were stored before OAuth redirect
      const storedTabsJson = sessionStorage.getItem('oauth_tabs_before_redirect');
      if (storedTabsJson) {
        try {
          const storedTabs = JSON.parse(storedTabsJson);
          console.log('[OAuth] Restoring tabs from before OAuth redirect:', storedTabs);
          setTabs(storedTabs);
          localStorage.setItem(TABS_KEY, storedTabsJson);
          sessionStorage.removeItem('oauth_tabs_before_redirect');
        } catch (e) {
          console.error('[OAuth] Failed to restore tabs:', e);
        }
      }
      
      // Get the OAuth server URL and tab ID from sessionStorage
      const oauthServerUrl = sessionStorage.getItem('oauth_server_url');
      const oauthTabId = sessionStorage.getItem('oauth_tab_id');
      
      // Find the specific tab that initiated OAuth
      let oauthTab = null;
      if (oauthTabId) {
        oauthTab = tabs.find(tab => tab.id === oauthTabId);
      }
      // Fallback to finding by isAuthFlowActive if tab ID not found
      if (!oauthTab) {
        oauthTab = tabs.find(tab => tab.isAuthFlowActive);
      }
      
      if (oauthTab) {
        console.log('[OAuth] Found OAuth tab, updating and reconnecting...');
        
        // Update the OAuth tab first
        if (oauthServerUrl && oauthTab.serverUrl !== oauthServerUrl) {
          console.log('[OAuth] Updating tab with OAuth server URL:', oauthServerUrl);
        }
        
        // Update the tab to use the correct OAuth server URL, clear auth flow state and trigger reconnection
        handleUpdateTab(oauthTab.id, { 
          serverUrl: oauthServerUrl || oauthTab.serverUrl,
          isAuthFlowActive: false,
          shouldReconnect: true 
        });
        
        // Make sure this tab is selected
        setActiveTabId(oauthTab.id);
      }
      
      // Reconnect all tabs that have the same OAuth server (they might have been disconnected during OAuth)
      if (oauthServerUrl) {
        const serverHost = new URL(oauthServerUrl).host;
        const tabsToReconnect = tabs.filter(tab => {
          if (!tab.serverUrl || tab.id === oauthTabId) return false;
          try {
            const tabHost = new URL(tab.serverUrl).host;
            // Reconnect any tab that's using the same OAuth server
            return tabHost === serverHost;
          } catch {
            return false;
          }
        });
        
        console.log(`[OAuth] Found ${tabsToReconnect.length} other tabs to reconnect for server ${serverHost}`);
        
        // Trigger reconnection for all tabs using the same server
        tabsToReconnect.forEach(tab => {
          console.log(`[OAuth] Triggering reconnection for tab ${tab.id} (${tab.title})`);
          handleUpdateTab(tab.id, { shouldReconnect: true });
        });
        
        // Clean up after using
        sessionStorage.removeItem('oauth_server_url');
        sessionStorage.removeItem('oauth_tab_id');
      }
      
      // Handle card refresh after OAuth completion
      const cardsToRefreshJson = sessionStorage.getItem('oauth_cards_to_refresh');
      if (cardsToRefreshJson) {
        try {
          const cardsToRefresh = JSON.parse(cardsToRefreshJson);
          console.log('[OAuth Card Refresh] Refreshing cards after OAuth completion:', cardsToRefresh);
          
          // Store cards to refresh in state to handle after component renders
          setSpaces(prev => {
            // Mark cards as needing refresh
            return prev.map(space => {
              if (cardsToRefresh.some((c: any) => c.spaceId === space.id)) {
                return {
                  ...space,
                  cards: space.cards.map(card => {
                    const needsRefresh = cardsToRefresh.some((c: any) => 
                      c.spaceId === space.id && c.cardId === card.id
                    );
                    if (needsRefresh) {
                      console.log(`[OAuth Card Refresh] Marking card ${card.id} for refresh`);
                      return { ...card, needsOAuthRefresh: true };
                    }
                    return card;
                  })
                };
              }
              return space;
            });
          });
          
          // Clear the refresh queue
          sessionStorage.removeItem('oauth_cards_to_refresh');
          
          // Show success message
          setNotification({ 
            message: 'OAuth authentication successful - refreshing cards', 
            show: true 
          });
          setTimeout(() => setNotification({ message: '', show: false }), 3000);
          
        } catch (error) {
          console.error('[OAuth Card Refresh] Failed to parse cards to refresh:', error);
          sessionStorage.removeItem('oauth_cards_to_refresh');
        }
      }
      
      // Restore the view state if we came from a dashboard
      const returnViewJson = sessionStorage.getItem('oauth_return_view');
      if (returnViewJson) {
        try {
          const returnView = JSON.parse(returnViewJson);
          console.log('[OAuth] Restoring view state:', returnView);
          
          if (returnView.activeView === 'dashboards' && returnView.selectedSpaceId) {
            // Check if we're already on the correct dashboard path (from OAuthCallback direct navigation)
            const currentSlug = extractSlugFromPath(location.pathname);
            const targetSpace = spaces.find(s => s.id === returnView.selectedSpaceId);
            
            if (targetSpace && currentSlug === generateSpaceSlug(targetSpace.name)) {
              // We're already on the correct path from OAuthCallback navigation
              console.log('[OAuth] Already on correct dashboard path, just setting state');
              setSelectedSpaceId(returnView.selectedSpaceId);
              sessionStorage.removeItem('oauth_return_view');
              return;
            }
            
            // Set the selected space ID
            setSelectedSpaceId(returnView.selectedSpaceId);
            
            // Ensure spaces are loaded before attempting to navigate
            if (spaces.length === 0) {
              console.log('[OAuth] Spaces not loaded yet, will restore view after loading');
              // Don't clear the return view yet - let the spaces loading effect handle it
            } else {
              // Find the dashboard and navigate to it
              if (targetSpace) {
                // Navigate to the dashboard URL which will automatically set the active view
                console.log('[OAuth] Found target space, navigating to dashboard:', targetSpace.name);
                
                // Use setTimeout to ensure navigation happens after state updates
                setTimeout(() => {
                  navigate(getSpaceUrl(targetSpace.name), { replace: true });
                  console.log('[OAuth] Navigation executed to:', getSpaceUrl(targetSpace.name));
                  
                  // Force a re-render by updating selectedSpaceId again after navigation
                  setTimeout(() => {
                    setSelectedSpaceId(targetSpace.id);
                  }, 50);
                }, 100);
                
                // Clear the stored view state
                sessionStorage.removeItem('oauth_return_view');
              } else {
                console.log('[OAuth] Target space not found:', returnView.selectedSpaceId);
                console.log('[OAuth] Available spaces:', spaces.map(s => ({ id: s.id, name: s.name })));
                // Clear invalid view state
                sessionStorage.removeItem('oauth_return_view');
              }
            }
            return; // Skip the default navigation below
          } else if (returnView.activeView === 'playground' && returnView.activeTabId) {
            // Return to playground view with the specific tab
            // Navigate to home which will set the active view to playground
            setActiveTabId(returnView.activeTabId);
            navigate('/', { replace: true });
            console.log('[OAuth] Navigated back to playground tab:', returnView.activeTabId);
            
            // Clear the stored view state
            sessionStorage.removeItem('oauth_return_view');
            return; // Skip the default navigation below
          }
        } catch (error) {
          console.error('[OAuth] Failed to restore view state:', error);
          sessionStorage.removeItem('oauth_return_view');
        }
      }
    } else if (state?.oauthError) {
      console.error('[OAuth] Authentication error:', state.oauthError);
      
      // Show error to user
      setNotification({
        message: state.oauthError,
        show: true
      });
      
      // Clear notification after 7 seconds for error messages
      setTimeout(() => {
        setNotification({ message: '', show: false });
      }, 7000);
      
      // Clear the location state
      navigate(location.pathname, { replace: true });
    }
  }, [location.state, navigate, tabs, handleUpdateTab, spaces, setSelectedSpaceId, setActiveTabId]);

  // Effect to handle deferred OAuth return navigation when spaces are loaded
  useEffect(() => {
    const returnViewJson = sessionStorage.getItem('oauth_return_view');
    if (returnViewJson && spaces.length > 0) {
      try {
        const returnView = JSON.parse(returnViewJson);
        
        // Check if we're already on the correct path (direct navigation from OAuth callback)
        const currentSlug = extractSlugFromPath(location.pathname);
        const targetSpace = spaces.find(s => s.id === returnView.selectedSpaceId);
        
        if (targetSpace && currentSlug === generateSpaceSlug(targetSpace.name)) {
          console.log('[OAuth Deferred] Already navigated to correct dashboard, clearing return view');
          sessionStorage.removeItem('oauth_return_view');
          // Ensure the selectedSpaceId is set correctly
          if (selectedSpaceId !== targetSpace.id) {
            setSelectedSpaceId(targetSpace.id);
          }
          return;
        }
        
        if (returnView.activeView === 'dashboards' && returnView.selectedSpaceId) {
          if (targetSpace) {
            console.log('[OAuth Deferred] Found target space after loading, navigating to dashboard:', targetSpace.name);
            
            // Use setTimeout to ensure navigation happens after all state updates
            setTimeout(() => {
              navigate(getSpaceUrl(targetSpace.name), { replace: true });
              console.log('[OAuth Deferred] Navigation executed to:', getSpaceUrl(targetSpace.name));
              
              // Force a re-render by updating selectedSpaceId again after navigation
              setTimeout(() => {
                setSelectedSpaceId(targetSpace.id);
              }, 50);
              
              // Clear the stored view state after navigation
              sessionStorage.removeItem('oauth_return_view');
            }, 200);
          } else {
            console.log('[OAuth Deferred] Target space still not found after loading:', returnView.selectedSpaceId);
            console.log('[OAuth Deferred] Available spaces:', spaces.map(s => ({ id: s.id, name: s.name })));
            sessionStorage.removeItem('oauth_return_view');
          }
        }
      } catch (error) {
        console.error('[OAuth] Failed to process deferred navigation:', error);
        sessionStorage.removeItem('oauth_return_view');
      }
    }
  }, [spaces, navigate, location.pathname, selectedSpaceId]);

  // --- Dashboard Management Functions ---
  const handleCreateDashboard = (name: string) => {
    logEvent('create_dashboard');
    const newDashboard: Space = { id: Date.now().toString(), name, cards: [] };
    setSpaces(prev => [...prev, newDashboard]);
    setSelectedSpaceId(newDashboard.id); // Select the new dashboard
    navigate(getSpaceUrl(newDashboard.name)); // Navigate to new dashboard URL
  };
              
  // --- Handlers ---
  const toggleTheme = useCallback(() => {
    setTheme(prevTheme => (prevTheme === 'light' ? 'dark' : 'light'));
  }, []);

  // --- Dashboard Management Functions ---
  const handleCreateSpace = (name: string) => {
    logEvent('create_space');
    const newSpace: Space = { id: Date.now().toString(), name, cards: [] };
    setSpaces(prev => [...prev, newSpace]);
    setSelectedSpaceId(newSpace.id); // Select the new space
    navigate(getSpaceUrl(newSpace.name)); // Navigate to new space URL
  };

  const handleSelectDashboard = (id: string) => {
    const space = spaces.find(s => s.id === id);
    if (space) {
      logEvent('select_dashboard');
      setSelectedSpaceId(id);
      navigate(getSpaceUrl(space.name));
    }
  };

  const handleUpdateDashboard = (id: string, updatedData: Partial<Omit<Space, 'id'>>) => {
    logEvent('update_dashboard', { updated_keys: Object.keys(updatedData).join(',') });
    setSpaces(prev => prev.map(space => {
      if (space.id === id) {
        const updatedSpace = { ...space, ...updatedData };
        // If we're updating the currently selected dashboard and the name changed, update URL
        if (selectedSpaceId === id && updatedData.name && updatedData.name !== space.name) {
          navigate(getSpaceUrl(updatedData.name), { replace: true });
        }
        return updatedSpace;
      }
      return space;
    }));
  };

  const handleDeleteDashboard = (id: string) => {
    logEvent('delete_dashboard');
    const deletedSpace = spaces.find(s => s.id === id);
    setSpaces(prev => prev.filter(space => space.id !== id));
    
    // If the deleted dashboard was selected, handle navigation
    if (selectedSpaceId === id) {
      const remainingSpaces = spaces.filter(s => s.id !== id);
      if (remainingSpaces.length > 0) {
        // Select the first remaining dashboard
        const firstSpace = remainingSpaces[0];
        setSelectedSpaceId(firstSpace.id);
        navigate(getSpaceUrl(firstSpace.name));
      } else {
        // No dashboards left, go to playground
        navigate('/');
      }
    }
  };

  const handleReorderDashboards = (reorderedDashboards: Space[]) => {
    logEvent('reorder_dashboards');
    setSpaces(reorderedSpaces);
  };

  // --- Dashboard Health Check Functions ---
  const performAllDashboardsHealthCheck = async () => {
    logEvent('health_check_all_dashboards', { dashboard_count: spaces.length });
    console.log('[Health Check] Starting health check for all dashboards...');
    setHealthCheckLoading(true);
    
    // Don't clear loaded dashboards - we want to track which dashboards have been navigated to
    // This health check is for updating status, not for initial loading
    
    // Execute all cards in all dashboards to refresh their status
    for (const space of spaces) {
      if (space.cards.length > 0) {
        console.log(`[Health Check] Checking ${space.cards.length} cards in space "${space.name}"`);
        // Execute all cards in this dashboard (each card connects to its own server)
        await Promise.all(space.cards.map(card => {
          console.log(`[Health Check] Executing card "${card.title}" on server ${card.serverUrl}`);
          return handleExecuteCard(space.id, card.id);
        }));
        
        // Mark dashboards as loaded after health check
        setLoadedSpaces(prev => new Set(prev).add(space.id));
      }
    }
    console.log('[Health Check] Completed health check for all dashboards');
    setHealthCheckLoading(false);
  };
  
  const refreshCurrentDashboard = async () => {
    if (activeView === 'dashboards' && selectedSpaceId) {
      const currentSpace = spaces.find(s => s.id === selectedSpaceId);
      if (currentSpace && currentSpace.cards.length > 0) {
        logEvent('refresh_current_dashboard', { dashboard_id: selectedSpaceId });
        console.log(`[Refresh] Manually refreshing space "${currentSpace.name}"`);
        setHealthCheckLoading(true);
        
        // Remove from loaded dashboards to force refresh
        setLoadedSpaces(prev => {
          const newSet = new Set(prev);
          newSet.delete(selectedSpaceId);
          return newSet;
        });
        
        // Refresh all cards in the dashboard
        for (const card of currentSpace.cards) {
          if (!card.loading) {
            await handleExecuteCard(selectedSpaceId, card.id);
          }
        }
        
        // Re-add to loaded dashboards
        setLoadedSpaces(prev => new Set(prev).add(selectedSpaceId));
        setHealthCheckLoading(false);
      }
    }
  };

  const getDashboardHealthColor = (spaceId: string): 'green' | 'orange' | 'red' | 'gray' => {
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

  const getDashboardHealthStatus = (spaceId: string) => {
    const space = spaces.find(s => s.id === spaceId);
    if (!space) return { loading: false, successCount: 0, totalCount: 0 };

    const totalCount = space.cards.length;
    const loadingCount = space.cards.filter(card => card.loading).length;
    const successCount = space.cards.filter(card => 
      !card.error && card.responseData && !card.loading
    ).length;

    // Dashboard is loading if any of its cards are loading
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
    const isOAuthCallback = path === '/oauth/callback';
    
    // Check if we just completed OAuth (to prevent health check from interfering)
    const oauthCompletedTime = sessionStorage.getItem('oauth_completed_time');
    const recentOAuthCompletion = oauthCompletedTime && (Date.now() - parseInt(oauthCompletedTime) < 30000); // 30 seconds
    
    if (isResultShareUrl || isServerUrl || isOAuthCallback || recentOAuthCompletion) {
      console.log('[Health Check] Skipping auto health check due to:', {
        deepLinkUrl: isResultShareUrl || isServerUrl,
        oauthCallback: isOAuthCallback,
        recentOAuth: recentOAuthCompletion
      });
      setHealthCheckLoading(false);
      return;
    }
    
    const dashboardsWithCards = spaces.filter(space => space.cards.length > 0);
    console.log('[Health Check] Page loaded, checking for dashboards with cards...', {
      totalDashboards: spaces.length,
      dashboardsWithCards: dashboardsWithCards.length,
      totalCards: spaces.reduce((sum, space) => sum + space.cards.length, 0)
    });
    
    // Run health checks if we have any dashboards with cards
    if (dashboardsWithCards.length > 0) {
      console.log('[Health Check] Found dashboards with cards, starting auto health check...');
      // Add a small delay to ensure component is fully mounted
      setTimeout(() => {
        performAllDashboardsHealthCheck().then(() => {
          console.log('[Health Check] Auto-preload completed successfully');
        }).catch((error) => {
          console.error('[Health Check] Auto-preload failed:', error);
        });
      }, 2000); // 2 second delay to ensure everything is ready
    } else {
      setHealthCheckLoading(false);
      console.log('[Health Check] No dashboards with cards found, skipping auto health check');
    }
  }, []); // Run once on mount

  // --- Add to Dashboard Functionality ---
  const handleAddCardToDashboard = (spaceId: string, cardData: Omit<Space['cards'][0], 'id'>) => {
      logEvent('add_card_to_dashboard', { 
          card_type: cardData.type
      });
      const newCard = { ...cardData, id: Date.now().toString() };
      setSpaces(prev => prev.map(space => {
          if (space.id === spaceId) {
              return { ...space, cards: [...space.cards, newCard] };
          }
          return space;
      }));
      setNotification({ message: 'Added to dashboard', show: true });
      setTimeout(() => setNotification({ message: '', show: false }), 3000);
      console.log(`[DEBUG] Added card to space ${spaceId}:`, newCard);
  };

  const handleAddCardToSpace = (spaceId: string, cardData: Omit<SpaceCard, 'id'>) => {
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
      setNotification({ message: 'Added to dashboard', show: true });
      setTimeout(() => setNotification({ message: '', show: false }), 3000);
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
      
      // Remove card from source dashboard and add to target dashboard
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
    let shouldUseProxy = false; // Move this outside try block to make it accessible in catch block

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[Execute Card ${cardId} Attempt ${attempt}/${MAX_RETRIES}] Starting execution. Card URL: ${card.serverUrl}`);
        lastError = null; // Clear last error on new attempt

        // --- Connection and Request Logic ---
        let connectUrl: URL;
        let serverUrl = card.serverUrl;
        
        // Check for OAuth token first - use the original card.serverUrl for OAuth token lookup
        const originalServerHost = new URL(card.serverUrl).host;
        const oauthToken = sessionStorage.getItem(`oauth_access_token_${originalServerHost}`);
        const transportOptions: any = {};
        
        if (oauthToken) {
          console.log(`[Execute Card ${cardId}] Using OAuth token for authentication`);
          // Use consistent Bearer token format for all services
          transportOptions.headers = {
            'Authorization': `Bearer ${oauthToken}`
          };
        }
        
        // Determine if proxy should be used
        shouldUseProxy = false; // Reset for each attempt
        
        // If card.useProxy is explicitly set, respect that
        if (card.useProxy !== undefined) {
          shouldUseProxy = card.useProxy;
        } else if (!oauthToken && import.meta.env.VITE_PROXY_URL) {
          // If no OAuth token and proxy is available, use proxy by default
          shouldUseProxy = true;
        }
        
        // Apply proxy to the server URL if needed
        if (shouldUseProxy && import.meta.env.VITE_PROXY_URL) {
          const proxyUrl = import.meta.env.VITE_PROXY_URL;
          serverUrl = `${proxyUrl}?target=${encodeURIComponent(card.serverUrl)}`;
          console.log(`[Execute Card ${cardId}] Using proxy: ${proxyUrl}`);
        }
        
        try {
            connectUrl = new URL(serverUrl);
            // Don't append /mcp if the URL already ends with /sse or /mcp
            if (!connectUrl.pathname.endsWith('/mcp') && !connectUrl.pathname.endsWith('/sse')) {
                connectUrl.pathname = (connectUrl.pathname.endsWith('/') ? connectUrl.pathname : connectUrl.pathname + '/') + 'mcp';
            }
        } catch (e) {
            throw new Error(`Invalid Server URL format in card: ${card.serverUrl}`);
        }

        tempClient = new Client({ name: `mcp-card-executor-${cardId}-${attempt}`, version: "1.0.0" });
        
        // Use SSE transport for SSE endpoints, HTTP transport for others
        let transport;
        if (connectUrl.pathname.endsWith('/sse')) {
          console.log(`[Execute Card ${cardId} Attempt ${attempt}] Using SSE transport for ${connectUrl.toString()}`);
          transport = new CorsAwareSSETransport(connectUrl, transportOptions);
        } else {
          console.log(`[Execute Card ${cardId} Attempt ${attempt}] Using HTTP transport for ${connectUrl.toString()}`);
          transport = new CorsAwareStreamableHTTPTransport(connectUrl, transportOptions);
        }

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

        // --- Check for different error types ---
        const isConflict = err.message?.includes('Conflict') || err.message?.includes('409') || err.status === 409;
        const is401Error = err.message && (
          err.message.includes('401') || 
          err.message.toLowerCase().includes('unauthorized') ||
          err.message.includes('invalid_token') ||
          err.message.includes('Missing or invalid access token') ||
          err.statusCode === 401 ||
          err.status === 401
        );

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
          
          // Mark error with auth information for UI handling
          const errorWithAuthInfo = {
            ...errorDetails,
            isAuthError: is401Error,
            serverUrl: card.serverUrl,
            isProxied: shouldUseProxy
          };
          
          setSpaces(prev => updateCardState(prev, spaceId, cardId, { loading: false, error: errorWithAuthInfo, responseData: null, responseType: 'error' }));
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

  // --- OAuth Re-authorization Function ---
  const handleReauthorizeCard = async (spaceId: string, cardId: string, serverUrl: string) => {
    console.log(`[Reauthorize] Starting OAuth reauth for card ${cardId} on ${serverUrl}`);
    
    // Clear the existing invalid token for this server
    if (!serverUrl) {
      console.error('[Reauthorize] No serverUrl provided');
      return;
    }
    const serverHost = new URL(serverUrl).host;
    sessionStorage.removeItem(`oauth_access_token_${serverHost}`);
    sessionStorage.removeItem(`oauth_refresh_token_${serverHost}`);
    
    // Store the server URL for OAuth callback
    sessionStorage.setItem('oauth_server_url', serverUrl);
    
    // Store cards to refresh after OAuth
    const cardsToRefresh = JSON.stringify([{ spaceId, cardId }]);
    sessionStorage.setItem('oauth_cards_to_refresh', cardsToRefresh);
    
    // Store all active tabs before OAuth redirect so we can restore them
    const activeTabs = localStorage.getItem(TABS_KEY);
    if (activeTabs) {
      sessionStorage.setItem('oauth_tabs_before_redirect', activeTabs);
      console.log('[OAuth] Stored active tabs before redirect for card reauth');
    }
    
    // Store the current view state to restore after OAuth
    const currentSpace = spaces.find(s => s.id === spaceId);
    sessionStorage.setItem('oauth_return_view', JSON.stringify({
      activeView: 'dashboards', // Dashboard view
      selectedSpaceId: spaceId,
      selectedSpaceName: currentSpace?.name || '',
      timestamp: Date.now()
    }));
    console.log('[OAuth] Stored return view state for dashboard:', spaceId, currentSpace?.name);
    
    // Start OAuth flow - similar to connection logic
    try {
      const { getOAuthConfig } = await import('./utils/oauthDiscovery');
      const oauthConfig = await getOAuthConfig(serverUrl);
      
      if (oauthConfig) {
        // Set up OAuth flow
        const { generatePKCE } = await import('./utils/pkce');
        const { code_verifier: codeVerifier, code_challenge: codeChallenge } = await generatePKCE();
        
        sessionStorage.setItem('pkce_code_verifier', codeVerifier);
        sessionStorage.setItem(`oauth_endpoints_${serverHost}`, JSON.stringify(oauthConfig));
        
        // First check for server-specific stored client registration
        let clientId: string | null = null;
        let clientSecret: string | null = null;
        
        const serverClientKey = `oauth_client_${serverHost}`;
        const storedServerClient = sessionStorage.getItem(serverClientKey);
        if (storedServerClient) {
          try {
            const clientData = JSON.parse(storedServerClient);
            clientId = clientData.clientId;
            clientSecret = clientData.clientSecret;
            console.log('[Reauthorize] Using stored server-specific client registration:', clientId);
          } catch (e) {
            console.error('[Reauthorize] Failed to parse stored client data:', e);
          }
        }
        
        // If no server-specific client found, attempt dynamic registration
        if (!clientId && oauthConfig.registrationEndpoint) {
          console.log('[Reauthorize] Attempting dynamic client registration...');
          
          try {
            const { getOrRegisterOAuthClient } = await import('./utils/oauthDiscovery');
            const clientRegistration = await getOrRegisterOAuthClient(serverUrl, oauthConfig.registrationEndpoint);
            
            if (clientRegistration) {
              clientId = clientRegistration.clientId;
              clientSecret = clientRegistration.clientSecret || null;
              console.log('[Reauthorize] Dynamic client registration successful:', clientId);
              
              // Note: The client registration is already stored by getOrRegisterOAuthClient
              // with the server-specific key, so we don't need to store it again
            }
          } catch (error) {
            console.error('[Reauthorize] Dynamic client registration failed:', error);
          }
        }
        
        // If still no client ID, show config modal
        if (!clientId) {
          // Store the server URL and space/card info to continue after OAuth config
          sessionStorage.setItem('oauth_pending_reauth', JSON.stringify({
            spaceId,
            cardId,
            serverUrl
          }));
          
          // Show OAuth configuration modal
          setNeedsOAuthConfig(true);
          setOAuthConfigServerUrl(serverUrl);
          console.log('[Reauthorize] No OAuth client configured and dynamic registration unavailable, showing config modal');
          return;
        }
        
        // Build authorization URL
        if (!oauthConfig.authorizationEndpoint) {
          throw new Error('OAuth authorization endpoint is missing');
        }
        
        let authUrl: URL;
        try {
          authUrl = new URL(oauthConfig.authorizationEndpoint);
        } catch (error) {
          throw new Error(`Invalid OAuth authorization endpoint URL: ${oauthConfig.authorizationEndpoint}`);
        }
        
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', `${window.location.origin}/oauth/callback`);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        // Use the scope from OAuth configuration, or default to 'read write' for backward compatibility
        const scope = oauthConfig.scope || 'read write';
        
        authUrl.searchParams.set('scope', scope);
        
        console.log(`[Reauthorize] Redirecting to OAuth authorization URL: ${authUrl.toString()}`);
        
        window.location.href = authUrl.toString();
      } else {
        throw new Error('OAuth configuration not available for this server');
      }
    } catch (error) {
      console.error('[Reauthorize] Failed to start OAuth flow:', error);
      setNotification({ 
        message: `Failed to start OAuth reauthorization: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        show: true 
      });
      setTimeout(() => setNotification({ message: '', show: false }), 5000);
    }
  };

  // Effect to handle OAuth refresh cards
  useEffect(() => {
    const refreshOAuthCards = async () => {
      // Add a delay to ensure OAuth tokens are properly stored in sessionStorage
      await new Promise(resolve => setTimeout(resolve, 500));
      
      for (const space of spaces) {
        const cardsNeedingRefresh = space.cards.filter(card => (card as any).needsOAuthRefresh);
        if (cardsNeedingRefresh.length > 0) {
          console.log(`[OAuth Refresh Effect] Found ${cardsNeedingRefresh.length} cards needing OAuth refresh in space ${space.id}`);
          
          // Log OAuth token status for debugging
          for (const card of cardsNeedingRefresh) {
            const serverHost = new URL(card.serverUrl).host;
            const hasToken = !!sessionStorage.getItem(`oauth_access_token_${serverHost}`);
            console.log(`[OAuth Refresh Effect] Card ${card.id} - Server: ${serverHost}, Has OAuth token: ${hasToken}`);
          }
          
          for (const card of cardsNeedingRefresh) {
            console.log(`[OAuth Refresh Effect] Executing card ${card.id}`);
            await handleExecuteCard(space.id, card.id);
            // Remove the needsOAuthRefresh flag after execution
            setSpaces(prev => prev.map(s => {
              if (s.id === space.id) {
                return {
                  ...s,
                  cards: s.cards.map(c => {
                    if (c.id === card.id) {
                      const { needsOAuthRefresh, ...rest } = c as any;
                      return rest;
                    }
                    return c;
                  })
                };
              }
              return s;
            }));
          }
        }
      }
    };
    
    refreshOAuthCards();
  }, [spaces.filter(s => s.cards.some((c: any) => c.needsOAuthRefresh)).length]); // Only run when cards need OAuth refresh

  // --- Effect to Auto-Refresh Cards on Dashboard Entry (Sequentially with Retries) ---
  useEffect(() => {
    const refreshCardsSequentially = async () => {
      // Only refresh if we're viewing dashboards AND this specific dashboard hasn't been loaded yet in this session
      if (activeView === 'dashboards' && selectedSpaceId && !loadedSpaces.has(selectedSpaceId)) {
        const currentSpace = spaces.find(s => s.id === selectedSpaceId);
        if (currentSpace && currentSpace.cards.length > 0) {
          // Always refresh all cards when entering a dashboard for the first time in this session
          // This ensures OAuth tokens are validated even for cards with saved responseData
          console.log(`[DEBUG] First time entering space "${currentSpace.name}" in this session, refreshing ${currentSpace.cards.length} cards sequentially.`);
          setHealthCheckLoading(true);
          
          // Use for...of loop to allow await inside
          for (const card of currentSpace.cards) {
            // Execute all cards that aren't currently loading
            if (!card.loading) {
               console.log(`[DEBUG] Effect loop: Awaiting handleExecuteCard for card ${card.id}.`);
               await handleExecuteCard(selectedSpaceId, card.id); // Await execution
               console.log(`[DEBUG] Effect loop: Finished handleExecuteCard for card ${card.id}.`);
            } else {
               console.log(`[DEBUG] Effect loop: Skipping execution for card ${card.id} because it's already loading.`);
            }
          }
          setHealthCheckLoading(false);
          console.log(`[DEBUG] Finished sequential refresh for dashboard "${currentSpace.name}".`)
          
          // Mark this dashboard as loaded regardless
          setLoadedSpaces(prev => new Set(prev).add(selectedSpaceId));
        }
      } else if (activeView === 'dashboards' && selectedSpaceId && loadedSpaces.has(selectedSpaceId)) {
        console.log(`[DEBUG] Dashboard already loaded, skipping refresh.`);
      }
    };

    refreshCardsSequentially(); // Call the async function

    // Dependencies: Trigger only when view changes or selected space changes.
  }, [activeView, selectedSpaceId]); // Remove loadedSpaces from dependencies to avoid infinite loop


 // --- Render Logic ---
  const selectedSpace = spaces.find(s => s.id === selectedSpaceId);

  // Check if we're on the OAuth callback page
  if (location.pathname === '/oauth/callback') {
    return <OAuthCallback />;
  }

  // Handle OAuth provider's install-integration redirect
  // Some OAuth providers (like Notion) redirect to this path as part of their flow
  if (location.pathname === '/install-integration') {
    // Check if this is part of an OAuth flow by looking for OAuth parameters
    const params = new URLSearchParams(location.search);
    const responseType = params.get('response_type');
    const code = params.get('code');
    
    if (code) {
      // If we have a code parameter, treat this as an OAuth callback
      console.log('[OAuth] Detected authorization code in install-integration URL, redirecting to callback handler...');
      navigate('/oauth/callback' + location.search, { replace: true });
      return (
        <div className="container-fluid vh-100 d-flex align-items-center justify-content-center">
          <div className="text-center">
            <div className="spinner-border text-primary mb-3" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <h4>Completing authentication...</h4>
          </div>
        </div>
      );
    } else if (responseType === 'code') {
      // This is an OAuth authorization request, not a callback
      // The OAuth provider is trying to initiate its own flow
      console.log('[OAuth] OAuth provider attempting to initiate authorization at install-integration');
      // Redirect to home to prevent the OAuth loop
      navigate('/', { replace: true });
      return (
        <div className="container-fluid vh-100 d-flex align-items-center justify-content-center">
          <div className="text-center">
            <h4>OAuth configuration in progress...</h4>
            <p>Redirecting to home...</p>
          </div>
        </div>
      );
    }
    
    // Unknown install-integration request, redirect to home
    console.log('[OAuth] Unknown install-integration request, redirecting to home...');
    navigate('/', { replace: true });
    return null;
  }

  return (
    <div className="container-fluid vh-100 d-flex flex-column p-0">

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
          handleSelectSpace={handleSelectDashboard}
          handleCreateSpace={handleCreateDashboard}
          handleReorderDashboards={handleReorderDashboards}
          getSpaceHealthStatus={getDashboardHealthStatus}
          getSpaceHealthColor={getDashboardHealthColor}
          performAllDashboardsHealthCheck={performAllDashboardsHealthCheck}
          onMoveCard={handleMoveCard}
          theme={theme}
          onToggleTheme={toggleTheme}
          isMobile={true}
        />
      </div>

      {/* UPDATE Header props */}
      <Header theme={theme} onToggleTheme={toggleTheme} />

      <main className="flex-grow-1 d-flex overflow-hidden" role="main"> {/* Main content area */}
        {/* Desktop Side Navigation */}
        <div className="desktop-sidebar col-auto bg-light border-end p-2 d-flex flex-column" style={{ width: '250px', height: '100%' }}>
          <SideNav
            activeView={activeView}
            spaces={spaces}
            selectedSpaceId={selectedSpaceId}
            handleSelectSpace={handleSelectDashboard}
            handleCreateSpace={handleCreateDashboard} // Pass create function
            handleReorderDashboards={handleReorderDashboards} // Pass reorder function
            getSpaceHealthStatus={getDashboardHealthStatus}
            getSpaceHealthColor={getDashboardHealthColor}
            performAllDashboardsHealthCheck={performAllDashboardsHealthCheck}
            onMoveCard={handleMoveCard} // Pass move card function
          />
        </div>

        {/* Main Panel (Playground, Dashboards, or Docs) - All views kept in DOM */}
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

          {/* Report View */}
          <div className={`view-panel ${activeView === 'report' ? '' : 'd-none'}`} style={{ height: '100%' }}>
            <ReportView />
          </div>

          {/* Playground View */}
          <div className={`view-panel ${activeView === 'playground' ? '' : 'd-none'}`} style={{ height: '100%' }}>
            <div className="h-100 d-flex flex-column">
              <div style={{ marginTop: '0', marginBottom: '0' }}>
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
                    isActive={activeTabId === tab.id && activeView === 'playground'}
                    onUpdateTab={handleUpdateTab}
                    spaces={spaces}
                    onAddCardToSpace={handleAddCardToDashboard}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Dashboards View */}
          <div className={`view-panel ${activeView === 'dashboards' ? '' : 'd-none'}`} style={{ height: '100%' }}>
            {selectedSpace ? (
              <DashboardsView
                space={selectedSpace}
                onUpdateSpace={handleUpdateDashboard}
                onDeleteSpace={handleDeleteDashboard}
                onUpdateCard={handleUpdateCard}
                onDeleteCard={handleDeleteCard}
                onExecuteCard={handleExecuteCard}
                onMoveCard={handleMoveCard}
                onAddCard={handleAddCardToSpace}
                onRefreshSpace={refreshCurrentDashboard}
                isRefreshing={healthCheckLoading}
                onReauthorizeCard={handleReauthorizeCard}
              />
            ) : (
              <div className="alert alert-warning">No dashboard selected or available. Create one from the side menu.</div>
            )}
          </div>

          {/* Keep TabContent components alive even when not in playground */}
          {activeView !== 'playground' && (
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
      </main>
      <NotificationPopup message={notification.message} show={notification.show} />
      
      {/* OAuth Configuration Modal */}
      {needsOAuthConfig && oauthConfigServerUrl && (
        <OAuthConfig 
          serverUrl={oauthConfigServerUrl}
          onConfigured={async () => {
            setNeedsOAuthConfig(false);
            setOAuthConfigServerUrl(null);
            
            // Check if we have pending reauth
            const pendingReauth = sessionStorage.getItem('oauth_pending_reauth');
            if (pendingReauth) {
              try {
                const { spaceId, cardId, serverUrl } = JSON.parse(pendingReauth);
                sessionStorage.removeItem('oauth_pending_reauth');
                console.log('[OAuth Config] Continuing with reauth after config');
                
                // Instead of calling handleReauthorizeCard again which could cause a cycle,
                // continue with the OAuth flow directly since we now have credentials
                const { getOAuthConfig } = await import('./utils/oauthDiscovery');
                const oauthConfig = await getOAuthConfig(serverUrl);
                
                if (oauthConfig) {
                  const { generatePKCE } = await import('./utils/pkce');
                  const { code_verifier: codeVerifier, code_challenge: codeChallenge } = await generatePKCE();
                  const serverHost = new URL(serverUrl).host;
                  
                  // Debug logging for PKCE parameters
                  console.log('[OAuth Config] Generated PKCE parameters:', {
                    codeVerifier: codeVerifier.substring(0, 10) + '...',
                    codeChallenge: codeChallenge.substring(0, 10) + '...'
                  });
                  
                  sessionStorage.setItem('pkce_code_verifier', codeVerifier);
                  sessionStorage.setItem(`oauth_endpoints_${serverHost}`, JSON.stringify(oauthConfig));
                  
                  // Store cards to refresh after OAuth
                  const cardsToRefresh = JSON.stringify([{ spaceId, cardId }]);
                  sessionStorage.setItem('oauth_cards_to_refresh', cardsToRefresh);
                  sessionStorage.setItem('oauth_server_url', serverUrl);
                  
                  // Store all active tabs before OAuth redirect so we can restore them
                  const activeTabs = localStorage.getItem(TABS_KEY);
                  if (activeTabs) {
                    sessionStorage.setItem('oauth_tabs_before_redirect', activeTabs);
                    console.log('[OAuth] Stored active tabs before redirect from OAuthConfig callback');
                  }
                  
                  // Store the current view state to restore after OAuth
                  const currentSpace = spaces.find(s => s.id === spaceId);
                  sessionStorage.setItem('oauth_return_view', JSON.stringify({
                    activeView: 'dashboards', // Dashboard view
                    selectedSpaceId: spaceId,
                    selectedSpaceName: currentSpace?.name || '',
                    timestamp: Date.now()
                  }));
                  console.log('[OAuth] Stored return view state for dashboard from config modal:', spaceId, currentSpace?.name);
                  
                  // Check for server-specific client first, then fall back to global
                  let clientId = null;
                  const serverClientKey = `oauth_client_${serverHost}`;
                  const storedServerClient = sessionStorage.getItem(serverClientKey);
                  if (storedServerClient) {
                    try {
                      const clientData = JSON.parse(storedServerClient);
                      clientId = clientData.clientId;
                      console.log('[OAuth Config] Using server-specific client ID:', clientId);
                    } catch (e) {
                      console.error('[OAuth Config] Failed to parse stored client data:', e);
                    }
                  }
                  
                  // Only proceed if we have a server-specific client ID
                  if (clientId && oauthConfig.authorizationEndpoint) {
                    // Build authorization URL
                    const authUrl = new URL(oauthConfig.authorizationEndpoint);
                    authUrl.searchParams.set('response_type', 'code');
                    authUrl.searchParams.set('client_id', clientId);
                    authUrl.searchParams.set('redirect_uri', `${window.location.origin}/oauth/callback`);
                    authUrl.searchParams.set('code_challenge', codeChallenge);
                    authUrl.searchParams.set('code_challenge_method', 'S256');
                    // Use the scope from OAuth configuration
                    const scope = oauthConfig.scope || 'openid profile email';
                    authUrl.searchParams.set('scope', scope);
                    authUrl.searchParams.set('state', uuidv4());
                    
                    console.log('[OAuth Config] Authorization URL:', authUrl.toString());
                    console.log('[OAuth Config] Redirecting to authorization URL');
                    window.location.href = authUrl.toString();
                  }
                }
              } catch (error) {
                console.error('[OAuth Config] Failed to continue reauth:', error);
                showNotification('Failed to continue OAuth authorization. Please try again.');
              }
            }
          }}
          onCancel={() => {
            setNeedsOAuthConfig(false);
            setOAuthConfigServerUrl(null);
            sessionStorage.removeItem('oauth_pending_reauth');
          }}
        />
      )}
    </div>
  );
}

export default App;