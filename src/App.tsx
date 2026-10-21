import React, { Suspense, useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// Import Analytics helpers
import { getAnalyticsHost, logPageView, trackEvent } from './utils/analytics';

// Import Components
import Header from './components/Header';
import NotificationPopup from './components/NotificationPopup';
import SideNav from './components/SideNav';
import CatalogView from './components/CatalogView';
import ServerProfileView from './components/ServerProfileView';
import Tabs from './components/Tabs';
import LearnIndex from './components/learn/LearnIndex';
import LearnNotFound from './components/learn/LearnNotFound';
// Route-level code splitting: the inspector, dashboards, reports, submission,
// article renderer and OAuth screens are separate chunks (see views/deferredViews).
import {
  DashboardsView,
  LearnArticlePage,
  OAuthCallback,
  OAuthConfig,
  ReportView,
  SubmitServerView,
  TabContent,
  ViewFallback,
} from './views/deferredViews';
import { PAGE_COMPONENTS } from './content/componentRegistry';
import {
  getContentPage,
  getLearnArticle,
  getLearnArticleSlugFromPath,
  isLearnIndexPath,
} from './content/learnRegistry';

// Import Data Sync Hook
import { useDataSync } from './hooks/useDataSync';
import { useMetaTags } from './hooks/useMetaTags';
import { useAuth } from './context/AuthContext';

import { v4 as uuidv4 } from 'uuid';

// Import Types
import {
  Space, SpaceCard, ConnectionTab
} from './types';
import type { CatalogServer } from './types/catalog';

// Import Utils
import { generateSpaceSlug, findSpaceBySlug, getSpaceUrl, extractSlugFromPath, parseServerUrl, parseResultShareUrl } from './utils/urlUtils';
import { formatErrorForDisplay } from './utils/errorHandling';
import { getCatalogServerById } from './utils/catalogUtils';
import { getCatalogServerIdFromPath } from './utils/catalogSeo';
import { getPreferredCatalogEndpoint } from './utils/clientSetup';
// The MCP SDK, OAuth flow and saved-card helpers load on demand; see utils/savedCardRuntime.
import type {
  OAuthPrerequisite,
  PendingAuthenticatedMcpRetry,
  SavedCardOAuthChallenge,
} from './utils/savedCardRuntime';
import { consumeOAuthReconnectRequest } from './utils/oauthReconnect';
import { isLandingEligible } from './utils/landingEligibility';
import { createDefaultSpaces, createDefaultTabs } from './utils/defaultWorkspace';

type SavedCardRuntime = typeof import('./utils/savedCardRuntime');
const loadSavedCardRuntime = (): Promise<SavedCardRuntime> => import('./utils/savedCardRuntime');

// Constants for localStorage keys
const SPACES_KEY = 'mcpSpaces'; // New key for dashboards
const TABS_KEY = 'mcpConnectionTabs'; // New key for tabs

export const getLearnPageViewTitle = (path: string) => {
  const article = getLearnArticle(getLearnArticleSlugFromPath(path));
  if (article) return `Learn: ${article.title}`;
  return isLearnIndexPath(path) ? 'Learn MCP' : 'Guide Not Found';
};

// public/theme-init.js sets data-theme on <html> before the first paint; the
// app starts from that attribute so the two can never disagree. The fallback
// repeats the script's logic for environments where it did not run (tests).
const getInitialTheme = (): 'light' | 'dark' => {
  const applied = document.documentElement.getAttribute('data-theme');
  if (applied === 'light' || applied === 'dark') {
    return applied;
  }

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
const getInitialView = (): 'playground' | 'dashboards' | 'docs' | 'learn' | 'report' | 'catalog' | 'server-profile' | 'submit' => {
  const path = window.location.pathname;
  if (path === '/submit') {
    return 'submit';
  }
  if (path.startsWith('/docs/')) {
    return 'docs';
  }
  if (path === '/learn' || path.startsWith('/learn/')) {
    return 'learn';
  }
  if (path.startsWith('/space/')) {
    return 'dashboards';
  }
  if (path.startsWith('/report')) {
    return 'report';
  }
  if (getCatalogServerIdFromPath(path)) {
    return 'server-profile';
  }
  if (path.startsWith('/catalog')) {
    return 'catalog';
  }
  return 'playground';
};

// Helper to load dashboards from localStorage
const loadSpaces = (defaultValue: Space[]): Space[] => {
  try {
    const stored = localStorage.getItem(SPACES_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return (parsed as Space[]).map(space => ({
          ...space,
          cards: (space.cards || []).map(card => {
            const { loading, error, responseData, responseType, ...persistedCard } = card;
            return persistedCard;
          })
        }));
      }
    }
  } catch (e) {
    console.error(`Failed to load or parse data from localStorage key "${SPACES_KEY}":`, e);
  }
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
  const { currentUser, loading: authLoading } = useAuth();
  // --- State ---
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);
  const [spaces, setSpaces] = useState<Space[]>(() => {
    const loaded = loadSpaces(createDefaultSpaces());
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
  const [oauthPrerequisite, setOAuthPrerequisite] = useState<OAuthPrerequisite | null>(null);
  const handledOAuthSuccessRef = useRef(false);
  const visitedViewsRef = useRef(new Set<string>());
  
  // Tab state
  const [tabs, setTabs] = useState<ConnectionTab[]>(() => {
    const savedTabs = localStorage.getItem(TABS_KEY);
    if (savedTabs) {
      const parsedTabs = JSON.parse(savedTabs);
      if (Array.isArray(parsedTabs) && parsedTabs.length > 0) {
        return parsedTabs;
      }
    }
    return createDefaultTabs();
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
  const { activeView } = useMemo(() => {
    const path = location.pathname;
    console.log('[ActiveView Calculation] Path:', path, 'Spaces count:', spaces.length);
    
    // Check for documentation routes
    if (path.startsWith('/docs/')) {
      console.log('[ActiveView] Detected docs view');
      return { activeView: 'docs' as const };
    }

    if (path === '/learn' || path.startsWith('/learn/')) {
      return { activeView: 'learn' as const };
    }

    if (path === '/submit') {
      return { activeView: 'submit' as const };
    }

    // Check for report routes
    if (path.startsWith('/report')) {
      return { activeView: 'report' as const };
    }

    if (getCatalogServerIdFromPath(path)) {
      return { activeView: 'server-profile' as const };
    }

    // Check for catalog routes
    if (path.startsWith('/catalog')) {
      return { activeView: 'catalog' as const };
    }
    
    // Check for dashboard routes
    const slug = extractSlugFromPath(path);
    if (slug) {
      const space = findSpaceBySlug(spaces, slug);
      console.log('[ActiveView] Checking slug:', slug, 'Found space:', !!space);
      if (space) {
        console.log('[ActiveView] Detected dashboards view for space:', space.name);
        return { activeView: 'dashboards' as const };
      }
      // If we have a slug but no matching space yet (e.g., during OAuth callback when spaces aren't loaded),
      // still treat it as a dashboard view to prevent flashing
      if (spaces.length === 0 || sessionStorage.getItem('oauth_return_view')) {
        console.log('[ActiveView] Dashboard path detected, waiting for spaces to load');
        return { activeView: 'dashboards' as const };
      }
    }
    
    // Default to inspector
    console.log('[ActiveView] Defaulting to playground view');
    return { activeView: 'playground' as const };
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
    trackEvent('theme_changed', { theme_name: theme });
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

    if (path === '/learn' || path.startsWith('/learn/')) {
      pageTitle = getLearnPageViewTitle(path);
      logPageView(path, pageTitle);
      return;
    }

    const catalogServerId = getCatalogServerIdFromPath(path);
    if (catalogServerId) {
      const catalogServer = getCatalogServerById(catalogServerId);
      pageTitle = catalogServer ? `${catalogServer.name} MCP Server Report` : 'MCP Server Not Found';
      logPageView(path, pageTitle);
      return;
    }

    // Check for catalog route
    if (path.startsWith('/catalog')) {
      pageTitle = 'Server Catalog';
      logPageView(path, pageTitle);
      return;
    }

    if (path === '/submit') {
      logPageView(path, 'Submit a server');
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
    trackEvent('server_url_connection', { host: getAnalyticsHost(serverUrl), transport_method: transportMethod });
    const preferredTransport = transportMethod === 'mcp'
      ? 'streamable-http'
      : transportMethod === 'sse'
        ? 'legacy-sse'
        : undefined;
    
    // Find or create a tab for this server
    let targetTab = tabs.find(tab => tab.serverUrl === serverUrl);
    
    if (!targetTab) {
      // Create new tab with the server URL
      targetTab = {
        id: uuidv4(),
        title: `Server: ${serverUrl}`,
        serverUrl: serverUrl,
        connectionStatus: 'Disconnected',
        preferredTransportHint: preferredTransport,
        useProxy: true,
      };
      setTabs(prev => [...prev, targetTab!]);
    }
    
    // Set as active tab
    setActiveTabId(targetTab.id);
    
    // Update the tab's server URL and trigger connection
    handleUpdateTab(targetTab.id, {
      serverUrl: serverUrl,
      title: `Server: ${serverUrl}`,
      ...(preferredTransport ? { preferredTransportHint: preferredTransport } : {}),
    });
  };

  const handleResultShareConnection = (resultData: {
    serverUrl: string;
    type: 'tool' | 'resource';
    name: string;
    params?: Record<string, any>;
  }) => {
    trackEvent('result_share_connection', { host: getAnalyticsHost(resultData.serverUrl), type: resultData.type });
    
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
    trackEvent('create_tab');
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

  const handleCatalogTestServer = useCallback((server: CatalogServer) => {
    const preferredEndpoint = getPreferredCatalogEndpoint(server);
    const newTab: ConnectionTab = {
      id: uuidv4(),
      title: server.name,
      serverUrl: preferredEndpoint.url,
      connectionStatus: 'Disconnected',
      preferredTransportHint: preferredEndpoint.transport,
      useProxy: server.browserAccess !== 'direct',
      autoConnect: server.authType === 'none' || server.authType === 'oauth',
      catalogAuthType: server.authType,
      catalogRequiredHeaders: server.requiredHeaders,
      catalogProtocolEra: server.protocolEra,
    };

    setTabs(prevTabs => [...prevTabs, newTab]);
    setActiveTabId(newTab.id);
    navigate('/');
  }, [navigate]);

  const handleSelectTab = (id: string) => {
    trackEvent('select_tab');
    setActiveTabId(id);
  };

  const handleCloseTab = (id: string) => {
    trackEvent('close_tab', { tab_count: tabs.length > 1 ? tabs.length - 1 : 1 });
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
    const getSessionItem = (key: string) => {
      try {
        return sessionStorage.getItem(key);
      } catch {
        return null;
      }
    };
    const setSessionItem = (key: string, value: string) => {
      try {
        sessionStorage.setItem(key, value);
      } catch {
        // The OAuth endpoint also travels in navigation state.
      }
    };
    const removeSessionItem = (key: string) => {
      try {
        sessionStorage.removeItem(key);
      } catch {
        // Treat unavailable session storage as already consumed.
      }
    };
    const state = location.state as {
      oauthSuccess?: boolean;
      oauthError?: string;
      authorizedServerUrl?: string;
      fromOAuthReturn?: boolean;
      targetSpaceId?: string;
    } | null;
    
    if (state?.oauthSuccess) {
      if (handledOAuthSuccessRef.current) return;
      handledOAuthSuccessRef.current = true;
    } else {
      handledOAuthSuccessRef.current = false;
    }

    // Capture both handoff channels before legacy callback cleanup runs. The
    // location-state endpoint recovers the intent when storage is unavailable
    // or another callback consumer got there first.
    const reconnectServerUrl = state?.oauthSuccess
      ? consumeOAuthReconnectRequest() || state.authorizedServerUrl
      : undefined;
    const initiatingOAuthTabId = state?.oauthSuccess
      ? getSessionItem('oauth_tab_id') || undefined
      : undefined;
    
    // Check for OAuth callback logs in sessionStorage
    const oauthLogsJson = getSessionItem('oauth_callback_logs');
    if (oauthLogsJson) {
      try {
        const oauthLogs = JSON.parse(oauthLogsJson);
        if (oauthLogs && oauthLogs.length > 0) {
          // Get the OAuth server URL and tab ID from sessionStorage
          const oauthServerUrl = getSessionItem('oauth_server_url');
          const oauthTabId = getSessionItem('oauth_tab_id');
          
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
          removeSessionItem('oauth_callback_logs');
          removeSessionItem('oauth_tab_id');
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
      setSessionItem('oauth_completed_time', Date.now().toString());
      
      // Clear OAuth authentication state on tabs
      setTabs(prevTabs => prevTabs.map(tab => ({ ...tab, isAuthFlowActive: false })));
      
      // Restore tabs that were stored before OAuth redirect.
      const storedTabsJson = getSessionItem('oauth_tabs_before_redirect');
      let restoredTabs: ConnectionTab[] | undefined;
      if (storedTabsJson) {
        try {
          const parsedTabs = JSON.parse(storedTabsJson);
          if (Array.isArray(parsedTabs) && parsedTabs.length > 0) {
            restoredTabs = parsedTabs;
            console.log('[OAuth] Restoring tabs from before OAuth redirect:', restoredTabs);
            localStorage.setItem(TABS_KEY, storedTabsJson);
          }
          removeSessionItem('oauth_tabs_before_redirect');
        } catch (e) {
          console.error('[OAuth] Failed to restore tabs:', e);
        }
      }

      // Dashboard and report callbacks retain their dedicated retry behavior.
      // A playground callback instead selects exactly one tab and sends its
      // existing connection component a one-shot reconnect signal.
      if (reconnectServerUrl && !state.fromOAuthReturn) {
        const sourceTabs = restoredTabs || tabs;
        const reconnectTab = sourceTabs.find(tab => tab.id === initiatingOAuthTabId)
          || sourceTabs.find(tab => tab.isAuthFlowActive)
          || sourceTabs.find(tab => tab.serverUrl === reconnectServerUrl)
          || sourceTabs.find(tab => tab.id === activeTabId)
          || sourceTabs[0];
        const reconnectTabId = reconnectTab?.id || uuidv4();

        console.log('[OAuth] Selecting authorized server and reconnecting:', reconnectServerUrl);
        setTabs(previousTabs => {
          const tabsToUpdate = restoredTabs || previousTabs;
          const hasReconnectTab = tabsToUpdate.some(tab => tab.id === reconnectTabId);
          const availableTabs = hasReconnectTab
            ? tabsToUpdate
            : [...tabsToUpdate, {
                id: reconnectTabId,
                title: reconnectServerUrl,
                serverUrl: reconnectServerUrl,
                connectionStatus: 'Disconnected' as const,
                useProxy: true,
              }];

          return availableTabs.map(tab => tab.id === reconnectTabId
            ? {
                ...tab,
                title: reconnectServerUrl,
                serverUrl: reconnectServerUrl,
                connectionStatus: 'Disconnected' as const,
                isAuthFlowActive: false,
                shouldReconnect: true,
                ...(tab.serverUrl !== reconnectServerUrl
                  ? {
                      originalServerUrl: tab.originalServerUrl || tab.serverUrl,
                      preferredTransportHint: undefined,
                      catalogProtocolEra: undefined,
                    }
                  : {}),
              }
            : {
                ...tab,
                isAuthFlowActive: false,
                shouldReconnect: false,
              });
        });
        setActiveTabId(reconnectTabId);
      } else if (restoredTabs) {
        setTabs(restoredTabs.map(tab => ({ ...tab, isAuthFlowActive: false })));
      }

      removeSessionItem('oauth_server_url');
      removeSessionItem('oauth_tab_id');
      
      // Handle card refresh after OAuth completion
      const cardsToRefreshJson = getSessionItem('oauth_cards_to_refresh');
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
          removeSessionItem('oauth_cards_to_refresh');
          
          // Show success message
          setNotification({ 
            message: 'OAuth authentication successful - refreshing cards', 
            show: true 
          });
          setTimeout(() => setNotification({ message: '', show: false }), 3000);
          
        } catch (error) {
          console.error('[OAuth Card Refresh] Failed to parse cards to refresh:', error);
          removeSessionItem('oauth_cards_to_refresh');
        }
      }
      
      // Restore the view state if we came from a dashboard
      const returnViewJson = getSessionItem('oauth_return_view');
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
              removeSessionItem('oauth_return_view');
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
                removeSessionItem('oauth_return_view');
              } else {
                console.log('[OAuth] Target space not found:', returnView.selectedSpaceId);
                console.log('[OAuth] Available spaces:', spaces.map(s => ({ id: s.id, name: s.name })));
                // Clear invalid view state
                removeSessionItem('oauth_return_view');
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
            removeSessionItem('oauth_return_view');
            return; // Skip the default navigation below
          }
        } catch (error) {
          console.error('[OAuth] Failed to restore view state:', error);
          removeSessionItem('oauth_return_view');
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
    trackEvent('create_dashboard');
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
    trackEvent('create_space');
    const newSpace: Space = { id: Date.now().toString(), name, cards: [] };
    setSpaces(prev => [...prev, newSpace]);
    setSelectedSpaceId(newSpace.id); // Select the new space
    navigate(getSpaceUrl(newSpace.name)); // Navigate to new space URL
  };

  const handleSelectDashboard = (id: string) => {
    const space = spaces.find(s => s.id === id);
    if (space) {
      trackEvent('select_dashboard');
      setSelectedSpaceId(id);
      navigate(getSpaceUrl(space.name));
    }
  };

  const handleUpdateDashboard = (id: string, updatedData: Partial<Omit<Space, 'id'>>) => {
    trackEvent('update_dashboard', { updated_keys: Object.keys(updatedData).join(',') });
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
    trackEvent('delete_dashboard');
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
    trackEvent('reorder_dashboards');
    setSpaces(reorderedDashboards);
  };

  // --- Dashboard Health Check Functions ---
  const performAllDashboardsHealthCheck = async () => {
    trackEvent('health_check_all_dashboards', { dashboard_count: spaces.length });
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
        trackEvent('refresh_current_dashboard');
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

  // Preload health checks on page load (cards connect to their own servers).
  // Whether to run is decided from the URL the page loaded with; the checks
  // wait for auth to resolve so proxied cards carry the signed-in user's token.
  const loadHealthCheckPendingRef = useRef<boolean | null>(null);
  useEffect(() => {
    const shouldRunLoadHealthCheck = () => {
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
        return false;
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
        return true;
      }
      setHealthCheckLoading(false);
      console.log('[Health Check] No dashboards with cards found, skipping auto health check');
      return false;
    };

    if (loadHealthCheckPendingRef.current === null) {
      loadHealthCheckPendingRef.current = shouldRunLoadHealthCheck();
    }
    if (authLoading || !loadHealthCheckPendingRef.current) return;
    loadHealthCheckPendingRef.current = false;

    // Add a small delay to ensure component is fully mounted
    setTimeout(() => {
      performAllDashboardsHealthCheck().then(() => {
        console.log('[Health Check] Auto-preload completed successfully');
      }).catch((error) => {
        console.error('[Health Check] Auto-preload failed:', error);
      });
    }, 2000); // 2 second delay to ensure everything is ready
  }, [authLoading]); // Once on mount, then again when auth resolves

  // --- Add to Dashboard Functionality ---
  const handleAddCardToDashboard = (spaceId: string, cardData: Omit<Space['cards'][0], 'id'>) => {
      trackEvent('add_card_to_dashboard', { 
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
      trackEvent('add_card_to_space', { 
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
    trackEvent('update_card');
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
    trackEvent('delete_card');
    setSpaces(prev => prev.map(space => {
      if (space.id === spaceId) {
        return { ...space, cards: space.cards.filter(card => card.id !== cardId) };
      }
      return space;
    }));
    console.log(`[DEBUG] Deleted card ${cardId} from space ${spaceId}`);
  };

  const handleMoveCard = (sourceSpaceId: string, targetSpaceId: string, cardId: string) => {
    trackEvent('move_card');
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
      newState: Partial<Pick<SpaceCard, 'loading' | 'error' | 'responseData' | 'responseType' | 'serverUrl'>>
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
    const runtime = await loadSavedCardRuntime();
    if (card) {
        trackEvent('execute_card', {
            card_type: card.type
        });
    }

    // Set initial loading state
    setSpaces(prev => updateCardState(prev, spaceId, cardId, { loading: true, error: null, responseData: null, responseType: null }));

    let tempClient: any = null;
    let activeConnection: Awaited<ReturnType<SavedCardRuntime['attemptParallelConnections']>> | null = null;
    let lastError: any = null;
    let shouldUseProxy = false; // Move this outside try block to make it accessible in catch block
    let pendingOAuthRetry: PendingAuthenticatedMcpRetry | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const cardAttemptStartedAt = Date.now();
      try {
        console.log(`[Execute Card ${cardId} Attempt ${attempt}/${MAX_RETRIES}] Starting execution. Card URL: ${card.serverUrl}`);
        lastError = null; // Clear last error on new attempt
        const resourceUri = card.type === 'resource'
          ? runtime.getSavedResourceUri(card.name, card.params)
          : undefined;

        // --- Connection and Request Logic ---
        // Use only the exact resource's issuer-bound SDK token.
        const oauthToken = runtime.loadOAuthAuthorization(card.serverUrl)?.accessToken;
        pendingOAuthRetry = pendingOAuthRetry || runtime.resumeSavedCardAuthenticatedMcpRetry(
          card.serverUrl,
          oauthToken,
          sessionStorage,
          cardAttemptStartedAt
        );
        const proxyUrl = import.meta.env.VITE_PROXY_URL;
        const proxySelected = Boolean(
          proxyUrl && (card.useProxy !== undefined ? card.useProxy : !oauthToken)
        );
        shouldUseProxy = proxySelected;
        const proxyAuthToken = proxySelected && currentUser
          ? await currentUser.getIdToken()
          : undefined;
        const connectionPlan = runtime.getSavedCardConnectionPlan({
          serverUrl: card.serverUrl,
          useProxy: card.useProxy,
          oauthToken,
          proxyUrl,
          proxyAuthToken,
        });
        shouldUseProxy = connectionPlan.usesProxy;

        if (connectionPlan.usesProxy) {
          console.log(`[Execute Card ${cardId}] Using ${proxyAuthToken ? 'signed-in' : 'anonymous'} proxy: ${proxyUrl}`);
        } else if (oauthToken) {
          console.log(`[Execute Card ${cardId}] Using OAuth target authentication`);
        }

        activeConnection = await runtime.attemptParallelConnections(
          connectionPlan.connectionUrl,
          undefined,
          connectionPlan.authToken,
          connectionPlan.targetHeaders,
          connectionPlan.usesProxy,
          undefined,
          pendingOAuthRetry?.observeRequest(connectionPlan.usesProxy ? 'proxy' : 'direct')
        );
        tempClient = activeConnection.client;
        console.log(
          `[Execute Card ${cardId} Attempt ${attempt}] Connected with ${activeConnection.transportType} (${activeConnection.protocolEra}${activeConnection.protocolVersion ? `, ${activeConnection.protocolVersion}` : ''}) at ${activeConnection.url}`
        );

        let result: any;
        if (card.type === 'tool') {
            console.log(`[Execute Card ${cardId} Attempt ${attempt}] Calling tool: ${card.name}`);
            result = await tempClient.callTool({ name: card.name, arguments: card.params });
            console.log(`[Execute Card ${cardId} Attempt ${attempt}] Tool result received.`);
            setSpaces(prev => updateCardState(prev, spaceId, cardId, { loading: false, responseData: result.content, responseType: 'tool_result', error: null }));
        } else if (card.type === 'resource') {
            console.log(`[Execute Card ${cardId} Attempt ${attempt}] Accessing resource: ${resourceUri}`);
            result = await tempClient.readResource({ uri: resourceUri as string });
            console.log(`[Execute Card ${cardId} Attempt ${attempt}] Resource result received.`);
            setSpaces(prev => updateCardState(prev, spaceId, cardId, { loading: false, responseData: result.contents, responseType: 'resource_result', error: null }));
        }
        pendingOAuthRetry?.succeed({
          route: connectionPlan.usesProxy ? 'proxy' : 'direct',
          result: activeConnection,
        });
        // --- Success: Break the retry loop ---
        break;

      } catch (err: any) {
        console.warn(`[Execute Card ${cardId} Attempt ${attempt}] Error:`, err);
        lastError = err; // Store the error

        // --- Check for different error types ---
        const isConflict = err.message?.includes('Conflict') || err.message?.includes('409') || err.status === 409;
        const shouldRetry = isConflict && attempt < MAX_RETRIES;

        if (shouldRetry) {
          console.log(`[Execute Card ${cardId} Attempt ${attempt}] Conflict detected, retrying after ${RETRY_DELAY_MS}ms...`);
          // Close the potentially conflicted client before retrying
          if (tempClient) {
              try { await tempClient.close(); } catch { /* ignore close error on retry */ }
              tempClient = null;
          }
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS)); // Wait before retrying
          continue; // Go to the next iteration
        } else {
          // Only a terminal failure may finalize the pending OAuth retry.
          console.error(`[Execute Card ${cardId}] Unrecoverable error or max retries reached.`);

          const authenticationChallenge = runtime.classifySavedCardAuthenticationFailure(
            err,
            shouldUseProxy,
            activeConnection?.takeAuthenticationChallenge()
          );
          const isTargetAuthError = authenticationChallenge?.source === 'target';
          const isProxyAuthError = authenticationChallenge?.source === 'proxy';
          const finalizedPendingRetry = pendingOAuthRetry?.fail({
            route: shouldUseProxy ? 'proxy' : 'direct',
            error: err,
            ...(activeConnection ? { result: activeConnection } : {}),
          });
          if (authenticationChallenge && !finalizedPendingRetry) {
            const trace = runtime.recordOAuthAuthenticationChallenge({
              targetUrl: isTargetAuthError ? authenticationChallenge.targetUrl || card.serverUrl : card.serverUrl,
              status: authenticationChallenge.status,
              source: authenticationChallenge.source,
              route: shouldUseProxy ? 'proxy' : 'direct',
              storage: sessionStorage,
              method: authenticationChallenge.method,
              requestUrl: authenticationChallenge.requestUrl,
              responseHeaders: authenticationChallenge.responseHeaders,
              timing: {
                startedAt: authenticationChallenge.startedAt
                  || new Date(cardAttemptStartedAt).toISOString(),
                durationMs: authenticationChallenge.durationMs
                  ?? Math.max(0, Date.now() - cardAttemptStartedAt),
              },
            });
            if (isProxyAuthError) {
              trace.terminal(
                'failed',
                'The saved-card request stopped at authenticated proxy access; target OAuth discovery was not started.'
              );
            }
          }
          
          // Use enhanced error formatting for better debugging information
          const errorDetails = formatErrorForDisplay(err, {
            serverUrl: card.serverUrl,
            operation: card.type === 'tool' ? `execute tool ${card.name}` : `access resource ${card.name}`
          });
          
          // Mark error with auth information for UI handling
          let errorWithAuthInfo = err instanceof runtime.SavedResourceCardMigrationError
            ? errorDetails
            : isProxyAuthError
            ? {
                message: `Proxy sign-in/session error: ${errorDetails}`,
                isAuthError: false,
                isProxyAuthError: true,
                authenticationSource: 'proxy',
                status: authenticationChallenge.status,
                serverUrl: card.serverUrl,
                isProxied: true
              }
            : {
                message: errorDetails,
                isAuthError: isTargetAuthError,
                ...(authenticationChallenge
                  ? {
                      authenticationSource: authenticationChallenge.source,
                      status: authenticationChallenge.status
                    }
                  : {}),
                serverUrl: card.serverUrl,
                isProxied: shouldUseProxy
              };
          if (
            isTargetAuthError
            && typeof errorWithAuthInfo === 'object'
            && errorWithAuthInfo
          ) {
            errorWithAuthInfo = runtime.attachSavedCardOAuthChallenge(
              errorWithAuthInfo,
              authenticationChallenge
            );
          }
          
          setSpaces(prev => updateCardState(prev, spaceId, cardId, {
            loading: false, error: errorWithAuthInfo, responseData: null, responseType: 'error',
            ...(isTargetAuthError && authenticationChallenge.targetUrl
              ? { serverUrl: authenticationChallenge.targetUrl }
              : {}),
          }));
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
          activeConnection = null;
      }
    } // End of retry loop
  };

  // --- OAuth Re-authorization Function ---
  const handleReauthorizeCard = async (spaceId: string, cardId: string, serverUrl: string) => {
    if (!serverUrl) return;

    const card = spaces
      .find(space => space.id === spaceId)
      ?.cards.find(savedCard => savedCard.id === cardId);
    const challenge = card?.error
      && typeof card.error === 'object'
      && card.error.authenticationSource === 'target'
      ? card.error as SavedCardOAuthChallenge
      : undefined;
    const proxyUrl = import.meta.env.VITE_PROXY_URL as string | undefined;
    const discoveryProxyApplicable = card?.useProxy !== false;

    serverUrl = challenge?.targetUrl || serverUrl;
    const runtime = await loadSavedCardRuntime();
    runtime.clearOAuthTokens(serverUrl);
    sessionStorage.setItem('oauth_cards_to_refresh', JSON.stringify([{ spaceId, cardId }]));
    const activeTabs = localStorage.getItem(TABS_KEY);
    if (activeTabs) sessionStorage.setItem('oauth_tabs_before_redirect', activeTabs);

    const currentSpace = spaces.find(space => space.id === spaceId);
    sessionStorage.setItem('oauth_return_view', JSON.stringify({
      activeView: 'dashboards',
      selectedSpaceId: spaceId,
      selectedSpaceName: currentSpace?.name || '',
      timestamp: Date.now()
    }));

    try {
      const result = await runtime.beginSavedCardOAuthFlow({
        serverUrl,
        challenge,
        proxyUrl,
        currentUser,
        discoveryProxyApplicable,
      });
      if (result === 'AUTHORIZED') await handleExecuteCard(spaceId, cardId);
    } catch (error) {
      const prerequisite = runtime.getOAuthPrerequisite(error);
      if (runtime.isOAuthClientConfigurationRequired(error) || prerequisite) {
        sessionStorage.setItem('oauth_pending_reauth', JSON.stringify({
          spaceId,
          cardId,
          serverUrl
        }));
        setNeedsOAuthConfig(true);
        setOAuthConfigServerUrl(serverUrl);
        setOAuthPrerequisite(prerequisite || null);
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown OAuth error';
      setNotification({ message: `Failed to start OAuth reauthorization: ${message}`, show: true });
      setTimeout(() => setNotification({ message: '', show: false }), 5000);
    }
  };

  // Effect to handle OAuth refresh cards
  useEffect(() => {
    const refreshOAuthCards = async () => {
      // Add a delay to ensure OAuth tokens are properly stored in sessionStorage
      await new Promise(resolve => setTimeout(resolve, 500));
      const runtime = await loadSavedCardRuntime();

      for (const space of spaces) {
        const cardsNeedingRefresh = space.cards.filter(card => (card as any).needsOAuthRefresh);
        if (cardsNeedingRefresh.length > 0) {
          console.log(`[OAuth Refresh Effect] Found ${cardsNeedingRefresh.length} cards needing OAuth refresh in space ${space.id}`);
          
          // Log OAuth token status for debugging
          for (const card of cardsNeedingRefresh) {
            const hasToken = !!runtime.loadOAuthAuthorization(card.serverUrl);
            console.log(`[OAuth Refresh Effect] Card ${card.id} - Server: ${card.serverUrl}, Has OAuth token: ${hasToken}`);
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
    
    // Proxied cards need the signed-in user's token, so wait for auth.
    if (authLoading) return;
    refreshOAuthCards();
  }, [spaces.filter(s => s.cards.some((c: any) => c.needsOAuthRefresh)).length, authLoading]); // Only run when cards need OAuth refresh

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

    // Proxied cards need the signed-in user's token, so wait for auth.
    if (authLoading) return;
    refreshCardsSequentially(); // Call the async function

    // Dependencies: Trigger only when view changes, selected space changes, or auth resolves.
  }, [activeView, selectedSpaceId, authLoading]); // Remove loadedSpaces from dependencies to avoid infinite loop


 // --- Render Logic ---
  const selectedSpace = spaces.find(s => s.id === selectedSpaceId);
  // Views mount the first time they are shown and stay mounted (hidden) after
  // that, so the playground keeps its connections across navigation while a
  // guide or catalog page never renders the inspector, dashboards or report.
  visitedViewsRef.current.add(activeView);
  const hasVisited = (view: typeof activeView) => visitedViewsRef.current.has(view);
  const selectedCatalogServerId = getCatalogServerIdFromPath(location.pathname);
  const selectedCatalogServer = selectedCatalogServerId
    ? getCatalogServerById(selectedCatalogServerId)
    : undefined;
  // The submission page belongs to the catalog in the sidebar and prefills from the live connection.
  const sideNavView = activeView === 'submit' ? 'catalog' : activeView;
  const connectedTab = tabs.find(tab => tab.id === activeTabId && tab.connectionStatus === 'Connected');
  // Markdown articles (/docs/* and /learn/*) and React-only pages resolve from one registry.
  const selectedContentPage = getContentPage(location.pathname);
  const SelectedPageComponent = selectedContentPage?.kind === 'page'
    ? PAGE_COMPONENTS[selectedContentPage.page.component]
    : undefined;
  const renderContentView = () => {
    if (activeView === 'learn' && isLearnIndexPath(location.pathname)) {
      return <LearnIndex />;
    }
    if (selectedContentPage?.kind === 'article') {
      return (
        <Suspense fallback={<ViewFallback label="Loading the guide" />}>
          <LearnArticlePage article={selectedContentPage.article} />
        </Suspense>
      );
    }
    if (SelectedPageComponent) {
      return <SelectedPageComponent />;
    }
    if (activeView === 'learn') {
      return <LearnNotFound />;
    }
    return (
      <div className="alert alert-warning">
        Documentation page not found. Please select a page from the navigation.
      </div>
    );
  };

  // Check if we're on the OAuth callback page
  if (location.pathname === '/oauth/callback') {
    return (
      <Suspense fallback={<ViewFallback label="Completing authentication" />}>
        <OAuthCallback />
      </Suspense>
    );
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
    <div className="app-shell container-fluid vh-100 d-flex flex-column p-0">

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
          activeView={sideNavView}
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

      <Header theme={theme} onToggleTheme={toggleTheme} />

      <main className="app-workspace flex-grow-1 d-flex overflow-hidden" role="main">
        {/* Desktop Side Navigation */}
        <div className="desktop-sidebar col-auto p-2 d-flex flex-column">
          <SideNav
            activeView={sideNavView}
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
          
          {/* Content View: documentation and Learn articles */}
          <div
            className={`view-panel ${activeView === 'docs' || activeView === 'learn' ? '' : 'd-none'}`}
            style={{ minHeight: '100%' }}
          >
            {(activeView === 'docs' || activeView === 'learn') && renderContentView()}
          </div>

          {/* Report View */}
          {hasVisited('report') && (
            <div className={`view-panel report-view-panel ${activeView === 'report' ? '' : 'd-none'}`}>
              <Suspense fallback={<ViewFallback label="Loading the report" />}>
                <ReportView />
              </Suspense>
            </div>
          )}

          {/* Catalog View */}
          {hasVisited('catalog') && (
            <div className={`view-panel ${activeView === 'catalog' ? '' : 'd-none'}`} style={{ height: '100%' }}>
              <CatalogView onTestServer={handleCatalogTestServer} />
            </div>
          )}

          {/* Server Submission View */}
          {activeView === 'submit' && (
            <div className="view-panel">
              <Suspense fallback={<ViewFallback label="Loading the submission form" />}>
                <SubmitServerView initialUrl={connectedTab?.serverUrl} />
              </Suspense>
            </div>
          )}

          {/* Server Profile View */}
          {hasVisited('server-profile') && (
            <div className={`view-panel ${activeView === 'server-profile' ? '' : 'd-none'}`} style={{ height: '100%' }}>
              <ServerProfileView server={selectedCatalogServer} onTestServer={handleCatalogTestServer} />
            </div>
          )}

          {/* Playground View: TabContent instances stay mounted (hidden) once
              opened so their connections survive navigation to other views. */}
          {hasVisited('playground') && (
            <div className={`view-panel ${activeView === 'playground' ? '' : 'd-none'}`} style={{ height: '100%' }}>
              <div className="h-100 d-flex flex-column">
                <div className="playground-tabs-wrapper">
                  <Tabs
                    tabs={tabs}
                    activeTabId={activeTabId}
                    onSelectTab={handleSelectTab}
                    onCloseTab={handleCloseTab}
                    onNewTab={handleNewTab}
                  />
                </div>
                <div className="flex-grow-1 position-relative">
                  <Suspense fallback={<ViewFallback label="Loading the playground" />}>
                    {tabs.map(tab => (
                      <TabContent
                        key={tab.id}
                        tab={tab}
                        isActive={activeTabId === tab.id && activeView === 'playground'}
                        onUpdateTab={handleUpdateTab}
                        spaces={spaces}
                        onAddCardToSpace={handleAddCardToDashboard}
                        landingEligible={isLandingEligible(tabs, tab.id)}
                      />
                    ))}
                  </Suspense>
                </div>
              </div>
            </div>
          )}

          {/* Dashboards View */}
          {hasVisited('dashboards') && (
            <div className={`view-panel ${activeView === 'dashboards' ? '' : 'd-none'}`} style={{ height: '100%' }}>
              {selectedSpace ? (
                <Suspense fallback={<ViewFallback label="Loading the dashboard" />}>
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
                </Suspense>
              ) : (
                <div className="alert alert-warning">No dashboard selected or available. Create one from the side menu.</div>
              )}
            </div>
          )}

        </div>
      </main>
      <NotificationPopup message={notification.message} show={notification.show} />
      
      {/* OAuth authorization prerequisite */}
      {needsOAuthConfig && oauthConfigServerUrl && (
        <Suspense fallback={null}>
        <OAuthConfig 
          serverUrl={oauthConfigServerUrl}
          currentUser={currentUser}
          prerequisite={oauthPrerequisite || undefined}
          onConfigured={async () => {
            setNeedsOAuthConfig(false);
            setOAuthConfigServerUrl(null);
            setOAuthPrerequisite(null);

            const pendingReauth = sessionStorage.getItem('oauth_pending_reauth');
            if (!pendingReauth) return;

            try {
              const { spaceId, cardId, serverUrl } = JSON.parse(pendingReauth);
              sessionStorage.removeItem('oauth_pending_reauth');
              await handleReauthorizeCard(spaceId, cardId, serverUrl);
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Unknown OAuth error';
              setNotification({
                message: `Failed to continue OAuth authorization: ${message}`,
                show: true
              });
              setTimeout(() => setNotification({ message: '', show: false }), 5000);
            }
          }}
          onCancel={() => {
            setNeedsOAuthConfig(false);
            setOAuthConfigServerUrl(null);
            setOAuthPrerequisite(null);
            sessionStorage.removeItem('oauth_pending_reauth');
          }}
        />
        </Suspense>
      )}
    </div>
  );
}

export default App;
