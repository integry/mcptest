import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  OAuthProxyAuthenticationRequiredError,
  completeOAuthFlow,
  getHostedOAuthTokenProxyUrl,
} from '../utils/oauthFlow';
import { getSpaceUrl } from '../utils/urlUtils';
import { storeOAuthReconnectRequest } from '../utils/oauthReconnect';
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
  authorizedServerUrl?: string;
  fromOAuthReturn?: boolean;
  targetSpaceId?: string;
  serverUrl?: string;
}

const OAuthCallback: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, loading } = useAuth();
  const processingRef = useRef(false);

  useEffect(() => {
    if (loading || processingRef.current) return;
    processingRef.current = true;

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
        // OAuth navigation state remains available when storage is blocked.
      }
    };

    const addOAuthLog = (type: 'info' | 'error' | 'warning', message: string) => {
      let logs: Array<{ type: string; message: string; timestamp: string }> = [];
      try {
        logs = JSON.parse(getSessionItem('oauth_callback_logs') || '[]');
      } catch {
        // Replace malformed legacy callback logs.
      }
      logs.push({ type, message, timestamp: new Date().toISOString() });
      setSessionItem('oauth_callback_logs', JSON.stringify(logs));
    };

    const handleOAuthCallback = async () => {
      setSessionItem('oauth_callback_logs', '[]');
      addOAuthLog('info', 'Processing the OAuth authorization response...');

      try {
        const callbackUrl = new URL(
          `${location.pathname}${location.search}`,
          window.location.origin
        );
        const proxyUrl = import.meta.env.VITE_PROXY_URL as string | undefined;
        const tokenProxyUrl = getHostedOAuthTokenProxyUrl(proxyUrl);
        let proxyToken: string | undefined;
        if (tokenProxyUrl && currentUser) {
          try {
            proxyToken = await currentUser.getIdToken();
          } catch {
            throw new OAuthProxyAuthenticationRequiredError();
          }
        }
        const { serverUrl } = await completeOAuthFlow(callbackUrl, {
          ...(tokenProxyUrl
            ? {
                tokenProxy: {
                  url: tokenProxyUrl,
                  authorizationToken: proxyToken,
                },
              }
            : {}),
        });
        addOAuthLog('info', 'OAuth authorization completed successfully.');

        // The token remains in OAuth storage. Only hand the exact endpoint to
        // the app so it can select and reconnect the authorized server.
        storeOAuthReconnectRequest(serverUrl);

        let targetPath = '/';
        let navigationState: OAuthNavigationState = {
          oauthSuccess: true,
          authorizedServerUrl: serverUrl,
        };
        const returnViewJson = getSessionItem('oauth_return_view');

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

        setSessionItem('oauth_server_url', serverUrl);
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
  }, [currentUser, loading, location.pathname, location.search, navigate]);

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
