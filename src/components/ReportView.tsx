import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import OAuthConfig from './OAuthConfig';
import ReportAuthorizationGate from './ReportAuthorizationGate';
import ReleaseReadinessReport from './ReleaseReadinessReport';
import ReportHistory from './ReportHistory';
import {
  beginOAuthFlow,
  getOAuthPrerequisite,
  isOAuthClientConfigurationRequired,
  loadOAuthAuthorization,
  prepareManualOAuthClient,
  type OAuthPrerequisite,
} from '../utils/oauthFlow';
import {
  evaluateServer,
  isProxyAuthenticationRequired,
  isTargetAuthenticationRequired,
  resolveEvaluationOutcome,
  type EvaluationAuthorizationContext,
  type EvaluationReport,
} from '../utils/evaluation';
import {
  createTestedServerHistoryEntry,
  getTestedServerResultLabel,
  type TestedServerHistoryEntry,
  upsertTestedServerHistoryEntry,
} from '../utils/reportPresentation';
import { getStoredOAuthTrace, type OAuthTraceV1 } from '../utils/oauthTrace';
import { createObservedServerFacts } from '../utils/releaseReadiness';
import {
  createReportSnapshot,
  deleteAllReportSnapshots,
  deleteReportSnapshot,
  loadReportSnapshots,
  REPORT_HISTORY_STORAGE_KEY,
  saveReportSnapshotHistoryDownload,
  storeReportSnapshot,
  type ReportSnapshotV1,
} from '../utils/reportHistory';

type StaticAuthorizationScheme = 'bearer' | 'api-key';

export const getAuthorizationGateOptions = (
  report: EvaluationReport,
  trace?: OAuthTraceV1
): {
  offersOAuth: boolean;
  staticSchemes: StaticAuthorizationScheme[];
  isUnknown: boolean;
} => {
  const schemes = createObservedServerFacts(report, trace).authorization.schemes.value;
  if (schemes === 'unknown' || schemes.length === 0) {
    return { offersOAuth: false, staticSchemes: [], isUnknown: true };
  }
  return {
    offersOAuth: schemes.includes('oauth'),
    staticSchemes: schemes.filter((scheme): scheme is StaticAuthorizationScheme => (
      scheme === 'bearer' || scheme === 'api-key'
    )),
    isUnknown: false,
  };
};

const targetAuthenticateChallenge = (report: EvaluationReport): string | undefined => (
  Object.values(report.sections).flatMap((section) => section.details)
    .map((detail) => detail.metadata)
    .filter((metadata): metadata is Record<string, unknown> => (
      Boolean(metadata) && typeof metadata === 'object' && !Array.isArray(metadata)
    ))
    .filter((metadata) => metadata.authenticationSource !== 'proxy')
    .flatMap((metadata) => {
      const headers = metadata.responseHeaders;
      if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return [];
      const challenge = Object.entries(headers).find(([name, value]) => (
        name.toLowerCase() === 'www-authenticate' && typeof value === 'string'
      ))?.[1];
      return typeof challenge === 'string' ? [challenge] : [];
    })[0]
);

export const getStaticCredentialHeaders = (
  report: EvaluationReport,
  scheme: 'bearer' | 'api-key',
  credential: string,
  apiKeyHeader?: 'x-api-key' | 'api-key' | 'authorization'
): Record<string, string> => {
  const trimmedCredential = credential.trim();
  if (scheme === 'bearer') {
    return {
      Authorization: /^Bearer\s/i.test(trimmedCredential)
        ? trimmedCredential
        : `Bearer ${trimmedCredential}`,
    };
  }

  if (apiKeyHeader === 'authorization') {
    return {
      Authorization: /^ApiKey\s/i.test(trimmedCredential)
        ? trimmedCredential
        : `ApiKey ${trimmedCredential}`,
    };
  }
  if (apiKeyHeader) return { [apiKeyHeader]: trimmedCredential };

  const apiKeyScheme = targetAuthenticateChallenge(report)
    ?.match(/(?:^|,\s*)(ApiKey|Api-Key|x-api-key)(?=\s|,|$)/i)?.[1];
  if (apiKeyScheme && apiKeyScheme.toLowerCase() !== 'x-api-key') {
    return {
      Authorization: new RegExp(`^${apiKeyScheme}\\s`, 'i').test(trimmedCredential)
        ? trimmedCredential
        : `${apiKeyScheme} ${trimmedCredential}`,
    };
  }

  return { 'x-api-key': trimmedCredential };
};

