import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getOAuthConfig, discoverOAuthEndpoints } from '../utils/oauthDiscovery';

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
  const { currentUser } = useAuth();
  const [serverUrl, setServerUrl] = useState('');
  const [report, setReport] = useState<any>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (urlParam) {
      setServerUrl(decodeURIComponent(urlParam));
      handleRunReport(decodeURIComponent(urlParam));
    }
  }, [urlParam]);

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
          serverUrl: serverUrl
        }));
        
        // Redirect to OAuth flow
        const confirmAuth = confirm('This server requires OAuth authentication. Would you like to authenticate now?');
        if (confirmAuth) {
          // Navigate to connection panel to handle OAuth
          navigate('/', { state: { serverUrl, needsAuth: true } });
          return false;
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
    if (isRunning) return;

    setIsRunning(true);
    setProgress(['Starting evaluation...']);
    setReport(null);
    navigate(`/report/${encodeURIComponent(urlToTest)}`);

    // Check if OAuth authentication is needed
    const canProceed = await checkOAuthAuthentication(urlToTest);
    if (!canProceed) {
      setIsRunning(false);
      return;
    }

    const worker = new Worker(new URL('../workers/reportWorker.ts', import.meta.url), { type: 'module' });

    worker.onmessage = (e) => {
      const { type, data } = e.data;
      if (type === 'progress') {
        setProgress(prev => [...prev, data]);
      } else if (type === 'complete') {
        setReport(data);
        setIsRunning(false);
        worker.terminate();
        
        // If authentication is required, show a button to authenticate
        if (data && data.sections && data.sections.auth) {
          setProgress(prev => [...prev, 'Authentication required. Please authenticate with the server and run the report again.']);
        }
      }
    };

    worker.postMessage({ serverUrl: urlToTest, token: await currentUser.getIdToken() });
  };

  return (
    <div className="container-fluid h-100 d-flex flex-column">
      <h2>MCP Server Report Card</h2>
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

      {isRunning && (
        <div className="progress mb-3">
          <div className="progress-bar progress-bar-striped progress-bar-animated" style={{ width: `${(progress.length / 10) * 100}%` }}></div>
        </div>
      )}

      {progress.length > 0 && (
        <div className="card mb-3">
          <div className="card-header">Progress</div>
          <ul className="list-group list-group-flush">
            {progress.map((p, i) => <li key={i} className="list-group-item">{p}</li>)}
          </ul>
        </div>
      )}

      {report && (
        <div className="card">
          <div className="card-header">
            <h4>Report for: {report.serverUrl}</h4>
            <h3 className={`text-${getScoreColor(report.finalScore)}`}>
              Final Score: {report.finalScore} / 100 ({getScoreGrade(report.finalScore)})
            </h3>
          </div>
          <div className="card-body">
            {report.sections && report.sections.auth && (
              <div className="alert alert-warning mb-3">
                <h5>OAuth Authentication Required</h5>
                <p>This server requires OAuth authentication before it can be evaluated.</p>
                <button 
                  className="btn btn-primary"
                  onClick={() => {
                    // Store the current state so we can return after OAuth
                    sessionStorage.setItem('oauth_return_view', JSON.stringify({
                      activeView: 'report',
                      serverUrl: report.serverUrl
                    }));
                    navigate('/', { state: { serverUrl: report.serverUrl, needsAuth: true } });
                  }}
                >
                  Authenticate with Server
                </button>
              </div>
            )}
            <div className="row">
              {Object.entries(report.sections as Record<string, any>).map(([key, section]) => (
                <div key={key} className="col-12 mb-3">
                  <div className="card">
                    <div className="card-header">
                      <h5>{section.name}</h5>
                      <span className={`badge bg-${getScoreColor(section.score / section.maxScore * 100)}`}>
                        {section.score} / {section.maxScore} points
                      </span>
                    </div>
                    <div className="card-body">
                      <p>{section.description}</p>
                      {section.details && (
                        <ul className="list-group">
                          {section.details.map((detail: string, i: number) => (
                            <li key={i} className="list-group-item">{detail}</li>
                          ))}
                        </ul>
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