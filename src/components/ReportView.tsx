import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getOAuthConfig, discoverOAuthEndpoints } from '../utils/oauthDiscovery';
import { evaluateServer } from '../utils/evaluation';
import { TestedServer } from '../types';
import { RecentReportsPanel } from './RecentReportsPanel';

// Helper functions for score display
const getScoreColor = (score: number): string => {
  if (score >= 90) return 'success';
  if (score >= 70) return 'warning';
  if (score >= 50) return 'info';
  return 'danger';
};

const getScoreGrade = (score: number): string => {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
};

const ReportView: React.FC = () => {
  const { serverUrl: urlParam } = useParams<{ serverUrl: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAuth();
  const [serverUrl, setServerUrl] = useState('');
  const [report, setReport] = useState<any>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [testedServers, setTestedServers] = useState<TestedServer[]>([]);

  // Track if initial report has been triggered
  const [hasInitialized, setHasInitialized] = useState(false);
  const isRunningRef = useRef(false);

  // Load tested servers from localStorage on initial render
  useEffect(() => {
    try {
      const storedServers = localStorage.getItem('mcp_tested_servers');
      if (storedServers) {
        setTestedServers(JSON.parse(storedServers));
      }
    } catch (error) {
      console.error('Failed to load tested servers from localStorage', error);
    }
  }, []);

  // Update localStorage when testedServers state changes
  useEffect(() => {
    try {
      localStorage.setItem('mcp_tested_servers', JSON.stringify(testedServers));
    } catch (error) {
      console.error('Failed to save tested servers to localStorage', error);
    }
  }, [testedServers]);

  // Add/update tested server when a report is completed
  useEffect(() => {
    if (report && report.serverUrl && report.finalScore !== undefined) {
      const newServer: TestedServer = {
        url: report.serverUrl,
        score: report.finalScore,
        timestamp: Date.now(),
      };

      setTestedServers(prevServers => {
        const existingServerIndex = prevServers.findIndex(s => s.url === newServer.url);
        let updatedServers = [...prevServers];

        if (existingServerIndex > -1) {
          // Update existing server
          updatedServers[existingServerIndex] = newServer;
        } else {
          // Add new server
          updatedServers.push(newServer);
        }

        // Sort by timestamp descending (most recent first)
        return updatedServers.sort((a, b) => b.timestamp - a.timestamp);
      });
    }
  }, [report]);
  
  useEffect(() => {
    if (!urlParam || hasInitialized) return;
    
    const decodedUrl = decodeURIComponent(urlParam);
    setServerUrl(decodedUrl);
    setHasInitialized(true);
    
    // Check if we're returning from OAuth
    const state = location.state as any;
    const returnView = sessionStorage.getItem('oauth_return_view');
    
    // Also check for OAuth completion timestamp as a fallback
    const oauthCompletedTime = sessionStorage.getItem('oauth_completed_time');
    const isRecentOAuthCompletion = oauthCompletedTime && 
      (Date.now() - parseInt(oauthCompletedTime)) < 10000; // Within last 10 seconds
    
    console.log('[ReportView] Initial load check:', {
      state,
      fromOAuthReturn: state?.fromOAuthReturn,
      isRecentOAuthCompletion,
      oauthCompletedTime,
      returnView,
      decodedUrl
    });
    
    // If we're returning from OAuth, let the other effect handle it
    if (state?.fromOAuthReturn) {
      console.log('[ReportView] Skipping initial report run - OAuth return detected');
      return;
    }
    
    if (isRecentOAuthCompletion && returnView) {
      try {
        const returnData = JSON.parse(returnView);
        console.log('[ReportView] OAuth return data (timestamp fallback):', returnData);
        
        if (returnData.activeView === 'report' && returnData.serverUrl === decodedUrl) {
          // Clear the return view and OAuth completion time
          sessionStorage.removeItem('oauth_return_view');
          sessionStorage.removeItem('oauth_completed_time');
          
          // Automatically re-run the report after successful OAuth
          console.log('[ReportView] Re-running report after OAuth success (timestamp fallback)');
          setProgress(['OAuth authentication successful! Restarting report...']);
          
          // Small delay to ensure UI updates and then run report
          setTimeout(() => {
            if (currentUser) {
              handleRunReport(decodedUrl);
            }
          }, 500);
          return;
        }
      } catch (e) {
        console.error('Failed to parse OAuth return data:', e);
      }
    }
    
    // Normal flow - run report immediately if user is logged in
    if (currentUser) {
      console.log('[ReportView] Running report normally');
      handleRunReport(decodedUrl);
    }
  }, [urlParam]); // Only depend on urlParam to avoid re-runs
  
  // Separate effect to handle OAuth returns
  useEffect(() => {
    if (!urlParam || !location.state) return;
    
    const state = location.state as any;
    if (!state.fromOAuthReturn) return;
    
    const decodedUrl = decodeURIComponent(urlParam);
    const returnView = sessionStorage.getItem('oauth_return_view');
    
    console.log('[ReportView] OAuth return detected in location state:', {
      state,
      returnView,
      decodedUrl,
      isRunning,
      isRunningRef: isRunningRef.current
    });
    
    if (returnView) {
      try {
        const returnData = JSON.parse(returnView);
        if (returnData.activeView === 'report' && returnData.serverUrl === decodedUrl) {
          // Clear the return view
          sessionStorage.removeItem('oauth_return_view');
          sessionStorage.removeItem('oauth_completed_time');
          
          // Re-run the report after successful OAuth
          console.log('[ReportView] Re-running report after OAuth return (from location state)');
          setProgress(['OAuth authentication successful! Restarting report...']);
          
          if (currentUser && !isRunning && !isRunningRef.current) {
            console.log('[ReportView] Starting delayed report run after OAuth');
            setTimeout(() => {
              handleRunReport(decodedUrl);
            }, 500);
          } else {
            console.log('[ReportView] Cannot run report:', { 
              hasUser: !!currentUser, 
              isRunning,
              isRunningRef: isRunningRef.current 
            });
          }
        }
      } catch (e) {
        console.error('Failed to parse OAuth return data:', e);
      }
    }
  }, [location.state, urlParam, currentUser]);

  const toggleItemExpanded = (itemKey: string) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemKey)) {
        newSet.delete(itemKey);
      } else {
        newSet.add(itemKey);
      }
      return newSet;
    });
  };

  const checkOAuthAuthentication = async (serverUrl: string): Promise<boolean> => {
    try {
      // Check if we already have an OAuth token for this server
      const serverHost = new URL(serverUrl.startsWith('http') ? serverUrl : `https://${serverUrl}`).host;
      const existingToken = sessionStorage.getItem(`oauth_access_token_${serverHost}`);
      
      if (existingToken) {
        setProgress(prev => [...prev, 'Found existing OAuth token for server']);
        return true;
      }

      // Check if server has OAuth endpoints
      setProgress(prev => [...prev, 'Checking if server requires OAuth authentication...']);
      const discovered = await discoverOAuthEndpoints(serverUrl);
      
      if (discovered) {
        setProgress(prev => [...prev, 'Server requires OAuth authentication']);
        
        // Store the current state so we can return after OAuth
        sessionStorage.setItem('oauth_return_view', JSON.stringify({
          activeView: 'report',
          serverUrl: serverUrl,
          timestamp: Date.now()
        }));
        
        // Ask user for OAuth authentication
        const confirmAuth = confirm('This server requires OAuth authentication. Would you like to authenticate now?');
        if (confirmAuth) {
          // Start OAuth flow directly instead of navigating away
          setProgress(prev => [...prev, 'Starting OAuth authentication...']);
          
          try {
            // Import necessary OAuth utilities
            const { getOAuthConfig } = await import('../utils/oauthDiscovery');
            const { generatePKCE } = await import('../utils/pkce');
            const { v4: uuidv4 } = await import('uuid');
            
            // Get OAuth configuration
            const oauthConfig = await getOAuthConfig(serverUrl);
            if (!oauthConfig) {
              setProgress(prev => [...prev, 'Failed to get OAuth configuration']);
              return false;
            }
            
            // Generate PKCE parameters
            const { code_verifier: codeVerifier, code_challenge: codeChallenge } = await generatePKCE();
            sessionStorage.setItem('pkce_code_verifier', codeVerifier);
            sessionStorage.setItem('oauth_server_url', serverUrl);
            
            // Extract server host
            const serverHost = new URL(serverUrl.startsWith('http') ? serverUrl : `https://${serverUrl}`).hostname;
            sessionStorage.setItem(`oauth_endpoints_${serverHost}`, JSON.stringify(oauthConfig));
            
            // Check for stored client registration
            let clientId: string | null = null;
            const serverClientKey = `oauth_client_${serverHost}`;
            const storedServerClient = sessionStorage.getItem(serverClientKey);
            
            if (storedServerClient) {
              try {
                const clientData = JSON.parse(storedServerClient);
                clientId = clientData.clientId;
              } catch (e) {
                console.error('[OAuth] Failed to parse stored client data:', e);
              }
            }
            
            // If no client ID, try dynamic registration
            if (!clientId && oauthConfig.registrationEndpoint) {
              const registrationData = {
                client_name: 'MCP Test Client',
                redirect_uris: [`${window.location.origin}/oauth/callback`],
                grant_types: ['authorization_code'],
                response_types: ['code'],
                application_type: 'web',
                token_endpoint_auth_method: 'none'
              };
              
              const registrationResponse = await fetch(oauthConfig.registrationEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(registrationData)
              });
              
              if (registrationResponse.ok) {
                const clientData = await registrationResponse.json();
                clientId = clientData.client_id;
                
                // Store the client registration
                sessionStorage.setItem(serverClientKey, JSON.stringify({
                  clientId: clientData.client_id,
                  clientSecret: clientData.client_secret
                }));
              }
            }
            
            if (clientId && oauthConfig.authorizationEndpoint) {
              // Build authorization URL
              const authUrl = new URL(oauthConfig.authorizationEndpoint);
              authUrl.searchParams.set('response_type', 'code');
              authUrl.searchParams.set('client_id', clientId);
              authUrl.searchParams.set('redirect_uri', `${window.location.origin}/oauth/callback`);
              authUrl.searchParams.set('code_challenge', codeChallenge);
              authUrl.searchParams.set('code_challenge_method', 'S256');
              authUrl.searchParams.set('scope', oauthConfig.scope || 'openid profile email');
              authUrl.searchParams.set('state', uuidv4());
              
              // Redirect to OAuth provider
              window.location.href = authUrl.toString();
              return false; // Prevent further execution as we're redirecting
            } else {
              setProgress(prev => [...prev, 'Failed to configure OAuth client']);
              return false;
            }
          } catch (error) {
            console.error('[OAuth] Error starting authentication:', error);
            setProgress(prev => [...prev, 'OAuth authentication failed']);
            return false;
          }
        } else {
          setProgress(prev => [...prev, 'OAuth authentication cancelled by user']);
          return false;
        }
      }
      
      return true; // No OAuth required or already authenticated
    } catch (error) {
      console.error('Error checking OAuth:', error);
      return true; // Continue without OAuth on error
    }
  };

  const handleRunReport = async (urlToTest: string) => {
    if (!currentUser) {
      alert('Please login to run a report.');
      return;
    }
    if (isRunning || isRunningRef.current) {
      console.log('[ReportView] Report already running, skipping');
      return;
    }

    setIsRunning(true);
    isRunningRef.current = true;
    setProgress(['Starting evaluation...']);
    setReport(null);
    
    // Only navigate if we're not already on the correct URL
    const currentReportUrl = urlParam ? decodeURIComponent(urlParam) : '';
    if (currentReportUrl !== urlToTest) {
      navigate(`/report/${encodeURIComponent(urlToTest)}`);
    }

    // Check if OAuth authentication is needed
    const canProceed = await checkOAuthAuthentication(urlToTest);
    if (!canProceed) {
      setIsRunning(false);
      isRunningRef.current = false;
      return;
    }

    // Get OAuth access token from sessionStorage if available
    const serverHost = new URL(urlToTest.startsWith('http') ? urlToTest : `https://${urlToTest}`).host;
    const oauthAccessToken = sessionStorage.getItem(`oauth_access_token_${serverHost}`);
    
    // Get Firebase auth token
    const token = await currentUser.getIdToken();
    
    // Progress callback
    const onProgress = (message: string) => {
      setProgress(prev => [...prev, message]);
    };
    
    try {
      const reportData = await evaluateServer(urlToTest, token, onProgress, oauthAccessToken);
      setReport(reportData);
      
      // If authentication is required, show a button to authenticate
      if (reportData && reportData.sections && reportData.sections.auth) {
        setProgress(prev => [...prev, 'Authentication required. Please authenticate with the server and run the report again.']);
      }
    } catch (error) {
      console.error('Report error:', error);
      setProgress(prev => [...prev, `Error: ${(error as Error).message}`]);
      setReport(null);
    } finally {
      setIsRunning(false);
      isRunningRef.current = false;
    }
  };

  const handleSelectServer = (url: string) => {
    setServerUrl(url);
  };

  const handleRemoveServer = (url: string) => {
    setTestedServers(prev => prev.filter(s => s.url !== url));
  };

  return (
    <div className="container-fluid h-100 d-flex flex-column" style={{ paddingBottom: '2rem' }}>
      <h2 className="mb-3">MCP Server Report Card</h2>
      <div className="input-group mb-3">
        <input
          type="text"
          className="form-control"
          placeholder="Enter server URL (e.g., mcp.paypal.com)"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          disabled={isRunning}
        />
        <button className="btn btn-primary" onClick={() => handleRunReport(serverUrl)} disabled={isRunning}>
          {isRunning ? 'Running...' : 'Run Report'}
        </button>
      </div>

      <RecentReportsPanel
        testedServers={testedServers}
        onSelectServer={handleSelectServer}
        onRemoveServer={handleRemoveServer}
        isRunning={isRunning}
      />

      {isRunning && (
        <div className="progress mb-3">
          <div className="progress-bar progress-bar-striped progress-bar-animated" style={{ width: `${(progress.length / 10) * 100}%` }}></div>
        </div>
      )}

      {progress.length > 0 && !report && (
        <div className="card mb-3">
          <div className="card-header">Progress</div>
          <ul className="list-group list-group-flush">
            {progress.map((p, i) => <li key={i} className="list-group-item">{p}</li>)}
          </ul>
        </div>
      )}

      {report && (
        <div className="card mb-4">
          <div className="card-header">
            <h4>Report for: {report.serverUrl}</h4>
            <h3 className={`text-${getScoreColor(!report.sections.security ? (report.finalScore / 70) * 100 : (report.finalScore / 110) * 100)}`}>
              Final Score: {report.finalScore} / {!report.sections.security ? 70 : 110} ({getScoreGrade(!report.sections.security ? (report.finalScore / 70) * 100 : (report.finalScore / 110) * 100)})
            </h3>
            {!report.sections.security && (
              <small className="text-muted">Note: OAuth not supported - score calculated out of 70 points</small>
            )}
          </div>
          <div className="card-body">
            {report.sections && report.sections.auth && (
              <div className="alert alert-warning mb-3">
                <h5>OAuth Authentication Required</h5>
                <p>This server requires OAuth authentication before it can be evaluated.</p>
                <button 
                  className="btn btn-primary"
                  onClick={async () => {
                    // Store the current state so we can return after OAuth
                    sessionStorage.setItem('oauth_return_view', JSON.stringify({
                      activeView: 'report',
                      serverUrl: report.serverUrl,
                      timestamp: Date.now()
                    }));
                    
                    // Start OAuth flow directly
                    try {
                      const { generatePKCE } = await import('../utils/pkce');
                      const { v4: uuidv4 } = await import('uuid');
                      
                      const oauthConfig = await getOAuthConfig(report.serverUrl);
                      if (!oauthConfig) {
                        alert('Failed to get OAuth configuration');
                        return;
                      }
                      
                      const { code_verifier: codeVerifier, code_challenge: codeChallenge } = await generatePKCE();
                      sessionStorage.setItem('pkce_code_verifier', codeVerifier);
                      sessionStorage.setItem('oauth_server_url', report.serverUrl);
                      
                      const serverHost = new URL(report.serverUrl.startsWith('http') ? report.serverUrl : `https://${report.serverUrl}`).hostname;
                      sessionStorage.setItem(`oauth_endpoints_${serverHost}`, JSON.stringify(oauthConfig));
                      
                      let clientId: string | null = null;
                      const serverClientKey = `oauth_client_${serverHost}`;
                      const storedServerClient = sessionStorage.getItem(serverClientKey);
                      
                      if (storedServerClient) {
                        try {
                          const clientData = JSON.parse(storedServerClient);
                          clientId = clientData.clientId;
                        } catch (e) {
                          console.error('[OAuth] Failed to parse stored client data:', e);
                        }
                      }
                      
                      if (!clientId && oauthConfig.registrationEndpoint) {
                        const registrationData = {
                          client_name: 'MCP Test Client',
                          redirect_uris: [`${window.location.origin}/oauth/callback`],
                          grant_types: ['authorization_code'],
                          response_types: ['code'],
                          application_type: 'web',
                          token_endpoint_auth_method: 'none'
                        };
                        
                        const registrationResponse = await fetch(oauthConfig.registrationEndpoint, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(registrationData)
                        });
                        
                        if (registrationResponse.ok) {
                          const clientData = await registrationResponse.json();
                          clientId = clientData.client_id;
                          
                          sessionStorage.setItem(serverClientKey, JSON.stringify({
                            clientId: clientData.client_id,
                            clientSecret: clientData.client_secret
                          }));
                        }
                      }
                      
                      if (clientId && oauthConfig.authorizationEndpoint) {
                        const authUrl = new URL(oauthConfig.authorizationEndpoint);
                        authUrl.searchParams.set('response_type', 'code');
                        authUrl.searchParams.set('client_id', clientId);
                        authUrl.searchParams.set('redirect_uri', `${window.location.origin}/oauth/callback`);
                        authUrl.searchParams.set('code_challenge', codeChallenge);
                        authUrl.searchParams.set('code_challenge_method', 'S256');
                        authUrl.searchParams.set('scope', oauthConfig.scope || 'openid profile email');
                        authUrl.searchParams.set('state', uuidv4());
                        
                        window.location.href = authUrl.toString();
                      } else {
                        alert('Failed to configure OAuth client');
                      }
                    } catch (error) {
                      console.error('[OAuth] Error starting authentication:', error);
                      alert('Failed to start OAuth authentication');
                    }
                  }}
                >
                  Authenticate with Server
                </button>
              </div>
            )}
            <div className="row g-3">
              {Object.entries(report.sections as Record<string, any>).map(([key, section]) => (
                <div key={key} className="col-12">
                  <div className="card h-100 shadow-sm">
                    <div className="card-header">
                      <div className="d-flex justify-content-between align-items-start mb-2">
                        <h5 className="mb-0">{section.name}</h5>
                        <div className="d-flex align-items-center gap-2">
                          <span className={`text-${getScoreColor(section.score / section.maxScore * 100)} fw-bold`}>
                            {section.score} / {section.maxScore} points
                          </span>
                          <span className={`badge bg-${getScoreColor(section.score / section.maxScore * 100)}`}>
                            {Math.round(section.score / section.maxScore * 100)}%
                          </span>
                        </div>
                      </div>
                      <small className="text-muted d-block">{section.description}</small>
                    </div>
                    <div className="card-body">
                      {section.details && (
                        <div>
                          {section.details.map((detail: any, i: number) => {
                            const detailText = typeof detail === 'string' ? detail : detail.text;
                            const detailContext = typeof detail === 'object' ? detail.context : null;
                            const detailMetadata = typeof detail === 'object' ? detail.metadata : null;
                            const isSuccess = detailText.startsWith('✓');
                            const isError = detailText.startsWith('✗');
                            const isWarning = detailText.startsWith('⚠');
                            const itemKey = `${key}-${i}`;
                            const isExpanded = expandedItems.has(itemKey);
                            const hasMoreInfo = detailContext || detailMetadata;
                            
                            return (
                              <div key={i} className="mb-3">
                                <div className={`d-flex align-items-start ${isSuccess ? 'text-success' : isError ? 'text-danger' : 'text-warning'}`}>
                                  <span style={{ marginRight: '10px', marginTop: '2px' }}>{isSuccess ? '✓' : isError ? '✗' : '⚠'}</span>
                                  <div className="flex-grow-1">
                                    <div 
                                      className="d-flex align-items-center"
                                      style={{ 
                                        cursor: hasMoreInfo ? 'pointer' : 'default',
                                        transition: 'background-color 0.2s ease',
                                        borderRadius: '4px',
                                        padding: '2px 4px',
                                        margin: '-2px -4px'
                                      }}
                                      onMouseEnter={(e) => hasMoreInfo && (e.currentTarget.style.backgroundColor = '#f8f9fa')}
                                      onMouseLeave={(e) => hasMoreInfo && (e.currentTarget.style.backgroundColor = 'transparent')}
                                      onClick={() => hasMoreInfo && toggleItemExpanded(itemKey)}
                                    >
                                      <div className="flex-grow-1">{detailText.substring(2)}</div>
                                      {hasMoreInfo && (
                                        <span 
                                          className="text-muted ms-2" 
                                          style={{ fontSize: '0.875rem' }}
                                          title="Click to see more details"
                                        >
                                          {isExpanded ? '▼' : '▶'}
                                        </span>
                                      )}
                                    </div>
                                    {isExpanded && (
                                      <div className="mt-2" style={{ marginLeft: '20px' }}>
                                        {detailContext && (
                                          <div className="text-muted mb-2" style={{ fontSize: '0.875rem' }}>
                                            {detailContext}
                                          </div>
                                        )}
                                        {detailMetadata && (
                                          <div className="bg-light rounded p-2" style={{ fontSize: '0.813rem' }}>
                                            <strong className="text-muted">Request Details:</strong>
                                            <pre className="mb-0 mt-1" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                              {JSON.stringify(detailMetadata, null, 2)}
                                            </pre>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportView;