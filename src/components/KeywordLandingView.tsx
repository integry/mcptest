import React, { useState } from 'react';
import type { KeywordLandingPage } from '../content/keywordLandingPages';
import { loadRecentServers } from '../utils/recentServers';
import { LandingHero } from './LandingHero';
import type { SuggestedServerSelection } from './SuggestedServersPanel';

/** What a keyword landing page hands to the playground when the visitor connects. */
export interface LandingPageConnectRequest {
  serverUrl: string;
  /** Set for a catalog quick pick: the endpoint and protocol era it chose. */
  selection?: SuggestedServerSelection;
  source: 'manual' | 'quick_pick' | 'recent_chip';
}

export interface KeywordLandingViewProps {
  page: KeywordLandingPage;
  /**
   * Starts the connection in the playground (App opens it on `/`), through the
   * same tab state, recent connections and share links as the home page.
   */
  onConnect: (request: LandingPageConnectRequest) => void;
  /** Opens the playground's full connection panel with the entered URL. */
  onOpenAdvancedOptions: (serverUrl: string) => void;
}

/**
 * /mcp-test-server, /mcp-inspector-online and /mcp-playground: the home
 * page's connect form with the page's own copy around it. The prerendered
 * page is this component's markup (src/prerender/contentPages.tsx).
 */
export const KeywordLandingView: React.FC<KeywordLandingViewProps> = ({ page, onConnect, onOpenAdvancedOptions }) => {
  const [serverUrl, setServerUrl] = useState('');
  const [recentServers] = useState(loadRecentServers);

  return (
    <LandingHero
      key={page.key}
      page={page}
      serverUrl={serverUrl}
      onServerUrlChange={setServerUrl}
      isConnecting={false}
      onConnect={(selection) => {
        if (selection) {
          onConnect({ serverUrl: selection.endpoint.url, selection, source: 'quick_pick' });
          return;
        }
        const entered = serverUrl.trim();
        if (entered) onConnect({ serverUrl: entered, source: 'manual' });
      }}
      recentServers={recentServers}
      onConnectRecent={(url) => onConnect({ serverUrl: url, source: 'recent_chip' })}
      onOpenAdvancedOptions={() => onOpenAdvancedOptions(serverUrl.trim())}
    />
  );
};

export default KeywordLandingView;
