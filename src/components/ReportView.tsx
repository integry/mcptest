import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getOAuthConfig } from '../utils/oauthDiscovery';
import {
  evaluateServer,
  getEvaluationMaxScore,
  getEvaluationPercentage,
  type EvaluationReport,
} from '../utils/evaluation';

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

interface TestedServer {
  url: string;
  score: number;
  timestamp: number;
}

const ReportView: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAuth();
  
  // Parse the server URL from the pathname since we're not using React Router's Route params
  const urlParam = location.pathname.startsWith('/report/') 
    ? location.pathname.substring('/report/'.length) 
    : undefined;
    
  console.log('[ReportView] Component mounted with:', { 
    pathname: location.pathname, 
    urlParam,
    state: location.state 
  });
  
  const [serverUrl, setServerUrl] = useState(() => {
    // Initialize with the URL from the path if available
    if (urlParam) {
      const decoded = decodeURIComponent(urlParam);
      console.log('[ReportView] Initial state - setting serverUrl from URL param:', decoded);
      return decoded;
    }
    return '';
  });
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [testedServers, setTestedServers] = useState<TestedServer[]>([]);

  // Track if initial report has been triggered
  const [hasInitialized, setHasInitialized] = useState(false);
  const isRunningRef = useRef(false);
  const hasProcessedOAuthReturn = useRef(false);
  
  // Store handleRunReport in a ref to avoid dependency issues
  const handleRunReportRef = useRef<(urlToTest: string) => Promise<void>>();
  
  // Log component mount/unmount
  useEffect(() => {
    console.log('[ReportView] Component mounted');
    return () => {
      console.log('[ReportView] Component unmounted');
    };
  }, []);
  
  useEffect(() => {
    // If there's a server URL in the path, update the input field
    if (urlParam) {
      const decodedUrl = decodeURIComponent(urlParam);
      console.log('[ReportView] URL param effect triggered:', { 
        urlParam, 
        decodedUrl, 
        currentServerUrl: serverUrl,
        needsUpdate: serverUrl !== decodedUrl 
      });
      
      // Always update the serverUrl if it's different
      if (serverUrl !== decodedUrl) {
        setServerUrl(decodedUrl);
      }

      // Automatically run the report if the user is logged in and we haven't run it yet for this session
      if (currentUser && !hasInitialized && handleRunReportRef.current) {
        handleRunReportRef.current(decodedUrl);
        setHasInitialized(true);
      }
    }
  }, [urlParam, currentUser, hasInitialized, serverUrl]);
  
  // Separate effect to handle OAuth returns
  useEffect(() => {
    if (!urlParam || !location.state) return;
    
    const state = location.state as any;
    if (!state.fromOAuthReturn) return;
    
    // Check if we've already processed this OAuth return
    if (hasProcessedOAuthReturn.current) {
      console.log('[ReportView] OAuth return already processed, skipping');
      return;
    }
    
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
          // Mark that we've processed this OAuth return
          hasProcessedOAuthReturn.current = true;
          
          // Clear the return view
          sessionStorage.removeItem('oauth_return_view');
          sessionStorage.removeItem('oauth_completed_time');
          
          // Re-run the report after successful OAuth
          console.log('[ReportView] Re-running report after OAuth return (from location state)');
          setProgress(['OAuth authentication successful! Restarting report...']);
          
          // Ensure the URL is set in the input field
          console.log('[ReportView] Setting serverUrl after OAuth return:', decodedUrl);
          setServerUrl(decodedUrl);
          
          if (currentUser && !isRunning && !isRunningRef.current) {
            console.log('[ReportView] Starting delayed report run after OAuth');
            // Use a longer delay to ensure handleRunReportRef is set
            setTimeout(() => {
              if (handleRunReportRef.current && !isRunningRef.current) {
                handleRunReportRef.current(decodedUrl);
              } else if (!handleRunReportRef.current) {
                // If handleRunReportRef is still not available, try again
                console.log('[ReportView] handleRunReportRef not ready, retrying...');
                setTimeout(() => {
                  if (handleRunReportRef.current && !isRunningRef.current) {
                    handleRunReportRef.current(decodedUrl);
                  } else {
                    console.error('[ReportView] Failed to get handleRunReportRef after retries or report already running');
                  }
                }, 1000);
              }
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
  }, [location.state, urlParam, currentUser, isRunning]);

  useEffect(() => {
    try {
      const savedServers = localStorage.getItem('mcpTestedServers');
      if (savedServers) {
        setTestedServers(JSON.parse(savedServers));
      }
    } catch (e) {
      console.error("Failed to load servers from localStorage", e);
    }
  }, []);

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

  const addOrUpdateServer = (url: string, score: number) => {
    const newServer = { url, score, timestamp: Date.now() };
    const updatedServers = [newServer, ...testedServers.filter(s => s.url !== url)];
    setTestedServers(updatedServers);
    localStorage.setItem('mcpTestedServers', JSON.stringify(updatedServers));
  };

  const removeServer = useCallback((urlToRemove: string) => {
    const updatedServers = testedServers.filter(s => s.url !== urlToRemove);
    setTestedServers(updatedServers);
    localStorage.setItem('mcpTestedServers', JSON.stringify(updatedServers));
  }, [testedServers]);

  const handleRunReport = useCallback(async (urlToTest: string) => {
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
      
      // A resolved evaluation always has a typed score; failures reject instead.
      addOrUpdateServer(urlToTest, Math.round(getEvaluationPercentage(reportData)));
      
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
  }, [currentUser, isRunning, navigate, urlParam, addOrUpdateServer]);

  // Assign handleRunReport to ref after it's defined
  useEffect(() => {
    handleRunReportRef.current = handleRunReport;
  }, [handleRunReport]);

  const scoredSections = report
    ? Object.entries(report.sections).filter(([key]) => key !== 'auth')
    : [];
  const reportMaxScore = report ? getEvaluationMaxScore(report) : 0;
  const reportPercentage = report ? getEvaluationPercentage(report) : 0;

  return (
    <div className="container-fluid h-100 d-flex flex-column" style={{ paddingBottom: '2rem' }}>
      <h2 className="mb-3">MCP Server Report Card</h2>
      <div className="input-group mb-3">
        <input
          type="text"
          className="form-control"
          aria-label="MCP server URL"
          placeholder="Enter server URL (e.g., mcp.paypal.com)"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          disabled={isRunning}
        />
        <button className="btn btn-primary" onClick={() => handleRunReport(serverUrl)} disabled={isRunning}>
          {isRunning ? 'Running...' : 'Run Report'}
        </button>
      </div>

      {testedServers.length > 0 && (
        <div className="card mb-3">
          <div className="card-header">
            <h5 className="mb-0">Previously Tested Servers</h5>
          </div>
          <div className="card-body">
            <div className="list-group">
              {testedServers.map((server) => (
                <div
                  key={server.url}
                  className="list-group-item d-flex justify-content-between align-items-center"
                >
                  <button
                    type="button"
                    className="flex-grow-1"
                    style={{ border: 0, background: 'transparent', padding: 0, textAlign: 'left' }}
                    onClick={() => setServerUrl(server.url)}
                    aria-label={`Use ${server.url}`}
                  >
                    <div className="fw-bold">{server.url}</div>
                    <small className="text-muted">
                      Score: {server.score}% • Tested {new Date(server.timestamp).toLocaleString()}
                    </small>
                  </button>
                  <button
                    className="btn btn-sm btn-outline-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeServer(server.url);
                    }}
                    title={`Remove ${server.url} from history`}
                    aria-label={`Remove ${server.url} from history`}
                  >
                    <span aria-hidden="true">&times;</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {isRunning && (
        <div className="progress mb-3">
          <div
            className="progress-bar progress-bar-striped progress-bar-animated"
            role="progressbar"
            aria-label="Report progress"
            aria-valuenow={Math.min(progress.length * 10, 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{ width: `${Math.min(progress.length * 10, 100)}%` }}
          />
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
            <h3 className={`text-${getScoreColor(reportPercentage)}`}>
              Final Score: {report.finalScore} / {reportMaxScore} ({Math.round(reportPercentage)}% · {getScoreGrade(reportPercentage)})
            </h3>
            {!report.sections.security && (
              <small className="text-muted">
                OAuth security metadata was not included in this run; the base report is scored out of {reportMaxScore} points.
              </small>
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
                    const authenticationUrl = report.authenticationUrl || report.serverUrl;
                    // Store the current state so we can return after OAuth
                    sessionStorage.setItem('oauth_return_view', JSON.stringify({
                      activeView: 'report',
                      serverUrl: authenticationUrl,
                      timestamp: Date.now()
                    }));
                    
                    // Start OAuth flow directly
                    try {
                      const { generatePKCE } = await import('../utils/pkce');
                      const { v4: uuidv4 } = await import('uuid');
                      
                      const oauthConfig = await getOAuthConfig(authenticationUrl);
                      if (!oauthConfig) {
                        alert('Failed to get OAuth configuration');
                        return;
                      }
                      
                      const { code_verifier: codeVerifier, code_challenge: codeChallenge } = await generatePKCE();
                      sessionStorage.setItem('pkce_code_verifier', codeVerifier);
                      sessionStorage.setItem('oauth_server_url', authenticationUrl);
                      
                      const serverHost = new URL(authenticationUrl.startsWith('http') ? authenticationUrl : `https://${authenticationUrl}`).hostname;
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
              {scoredSections.map(([key, section]) => {
                const sectionPercentage = section.maxScore > 0
                  ? section.score / section.maxScore * 100
                  : 0;

                return (
                <div key={key} className="col-12">
                  <div className="card h-100 shadow-sm">
                    <div className="card-header">
                      <div className="d-flex justify-content-between align-items-start mb-2">
                        <h5 className="mb-0">{section.name}</h5>
                        <div className="d-flex align-items-center gap-2">
                          <span className={`text-${getScoreColor(sectionPercentage)} fw-bold`}>
                            {section.score} / {section.maxScore} points
                          </span>
                          <span className={`badge bg-${getScoreColor(sectionPercentage)}`}>
                            {Math.round(sectionPercentage)}%
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
                                    {hasMoreInfo ? (
                                      <button
                                        type="button"
                                        className="d-flex align-items-center w-100 text-start border-0 bg-transparent rounded px-1"
                                        onClick={() => toggleItemExpanded(itemKey)}
                                        aria-expanded={isExpanded}
                                        aria-controls={`${itemKey}-details`}
                                      >
                                        <span className="flex-grow-1">{detailText.substring(2)}</span>
                                        <span 
                                          className="text-muted ms-2" 
                                          style={{ fontSize: '0.875rem' }}
                                          aria-hidden="true"
                                        >
                                          {isExpanded ? '▼' : '▶'}
                                        </span>
                                      </button>
                                    ) : (
                                      <div className="px-1">{detailText.substring(2)}</div>
                                    )}
                                    {isExpanded && (
                                      <div id={`${itemKey}-details`} className="mt-2" style={{ marginLeft: '20px' }}>
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
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportView;