export const getOAuthTraceForEvaluation = (
  report: EvaluationReport,
  evaluationStartedAt: number,
  storage: Pick<Storage, 'getItem' | 'setItem'>
): OAuthTraceV1 | undefined => {
  const targetUrls = [...new Set([report.authenticationUrl, report.serverUrl].filter(
    (value): value is string => Boolean(value)
  ))];
  return targetUrls
    .map((targetUrl) => getStoredOAuthTrace(targetUrl, storage))
    .find((trace) => trace?.events.some((event) => (
      Date.parse(event.timestamp) >= evaluationStartedAt
    )));
};

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
  const [oauthPrerequisite, setOAuthPrerequisite] = useState<OAuthPrerequisite | null>(null);
  const [oauthAction, setOAuthAction] = useState<'authorize' | 'configure' | null>(null);
  const [oauthError, setOAuthError] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [staticCredential, setStaticCredential] = useState('');
  const [staticCredentialError, setStaticCredentialError] = useState<string | null>(null);
  const [staticAuthorizationScheme, setStaticAuthorizationScheme] = useState<StaticAuthorizationScheme>('bearer');
  const [unknownAuthorizationScheme, setUnknownAuthorizationScheme] = useState<'bearer' | 'api-key'>('bearer');
  const [apiKeyHeader, setApiKeyHeader] = useState<'x-api-key' | 'api-key' | 'authorization'>('x-api-key');
  const [oauthTrace, setOAuthTrace] = useState<OAuthTraceV1 | undefined>();
  const [reportSnapshots, setReportSnapshots] = useState<ReportSnapshotV1[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Track if initial report has been triggered
  const [hasInitialized, setHasInitialized] = useState(false);
  const isRunningRef = useRef(false);
  const hasProcessedOAuthReturn = useRef(false);
  const oauthChallengeRef = useRef<{
    authenticationUrl: string;
    resourceMetadataUrl?: string;
    scope?: string;
  } | null>(null);
  
  // Store handleRunReport in a ref to avoid dependency issues
  const handleRunReportRef = useRef<((
    urlToTest: string,
    targetHeaders?: Record<string, string>,
    authorizationContext?: EvaluationAuthorizationContext
  ) => Promise<void>) | null>(null);
  
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
    let storage: Storage;
    try {
      storage = window.localStorage;
    } catch (e) {
      console.error('Failed to access browser storage for report history', e);
      setHistoryError('Report history could not be loaded because browser storage is unavailable.');
      return;
    }
    try {
      const savedServers = storage.getItem('mcpTestedServers');
      if (savedServers) {
        setTestedServers(JSON.parse(savedServers));
      }
    } catch (e) {
      console.error("Failed to load servers from localStorage", e);
    }
    try {
      const rawSnapshots = storage.getItem(REPORT_HISTORY_STORAGE_KEY);
      setReportSnapshots(loadReportSnapshots({ getItem: () => rawSnapshots }));
    } catch (e) {
      console.error('Failed to load report history from browser storage', e);
      setHistoryError('Report history could not be loaded because browser storage is unavailable.');
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

  const handleRunReport = useCallback(async (
    urlToTest: string,
    targetHeaders?: Record<string, string>,
    authorizationContext?: EvaluationAuthorizationContext
  ) => {
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
    if (!targetHeaders) {
      setStaticCredential('');
      setStaticCredentialError(null);
    }
    setProgress(['Starting evaluation...']);
    setReport(null);
    setOAuthTrace(undefined);
    oauthChallengeRef.current = null;
    
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
      const evaluationStartedAt = Date.now();
      const reportData = await evaluateServer(
        urlToTest,
        token,
        onProgress,
        oauthAccessToken,
        targetHeaders,
        authorizationContext
      );
      if (isTargetAuthenticationRequired(reportData)) {
        oauthChallengeRef.current = {
          authenticationUrl: reportData.authenticationUrl || reportData.serverUrl,
          ...(reportData.resourceMetadataUrl
            ? { resourceMetadataUrl: reportData.resourceMetadataUrl }
            : {}),
          ...(reportData.scope ? { scope: reportData.scope } : {}),
        };
      }
      setReport(reportData);
      let evaluationTrace: OAuthTraceV1 | undefined;
      if (typeof sessionStorage !== 'undefined') {
        evaluationTrace = getOAuthTraceForEvaluation(reportData, evaluationStartedAt, sessionStorage);
        setOAuthTrace(evaluationTrace);
      }
      try {
        const snapshot = createReportSnapshot(reportData, evaluationTrace);
        setReportSnapshots(storeReportSnapshot(snapshot, localStorage));
        setHistoryError(null);
      } catch (snapshotError) {
        console.error('Failed to store report snapshot:', snapshotError);
        setHistoryError('This report completed, but its local snapshot could not be saved. Browser storage may be full or unavailable.');
      }
      
      addOrUpdateServer(reportData);
      
      if (resolveEvaluationOutcome(reportData) === 'authorization-required') {
        if (isProxyAuthenticationRequired(reportData)) {
          setProgress(prev => [...prev,
            'A valid mcptest login is required before the proxy can observe the target; this run was not scored.'
          ]);
          return;
        }
        const options = getAuthorizationGateOptions(reportData);
        const requirements = [
          options.offersOAuth ? 'OAuth authorization' : undefined,
          options.staticSchemes.includes('bearer') ? 'a bearer token' : undefined,
          options.staticSchemes.includes('api-key') ? 'an API key' : undefined,
        ].filter((value): value is string => Boolean(value));
        const requirement = requirements.length > 0
          ? requirements.join(' or ')
          : 'Target authorization';
        setProgress(prev => [...prev, `${requirement} is required before this server can be scored.`]);
        if (targetHeaders) {
          setStaticCredentialError(
            'The target credential was rejected. Check it and retry.'
          );
        }
      } else if (targetHeaders) {
        setStaticCredential('');
        setStaticCredentialError(null);
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
      const proxyUrl = import.meta.env.VITE_PROXY_URL as string | undefined;
      const discoveryProxyToken = proxyUrl && currentUser
        ? await currentUser.getIdToken()
        : undefined;
      const challenge = oauthChallengeRef.current?.authenticationUrl === authenticationUrl
        ? oauthChallengeRef.current
        : undefined;
      const result = await beginOAuthFlow(authenticationUrl, {
        ...(challenge?.resourceMetadataUrl
          ? { resourceMetadataUrl: challenge.resourceMetadataUrl }
          : {}),
        ...(challenge?.scope ? { scope: challenge.scope } : {}),
        ...(proxyUrl && discoveryProxyToken
          ? {
              discoveryProxy: {
                url: proxyUrl,
                authorizationToken: discoveryProxyToken,
              },
            }
          : {}),
        deferAuthorizedTraceOutcome: true,
      });
      if (result === 'AUTHORIZED') {
        await handleRunReportRef.current?.(authenticationUrl);
      }
    } catch (error) {
      const prerequisite = getOAuthPrerequisite(error);
      if (isOAuthClientConfigurationRequired(error) || prerequisite) {
        setOAuthConfigServerUrl(authenticationUrl);
        setOAuthPrerequisite(prerequisite || null);
        return;
      }
      const message = error instanceof Error ? error.message : 'Unknown OAuth error';
      setOAuthError(`OAuth authorization could not start: ${message}`);
    } finally {
      setOAuthAction(null);
    }
  }, [currentUser]);

  const configureOAuthClient = useCallback(async (authenticationUrl: string) => {
    setOAuthAction('configure');
    setOAuthError(null);
    sessionStorage.setItem('oauth_return_view', JSON.stringify({
      activeView: 'report',
      serverUrl: authenticationUrl,
      timestamp: Date.now()
    }));

    try {
      const proxyUrl = import.meta.env.VITE_PROXY_URL as string | undefined;
      const discoveryProxyToken = proxyUrl && currentUser
        ? await currentUser.getIdToken()
        : undefined;
      const challenge = oauthChallengeRef.current?.authenticationUrl === authenticationUrl
        ? oauthChallengeRef.current
        : undefined;
      await prepareManualOAuthClient(authenticationUrl, {
        ...(challenge?.resourceMetadataUrl
          ? { resourceMetadataUrl: challenge.resourceMetadataUrl }
          : {}),
        ...(proxyUrl && discoveryProxyToken
          ? {
              discoveryProxy: {
                url: proxyUrl,
                authorizationToken: discoveryProxyToken,
              },
            }
          : {}),
      });
      setOAuthConfigServerUrl(authenticationUrl);
      setOAuthPrerequisite(null);
    } catch (error) {
      const prerequisite = getOAuthPrerequisite(error);
      if (isOAuthClientConfigurationRequired(error) || prerequisite) {
        setOAuthConfigServerUrl(authenticationUrl);
        setOAuthPrerequisite(prerequisite || null);
        return;
      }
      const message = error instanceof Error ? error.message : 'Unknown OAuth discovery error';
      setOAuthError(`OAuth provider discovery failed: ${message}`);
    } finally {
      setOAuthAction(null);
    }
  }, [currentUser]);

  const reportOutcome = report ? resolveEvaluationOutcome(report) : undefined;
  const reportRequiresProxyAuthentication = report
    ? isProxyAuthenticationRequired(report)
    : false;
  const reportRequiresAuthorization = reportOutcome === 'authorization-required'
    && !reportRequiresProxyAuthentication;
  const authorizationGateOptions = report
    ? getAuthorizationGateOptions(report, oauthTrace)
    : { offersOAuth: false, staticSchemes: [], isUnknown: true };
  const selectedStaticAuthorizationScheme = authorizationGateOptions.staticSchemes.includes(
    staticAuthorizationScheme
  )
    ? staticAuthorizationScheme
    : authorizationGateOptions.staticSchemes[0];

  const retryWithStaticCredential = async (
    scheme: 'bearer' | 'api-key',
    selectedApiKeyHeader?: 'x-api-key' | 'api-key' | 'authorization'
  ) => {
    if (!report) return;
    const credential = staticCredential.trim();
    if (!credential) {
      setStaticCredentialError(
        `Enter ${scheme === 'bearer' ? 'a bearer token' : 'an API key'} before retrying.`
      );
      return;
    }
    const targetUrl = report.authenticationUrl || report.serverUrl;
    setStaticCredentialError(null);
    await handleRunReport(
      targetUrl,
      getStaticCredentialHeaders(report, scheme, credential, selectedApiKeyHeader),
      {
        priorChallenge: {
          outcome: 'challenged',
          provenance: 'direct_target',
        },
      }
    );
  };

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

      {historyError && !report && (
        <div className="alert alert-warning mb-3" role="alert">{historyError}</div>
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
            {historyError && <div className="alert alert-warning mt-3" role="alert">{historyError}</div>}
            <ReportHistory
              endpoint={report.serverUrl}
              snapshots={reportSnapshots}
              onDeleteSnapshot={(id) => {
                try {
                  const storage = window.localStorage;
                  setReportSnapshots(deleteReportSnapshot(id, storage));
                  setHistoryError(null);
                } catch (e) {
                  console.error('Failed to delete report snapshot:', e);
                  setHistoryError('The report snapshot could not be deleted. Browser storage may be unavailable.');
                }
              }}
              onDeleteAll={() => {
                if (!window.confirm('Delete all locally stored report snapshots? Other app data will be kept.')) return;
                try {
                  const storage = window.localStorage;
                  deleteAllReportSnapshots(storage);
                  setReportSnapshots([]);
                  setHistoryError(null);
                } catch (e) {
                  console.error('Failed to delete report history:', e);
                  setHistoryError('Report history could not be deleted. Browser storage may be unavailable.');
                }
              }}
              onExportAll={() => saveReportSnapshotHistoryDownload(reportSnapshots)}
            />
            {reportRequiresProxyAuthentication && (
              <section className="report-auth-gate" aria-labelledby="report-proxy-auth-title">
                <div className="report-auth-heading">
                  <div className="report-auth-icon" aria-hidden="true">
                    <i className="bi bi-person-lock"></i>
                  </div>
                  <div>
                    <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
                      <h3 id="report-proxy-auth-title" className="mb-0">mcptest login required</h3>
                      <span className="badge text-bg-warning">Not scored</span>
                    </div>
                    <p className="mb-0">
                      The authenticated proxy requested a valid mcptest login before it could return
                      target evidence. This is not target OAuth and is not an MCP server failure.
                    </p>
                  </div>
                </div>
                <div className="report-auth-note">
                  Sign in again and retry the report. Target OAuth will only be offered if the MCP
                  target subsequently returns its own authentication challenge.
                </div>
              </section>
            )}
            {reportRequiresAuthorization && authorizationGateOptions.offersOAuth && (
              <ReportAuthorizationGate
                serverUrl={report.serverUrl}
                error={oauthError}
                isAuthorizing={oauthAction === 'authorize'}
                isPreparingClient={oauthAction === 'configure'}
                onAuthorize={() => startOAuth(report.authenticationUrl || report.serverUrl)}
                onConfigureClient={() => configureOAuthClient(report.authenticationUrl || report.serverUrl)}
              />
            )}
            {reportRequiresAuthorization
              && selectedStaticAuthorizationScheme && (
              <section className="report-auth-gate" aria-labelledby="report-static-auth-title">
                <div className="report-auth-heading">
                  <div className="report-auth-icon" aria-hidden="true">
                    <i className="bi bi-key-fill"></i>
                  </div>
                  <div>
                    <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
                      <h3 id="report-static-auth-title" className="mb-0">
                        {authorizationGateOptions.staticSchemes.length > 1
                          ? 'Choose a target credential'
                          : `${selectedStaticAuthorizationScheme === 'bearer' ? 'Bearer token' : 'API key'} required`}
                      </h3>
                      <span className="badge text-bg-warning">Not scored</span>
                    </div>
                    <p className="mb-0">
                      Enter the target credential to retry this report. It is kept only in this
                      page&apos;s memory and is not saved, logged, or added to the URL.
                    </p>
                  </div>
                </div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void retryWithStaticCredential(selectedStaticAuthorizationScheme);
                  }}
                >
                  {authorizationGateOptions.staticSchemes.length > 1 && (
                    <>
                      <label className="form-label" htmlFor="report-static-auth-scheme">
                        Authentication type
                      </label>
                      <select
                        id="report-static-auth-scheme"
                        className="form-select mb-3"
                        value={selectedStaticAuthorizationScheme}
                        onChange={(event) => {
                          setStaticAuthorizationScheme(event.target.value as StaticAuthorizationScheme);
                          setStaticCredentialError(null);
                        }}
                        disabled={isRunning}
                      >
                        {authorizationGateOptions.staticSchemes.map((scheme) => (
                          <option key={scheme} value={scheme}>
                            {scheme === 'bearer' ? 'Bearer token' : 'API key'}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  <label className="form-label" htmlFor="report-static-credential">
                    {selectedStaticAuthorizationScheme === 'bearer' ? 'Bearer token' : 'API key'}
                  </label>
                  <input
                    id="report-static-credential"
                    className={`form-control${staticCredentialError ? ' is-invalid' : ''}`}
                    type="password"
                    value={staticCredential}
                    onChange={(event) => {
                      setStaticCredential(event.target.value);
                      setStaticCredentialError(null);
                    }}
                    disabled={isRunning}
                    autoComplete="new-password"
                    spellCheck={false}
                    aria-describedby={staticCredentialError ? 'report-static-credential-error' : undefined}
                  />
                  {staticCredentialError && (
                    <div id="report-static-credential-error" className="invalid-feedback">
                      {staticCredentialError}
                    </div>
                  )}
                  <button
                    type="submit"
                    className="btn btn-primary mt-3"
                    disabled={isRunning}
                  >
                    {isRunning ? 'Retrying report...' : 'Retry report with credential'}
                  </button>
                </form>
              </section>
            )}
            {reportRequiresAuthorization && authorizationGateOptions.isUnknown && (
              <section className="report-auth-gate" aria-labelledby="report-unknown-auth-title">
                <h3 id="report-unknown-auth-title">Authorization method unknown</h3>
                <p>
                  Choose the target&apos;s credential type and retry. The credential is kept only
                  in this page&apos;s memory and is not saved, logged, or added to the URL.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void retryWithStaticCredential(
                      unknownAuthorizationScheme,
                      unknownAuthorizationScheme === 'api-key' ? apiKeyHeader : undefined
                    );
                  }}
                >
                  <label className="form-label" htmlFor="report-unknown-auth-scheme">
                    Authentication type
                  </label>
                  <select
                    id="report-unknown-auth-scheme"
                    className="form-select mb-3"
                    value={unknownAuthorizationScheme}
                    onChange={(event) => {
                      setUnknownAuthorizationScheme(event.target.value as 'bearer' | 'api-key');
                      setStaticCredentialError(null);
                    }}
                    disabled={isRunning}
                  >
                    <option value="bearer">Bearer token</option>
                    <option value="api-key">API key</option>
                  </select>
                  {unknownAuthorizationScheme === 'api-key' && (
                    <>
                      <label className="form-label" htmlFor="report-api-key-header">
                        API-key header
                      </label>
                      <select
                        id="report-api-key-header"
                        className="form-select mb-3"
                        value={apiKeyHeader}
                        onChange={(event) => setApiKeyHeader(
                          event.target.value as 'x-api-key' | 'api-key' | 'authorization'
                        )}
                        disabled={isRunning}
                      >
                        <option value="x-api-key">x-api-key</option>
                        <option value="api-key">api-key</option>
                        <option value="authorization">Authorization (ApiKey value)</option>
                      </select>
                    </>
                  )}
                  <label className="form-label" htmlFor="report-unknown-static-credential">
                    {unknownAuthorizationScheme === 'bearer' ? 'Bearer token' : 'API key'}
                  </label>
                  <input
                    id="report-unknown-static-credential"
                    className={`form-control${staticCredentialError ? ' is-invalid' : ''}`}
                    type="password"
                    value={staticCredential}
                    onChange={(event) => {
                      setStaticCredential(event.target.value);
                      setStaticCredentialError(null);
                    }}
                    disabled={isRunning}
                    autoComplete="new-password"
                    spellCheck={false}
                    aria-describedby={staticCredentialError ? 'report-unknown-static-credential-error' : undefined}
                  />
                  {staticCredentialError && (
                    <div id="report-unknown-static-credential-error" className="invalid-feedback">
                      {staticCredentialError}
                    </div>
                  )}
                  <button type="submit" className="btn btn-primary mt-3" disabled={isRunning}>
                    {isRunning ? 'Retrying report...' : 'Retry report with credential'}
                  </button>
                </form>
              </section>
            )}
          </div>
        </div>
      )}
      {oauthConfigServerUrl && (
        <OAuthConfig
          serverUrl={oauthConfigServerUrl}
          prerequisite={oauthPrerequisite || undefined}
          onBearerToken={oauthPrerequisite?.supportsBearerToken ? async (token) => {
            const configuredServerUrl = oauthConfigServerUrl;
            setOAuthConfigServerUrl(null);
            setOAuthPrerequisite(null);
            // The prerequisite can follow a target challenge observed through the proxy.
            // Do not invent direct-target provenance when this continuation has no route context.
            await handleRunReport(
              configuredServerUrl,
              { Authorization: `Bearer ${token}` }
            );
          } : undefined}
          onConfigured={async () => {
            const configuredServerUrl = oauthConfigServerUrl;
            setOAuthConfigServerUrl(null);
            setOAuthPrerequisite(null);
            await startOAuth(configuredServerUrl);
          }}
          onCancel={() => {
            setOAuthConfigServerUrl(null);
            setOAuthPrerequisite(null);
          }}
        />
      )}
    </div>
  );
};

export default ReportView;
