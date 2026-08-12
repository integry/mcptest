import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { completeOAuthFlow } from '../utils/oauthFlow';
import { completeHostedOAuthFlow } from '../utils/hostedOAuth';
import { getSpaceUrl } from '../utils/urlUtils';
import { useAuth } from '../context/AuthContext';

interface OAuthReturnView {
  activeView?: string;
  activeTabId?: string;
  selectedSpaceId?: string;
  selectedSpaceName?: string;
  serverUrl?: string;
}

interface OAuthNavigationState {
  oauthSuccess: boolean;
  fromOAuthReturn?: boolean;
  targetSpaceId?: string;
  serverUrl?: string;
}

const OAuthCallback: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const processingRef = useRef(false);
  const { currentUser } = useAuth();

  useEffect(() => {
    if (processingRef.current) return;
    processingRef.current = true;

    const addOAuthLog = (type: 'info' | 'error' | 'warning', message: string) => {
      let logs: Array<{ type: string; message: string; timestamp: string }> = [];
      try {
        logs = JSON.parse(sessionStorage.getItem('oauth_callback_logs') || '[]');
      } catch {
        // Replace malformed legacy callback logs.
      }
      logs.push({ type, message, timestamp: new Date().toISOString() });
      sessionStorage.setItem('oauth_callback_logs', JSON.stringify(logs));
    };

    const handleOAuthCallback = async () => {
      sessionStorage.setItem('oauth_callback_logs', '[]');
      addOAuthLog('info', 'Processing the OAuth authorization response...');

      try {
        const callbackUrl = new URL(
          `${location.pathname}${location.search}`,
          window.location.origin
        );
        const hostedResult = callbackUrl.searchParams.get('hosted_result');
        let serverUrl: string;
        if (hostedResult) {
          const proxyUrl = import.meta.env.VITE_PROXY_URL as string | undefined;
          if (!proxyUrl || !currentUser) throw new Error('Sign in again to complete hosted OAuth.');
          ({ serverUrl } = await completeHostedOAuthFlow({
            result: hostedResult,
            proxyUrl,
            firebaseToken: await currentUser.getIdToken(),
          }));
        } else {
          ({ serverUrl } = await completeOAuthFlow(callbackUrl));
        }
        addOAuthLog('info', 'OAuth authorization completed successfully.');

        let targetPath = '/';
        let navigationState: OAuthNavigationState = { oauthSuccess: true };
        const returnViewJson = sessionStorage.getItem('oauth_return_view');

        if (returnViewJson) {
          try {
            const returnView = JSON.parse(returnViewJson) as OAuthReturnView;
            if (
              returnView.activeView === 'dashboards'
              && returnView.selectedSpaceId
              && returnView.selectedSpaceName
            ) {
              targetPath = getSpaceUrl(returnView.selectedSpaceName);
              navigationState = {
                ...navigationState,
                fromOAuthReturn: true,
                targetSpaceId: returnView.selectedSpaceId,
              };
            } else if (returnView.activeView === 'report' && returnView.serverUrl) {
              targetPath = `/report/${encodeURIComponent(returnView.serverUrl)}`;
              navigationState = {
                ...navigationState,
                fromOAuthReturn: true,
                serverUrl: returnView.serverUrl,
              };
            }
          } catch {
            addOAuthLog('warning', 'Could not restore the saved return view.');
          }
        }

        sessionStorage.setItem('oauth_server_url', serverUrl);
        navigate(targetPath, { state: navigationState, replace: true });
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'OAuth authorization could not be completed.';
        addOAuthLog('error', message);
        navigate('/', {
          state: { oauthError: message },
          replace: true,
        });
      }
    };

    void handleOAuthCallback();
  }, [currentUser, location.pathname, location.search, navigate]);

  return (
    <div className="container-fluid vh-100 d-flex align-items-center justify-content-center">
      <div className="text-center">
        <div className="spinner-border text-primary mb-3" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
        <h4>Processing authentication...</h4>
        <p className="text-muted">Validating the authorization response and securing your session.</p>
      </div>
    </div>
  );
};

export default OAuthCallback;
