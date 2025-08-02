import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useDebouncedCallback } from 'use-debounce';
import { Space, ConnectionTab } from '../types';

const SPACES_KEY = 'mcpSpaces';
const TABS_KEY = 'mcpConnectionTabs';
const THROTTLE_MS = parseInt(import.meta.env.VITE_DATA_SYNC_THROTTLE_MS || '60000', 10);

interface DataSyncProps {
  spaces: Space[];
  tabs: ConnectionTab[];
  setSpaces: React.Dispatch<React.SetStateAction<Space[]>>;
  setTabs: React.Dispatch<React.SetStateAction<ConnectionTab[]>>;
}

export const useDataSync = ({ spaces, tabs, setSpaces, setTabs }: DataSyncProps) => {
  const { currentUser, loading } = useAuth();
  const workerUrl = import.meta.env.VITE_CLOUDFLARE_WORKER_URL;
  const hasInitialized = useRef(false);
  const previousUser = useRef<typeof currentUser>(null);

  const getAuthHeader = async () => {
    if (!currentUser) throw new Error("User not authenticated");
    const token = await currentUser.getIdToken();
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  };

  const fetchDataFromDO = async () => {
    if (!currentUser || !workerUrl) return;
    console.log('[DataSync] Fetching data from Cloudflare for user:', currentUser.email);
    try {
      const headers = await getAuthHeader();
      const response = await fetch(workerUrl, { headers });

      if (response.ok) {
        const data = await response.json();
        console.log('[DataSync] Received data from Cloudflare:', { 
          spacesCount: data.spaces?.length || 0, 
          tabsCount: data.tabs?.length || 0 
        });
        
        if (data.spaces) {
          // Ensure each space has a cards array
          const validatedSpaces = data.spaces.map((space: Space) => ({
            ...space,
            cards: Array.isArray(space.cards) ? space.cards : []
          }));
          setSpaces(validatedSpaces);
          // Only update localStorage if we have non-empty data from Cloudflare
          if (data.spaces.length > 0) {
            // Immediately update localStorage with sanitized spaces
            const spacesToSave = validatedSpaces.map((space: Space) => ({
              ...space,
              cards: space.cards.map((card: any) => {
                const { loading, error, responseData, responseType, ...restOfCard } = card;
                return restOfCard;
              })
            }));
            localStorage.setItem(SPACES_KEY, JSON.stringify(spacesToSave));
            console.log('[DataSync] Updated localStorage with spaces:', spacesToSave.length);
          } else {
            console.log('[DataSync] Skipping localStorage update - empty spaces data from Cloudflare');
          }
        }
        if (data.tabs) {
          setTabs(data.tabs);
          // Only update localStorage if we have non-empty data from Cloudflare
          if (data.tabs.length > 0) {
            // Immediately update localStorage with tabs
            localStorage.setItem(TABS_KEY, JSON.stringify(data.tabs));
            console.log('[DataSync] Updated localStorage with tabs:', data.tabs.length);
          } else {
            console.log('[DataSync] Skipping localStorage update - empty tabs data from Cloudflare');
          }
        }
      }
    } catch (error) {
      console.error("Failed to fetch data from Durable Object:", error);
    }
  };

  const saveDataToDO = useDebouncedCallback(async (currentSpaces: Space[], currentTabs: ConnectionTab[]) => {
    if (!currentUser || !workerUrl) return;
    try {
        const headers = await getAuthHeader();
        const dataToSave = { spaces: currentSpaces, tabs: currentTabs };

        await fetch(workerUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(dataToSave),
        });
    } catch (error) {
        console.error("Failed to save data to Durable Object:", error);
    }
  }, THROTTLE_MS);

  // Effect for initial load and logout
  useEffect(() => {
    // Don't do anything while auth is still loading
    if (loading) return;
    
    // Check if user just logged in (transition from null to user)
    const justLoggedIn = !previousUser.current && currentUser;
    
    if (currentUser) {
      // Fetch data from DO when user logs in or on initial load with logged-in user
      if (!hasInitialized.current || justLoggedIn) {
        hasInitialized.current = true;
        fetchDataFromDO();
      }
    } else if (!currentUser && !loading) {
      // Only set defaults on the very first load when not logged in
      if (!hasInitialized.current) {
        hasInitialized.current = true;
        
        // Check localStorage to see if we have existing data
        let hasExistingData = false;
        try {
          const storedSpaces = localStorage.getItem(SPACES_KEY);
          hasExistingData = storedSpaces && JSON.parse(storedSpaces).length > 0;
        } catch (e) {
          console.error('Failed to parse localStorage data:', e);
        }
        
        if (!hasExistingData) {
          // Only set defaults if there's no existing data in localStorage
          setSpaces([{ id: 'default', name: 'Default Space', cards: [] }]);
          setTabs([{ id: 'default-tab', title: 'New Connection', serverUrl: '', connectionStatus: 'Disconnected' }]);
        }
      }
    }
    
    // Update previous user ref
    previousUser.current = currentUser;
  }, [currentUser, loading, fetchDataFromDO, setSpaces, setTabs]);

  // Effect to save data when it changes
  useEffect(() => {
      if(currentUser) {
        saveDataToDO(spaces, tabs);
      }
  }, [spaces, tabs, currentUser, saveDataToDO]);
};