import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import OAuthConfig from './OAuthConfig';
import ReportAuthorizationGate from './ReportAuthorizationGate';
import ReleaseReadinessReport from './ReleaseReadinessReport';
import {
  beginOAuthFlow,
  isOAuthClientConfigurationRequired,
  loadOAuthAuthorization,
  prepareManualOAuthClient,
} from '../utils/oauthFlow';
import {
  evaluateServer,
  resolveEvaluationOutcome,
  type EvaluationReport,
} from '../utils/evaluation';
import {
  createTestedServerHistoryEntry,
  getTestedServerResultLabel,
  type TestedServerHistoryEntry,
  upsertTestedServerHistoryEntry,
} from '../utils/reportPresentation';
import { getStoredOAuthTrace } from '../utils/oauthTrace';

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
  const [testedServers, setTestedServers] = useState<TestedServerHistoryEntry[]>([]);
  const [oauthConfigServerUrl, setOAuthConfigServerUrl] = useState<string | null>(null);
  const [oauthAction, setOAuthAction] = useState<'authorize' | 'configure' | null>(null);
  const [oauthError, setOAuthError] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  // Track if initial report has been triggered
  const [hasInitialized, setHasInitialized] = useState(false);
  const isRunningRef = useRef(false);
  const hasProcessedOAuthReturn = useRef(false);
  
  // Store handleRunReport in a ref to avoid dependency issues
  const handleRunReportRef = useRef<((urlToTest: string) => Promise<void>) | null>(null);
  
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

  const addOrUpdateServer = useCallback((reportData: EvaluationReport) => {
    const newServer = createTestedServerHistoryEntry(reportData);
    setTestedServers((currentServers) => {
      const updatedServers = upsertTestedServerHistoryEntry(currentServers, newServer);
      localStorage.setItem('mcpTestedServers', JSON.stringify(updatedServers));
      return updatedServers;
    });
  }, []);

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
    setOAuthError(null);
    setReportError(null);
    setProgress(['Starting evaluation...']);
    setReport(null);
    
    // Only navigate if we're not already on the correct URL
    const currentReportUrl = urlParam ? decodeURIComponent(urlParam) : '';
    if (currentReportUrl !== urlToTest) {
      navigate(`/report/${encodeURIComponent(urlToTest)}`);
    }

    // Get the exact resource's issuer-bound OAuth access token if available.
    const oauthAccessToken = loadOAuthAuthorization(urlToTest)?.accessToken;
    
    // Get Firebase auth token
    const token = await currentUser.getIdToken();
    
    // Progress callback
    const onProgress = (message: string) => {
      setProgress(prev => [...prev, message]);
    };
    
    try {
      const reportData = await evaluateServer(urlToTest, token, onProgress, oauthAccessToken);
      setReport(reportData);
      
      addOrUpdateServer(reportData);
      
      if (resolveEvaluationOutcome(reportData) === 'authorization-required') {
        setProgress(prev => [...prev, 'OAuth authorization is required before this server can be scored.']);
      }
    } catch (error) {
      console.error('Report error:', error);
      const message = (error as Error).message;
      setProgress(prev => [...prev, `Error: ${message}`]);
      setReportError(message);
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

  const startOAuth = useCallback(async (authenticationUrl: string) => {
    setOAuthAction('authorize');
    setOAuthError(null);
    sessionStorage.setItem('oauth_return_view', JSON.stringify({
      activeView: 'report',
      serverUrl: authenticationUrl,
      timestamp: Date.now()
    }));

    try {
      const result = await beginOAuthFlow(authenticationUrl, {
        deferAuthorizedTraceOutcome: true,
      });
      if (result === 'AUTHORIZED') {
        await handleRunReportRef.current?.(authenticationUrl);
      }
    } catch (error) {
      if (isOAuthClientConfigurationRequired(error)) {
        setOAuthConfigServerUrl(authenticationUrl);
        return;
      }
      const message = error instanceof Error ? error.message : 'Unknown OAuth error';
      setOAuthError(`OAuth authorization could not start: ${message}`);
    } finally {
      setOAuthAction(null);
    }
  }, []);

  const configureOAuthClient = useCallback(async (authenticationUrl: string) => {
    setOAuthAction('configure');
    setOAuthError(null);
    try {
      await prepareManualOAuthClient(authenticationUrl);
      setOAuthConfigServerUrl(authenticationUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown OAuth discovery error';
      setOAuthError(`OAuth provider discovery failed: ${message}`);
    } finally {
      setOAuthAction(null);
    }
  }, []);

  const reportOutcome = report ? resolveEvaluationOutcome(report) : undefined;
  const reportRequiresAuthorization = reportOutcome === 'authorization-required';
  const oauthTrace = report && typeof sessionStorage !== 'undefined'
    ? getStoredOAuthTrace(report.authenticationUrl || report.serverUrl, sessionStorage)
      || getStoredOAuthTrace(report.serverUrl, sessionStorage)
    : undefined;

  return (
    <div className="container-fluid h-100 d-flex flex-column" style={{ paddingBottom: '2rem' }}>
      <h2 className="mb-3">MCP release-readiness report</h2>
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
                      {getTestedServerResultLabel(server)}. Tested {new Date(server.timestamp).toLocaleString()}
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
        <div className="report-state report-state-loading mb-3" role="status" aria-live="polite">
          <div className="d-flex align-items-center gap-2 mb-2">
            <span className="spinner-border spinner-border-sm" aria-hidden="true"></span>
            <strong>Building release-readiness report</strong>
          </div>
          <div className="progress">
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
          <span className="visually-hidden">{progress[progress.length - 1] || 'Starting evaluation'}</span>
        </div>
      )}

      {reportError && !isRunning && (
        <div className="report-state report-state-failure mb-3" role="alert">
          <h3>Report could not be completed</h3>
          <p className="mb-0">{reportError}</p>
        </div>
      )}

      {progress.length > 0 && !report && !reportError && (
        <div className="card mb-3">
          <div className="card-header">Progress</div>
          <ul className="list-group list-group-flush">
            {progress.map((p, i) => <li key={i} className="list-group-item">{p}</li>)}
          </ul>
        </div>
      )}

      {!isRunning && !report && progress.length === 0 && !reportError && (
        <section className="report-state report-state-empty mb-3" aria-labelledby="empty-report-title">
          <i className="bi bi-clipboard2-check" aria-hidden="true"></i>
          <div>
            <h3 id="empty-report-title">No report yet</h3>
            <p className="mb-0">Enter an MCP server URL to check shipping blockers, client compatibility, OAuth, and tool risk.</p>
          </div>
        </section>
      )}

      {report && (
        <div className="card mb-4">
          <div className="card-header">
            <h4 className="report-target-title mb-0">Report for: {report.serverUrl}</h4>
          </div>
          <div className="card-body">
            <ReleaseReadinessReport
              report={report}
              oauthTrace={oauthTrace}
              expandedItems={expandedItems}
              onToggleItem={toggleItemExpanded}
            />
            {reportRequiresAuthorization && (
              <ReportAuthorizationGate
                serverUrl={report.serverUrl}
                error={oauthError}
                isAuthorizing={oauthAction === 'authorize'}
                isPreparingClient={oauthAction === 'configure'}
                onAuthorize={() => startOAuth(report.authenticationUrl || report.serverUrl)}
                onConfigureClient={() => configureOAuthClient(report.authenticationUrl || report.serverUrl)}
              />
            )}
          </div>
        </div>
      )}
      {oauthConfigServerUrl && (
        <OAuthConfig
          serverUrl={oauthConfigServerUrl}
          onConfigured={async () => {
            const configuredServerUrl = oauthConfigServerUrl;
            setOAuthConfigServerUrl(null);
            await startOAuth(configuredServerUrl);
          }}
          onCancel={() => setOAuthConfigServerUrl(null)}
        />
      )}
    </div>
  );
};

export default ReportView;
