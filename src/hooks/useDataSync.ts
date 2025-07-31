import { useEffect } from 'react';
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
  const { currentUser } = useAuth();
  const workerUrl = import.meta.env.VITE_CLOUDFLARE_WORKER_URL;

  const getAuthHeader = async () => {
    if (!currentUser) throw new Error("User not authenticated");
    const token = await currentUser.getIdToken();
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  };

  const fetchDataFromDO = async () => {
    if (!currentUser || !workerUrl) return;
    try {
      const headers = await getAuthHeader();
      const response = await fetch(workerUrl, { headers });

      if (response.ok) {
        const data = await response.json();
        if (data.spaces) setSpaces(data.spaces);
        if (data.tabs) setTabs(data.tabs);
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
    if (currentUser) {
      fetchDataFromDO();
    } else {
      // On logout, clear the state
      setSpaces([{ id: 'default', name: 'Default Space', cards: [] }]);
      setTabs([{ id: 'default-tab', title: 'New Connection', serverUrl: '', connectionStatus: 'Disconnected' }]);
    }
  }, [currentUser]);

  // Effect to save data when it changes
  useEffect(() => {
      if(currentUser) {
        saveDataToDO(spaces, tabs);
      }
  }, [spaces, tabs, currentUser, saveDataToDO]);
};