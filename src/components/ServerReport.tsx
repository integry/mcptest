import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { evaluateServer, EvaluationResult, EvaluationProgress } from '../services/serverEvaluation';
import { useAuth } from '../context/AuthContext';

interface ScoreBreakdownProps {
  category: string;
  score: number;
  maxScore: number;
  details?: string;
}

const ScoreBreakdown: React.FC<ScoreBreakdownProps> = ({ category, score, maxScore, details }) => {
  const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;
  const getColorClass = () => {
    if (percentage >= 90) return 'bg-success';
    if (percentage >= 70) return 'bg-warning';
    if (percentage >= 50) return 'bg-danger';
    return 'bg-secondary';
  };

  return (
    <div className="mb-3">
      <div className="d-flex justify-content-between align-items-center mb-1">
        <span className="fw-bold">{category}</span>
        <span>{score} / {maxScore}</span>
      </div>
      <div className="progress" style={{ height: '20px' }}>
        <div
          className={`progress-bar ${getColorClass()}`}
          role="progressbar"
          style={{ width: `${percentage}%` }}
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={maxScore}
        />
      </div>
      {details && (
        <small className="text-muted d-block mt-1">{details}</small>
      )}
    </div>
  );
};

interface ProgressIndicatorProps {
  progress: EvaluationProgress;
}

const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({ progress }) => {
  const totalSteps = 5;
  const currentStep = ['protocol', 'transport', 'security', 'cors', 'performance'].indexOf(progress.currentCategory) + 1;
  const progressPercentage = (currentStep / totalSteps) * 100;

  return (
    <div className="card mb-4">
      <div className="card-body">
        <h5 className="card-title mb-3">Evaluation Progress</h5>
        <div className="progress mb-3" style={{ height: '30px' }}>
          <div
            className="progress-bar progress-bar-striped progress-bar-animated"
            role="progressbar"
            style={{ width: `${progressPercentage}%` }}
            aria-valuenow={progressPercentage}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            {Math.round(progressPercentage)}%
          </div>
        </div>
        <div className="d-flex align-items-center">
          <div className="spinner-border spinner-border-sm text-primary me-2" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <span>
            <strong>Currently evaluating:</strong> {progress.message}
          </span>
        </div>
        {progress.details && (
          <div className="mt-2 text-muted small">
            {progress.details}
          </div>
        )}
      </div>
    </div>
  );
};

const ServerReport: React.FC = () => {
  const { serverHost } = useParams<{ serverHost: string }>();
  const navigate = useNavigate();
  const { currentUser, getAuthToken } = useAuth();
  const [evaluationResult, setEvaluationResult] = useState<EvaluationResult | null>(null);
  const [progress, setProgress] = useState<EvaluationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);

  const serverUrl = serverHost ? `https://${serverHost}/mcp` : '';

  const runEvaluation = useCallback(async () => {
    if (!serverUrl) {
      setError('Invalid server URL');
      return;
    }

    setIsEvaluating(true);
    setError(null);
    setProgress(null);
    setEvaluationResult(null);

    try {
      // Get auth token if user is logged in
      const authToken = currentUser ? await getAuthToken() : null;
      
      const result = await evaluateServer(serverUrl, authToken, (progress) => {
        setProgress(progress);
      });
      
      setEvaluationResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to evaluate server');
    } finally {
      setIsEvaluating(false);
    }
  }, [serverUrl, currentUser, getAuthToken]);

  useEffect(() => {
    if (serverUrl) {
      runEvaluation();
    }
  }, [serverUrl]);

  const getGradeFromScore = (score: number): string => {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B+';
    if (score >= 70) return 'B';
    if (score >= 60) return 'C+';
    if (score >= 50) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  };

  const getGradeColor = (grade: string): string => {
    if (grade.startsWith('A')) return 'text-success';
    if (grade.startsWith('B')) return 'text-warning';
    if (grade.startsWith('C')) return 'text-warning';
    return 'text-danger';
  };

  if (!serverHost) {
    return (
      <div className="container-fluid mt-4">
        <div className="row">
          <div className="col-lg-8 mx-auto">
            <h2 className="mb-4">MCP Server Evaluation Report</h2>
            <div className="card">
              <div className="card-body">
                <h5 className="card-title">Welcome to the MCP Server Report Tool</h5>
                <p className="card-text">
                  This tool provides a comprehensive evaluation of Model Context Protocol (MCP) servers, 
                  testing their compliance, security, performance, and overall quality.
                </p>
                <hr />
                <h6>How to use:</h6>
                <ol>
                  <li>Enter a server URL in the format: <code>https://example.com/mcp</code></li>
                  <li>The tool will evaluate the server across 5 key categories</li>
                  <li>You'll receive a detailed report card with scores and recommendations</li>
                </ol>
                <div className="mt-4">
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    const formData = new FormData(e.currentTarget);
                    const serverUrl = formData.get('serverUrl') as string;
                    if (serverUrl) {
                      try {
                        const url = new URL(serverUrl);
                        navigate(`/report/${url.hostname}`);
                      } catch (err) {
                        alert('Please enter a valid URL');
                      }
                    }
                  }}>
                    <div className="input-group">
                      <input
                        type="url"
                        name="serverUrl"
                        className="form-control"
                        placeholder="https://example.com/mcp"
                        required
                      />
                      <button type="submit" className="btn btn-primary">
                        <i className="bi bi-play-fill me-2"></i>Run Evaluation
                      </button>
                    </div>
                  </form>
                </div>
                <div className="mt-4">
                  <h6>Evaluation Categories:</h6>
                  <ul>
                    <li><strong>Core Protocol Adherence (15 points):</strong> Tests MCP specification compliance</li>
                    <li><strong>Transport Layer Modernity (15 points):</strong> Checks for modern transport support</li>
                    <li><strong>Security Posture (40 points):</strong> Validates OAuth 2.1 implementation</li>
                    <li><strong>Web Client Accessibility (15 points):</strong> Tests CORS configuration</li>
                    <li><strong>Performance Baseline (15 points):</strong> Measures response latency</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid mt-4">
      <div className="row">
        <div className="col-lg-8 mx-auto">
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h2>MCP Server Evaluation Report</h2>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => navigate('/')}
            >
              <i className="bi bi-arrow-left me-2"></i>Back to Playground
            </button>
          </div>

          <div className="card mb-4">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <h5 className="card-title mb-1">Server: {serverHost}</h5>
                  <p className="text-muted mb-0">URL: {serverUrl}</p>
                </div>
                <div>
                  <button
                    className="btn btn-primary"
                    onClick={runEvaluation}
                    disabled={isEvaluating}
                  >
                    {isEvaluating ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" role="status">
                          <span className="visually-hidden">Loading...</span>
                        </span>
                        Evaluating...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-arrow-clockwise me-2"></i>Re-run Evaluation
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="alert alert-danger mb-4">
              <i className="bi bi-exclamation-triangle me-2"></i>
              {error}
            </div>
          )}

          {isEvaluating && progress && <ProgressIndicator progress={progress} />}

          {evaluationResult && (
            <>
              <div className="card mb-4">
                <div className="card-body text-center">
                  <h3 className="card-title">Overall Score</h3>
                  <div className="display-1 mb-3">
                    <span className={getGradeColor(getGradeFromScore(evaluationResult.totalScore))}>
                      {evaluationResult.totalScore}
                    </span>
                    <span className="fs-3 text-muted"> / 100</span>
                  </div>
                  <div className={`display-4 ${getGradeColor(getGradeFromScore(evaluationResult.totalScore))}`}>
                    Grade: {getGradeFromScore(evaluationResult.totalScore)}
                  </div>
                  <p className="text-muted mt-3">
                    Evaluation Date: {new Date(evaluationResult.timestamp).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="card mb-4">
                <div className="card-header">
                  <h5 className="mb-0">Score Breakdown</h5>
                </div>
                <div className="card-body">
                  <ScoreBreakdown
                    category="I. Core Protocol Adherence"
                    score={evaluationResult.categories.protocol.score}
                    maxScore={15}
                    details={evaluationResult.categories.protocol.details}
                  />
                  <ScoreBreakdown
                    category="II. Transport Layer Modernity"
                    score={evaluationResult.categories.transport.score}
                    maxScore={15}
                    details={evaluationResult.categories.transport.details}
                  />
                  <ScoreBreakdown
                    category="III. Security Posture (OAuth 2.1)"
                    score={evaluationResult.categories.security.score}
                    maxScore={40}
                    details={evaluationResult.categories.security.details}
                  />
                  <ScoreBreakdown
                    category="IV. Web Client Accessibility (CORS)"
                    score={evaluationResult.categories.cors.score}
                    maxScore={15}
                    details={evaluationResult.categories.cors.details}
                  />
                  <ScoreBreakdown
                    category="V. Performance Baseline (Latency)"
                    score={evaluationResult.categories.performance.score}
                    maxScore={15}
                    details={evaluationResult.categories.performance.details}
                  />
                </div>
              </div>

              <div className="card mb-4">
                <div className="card-header">
                  <h5 className="mb-0">Key Findings</h5>
                </div>
                <div className="card-body">
                  <div className="mb-3">
                    <h6 className="text-success">
                      <i className="bi bi-check-circle me-2"></i>Strengths
                    </h6>
                    <ul className="mb-0">
                      {evaluationResult.summary.strengths.map((strength, index) => (
                        <li key={index}>{strength}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="mb-3">
                    <h6 className="text-warning">
                      <i className="bi bi-exclamation-circle me-2"></i>Weaknesses
                    </h6>
                    <ul className="mb-0">
                      {evaluationResult.summary.weaknesses.map((weakness, index) => (
                        <li key={index}>{weakness}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h6 className="text-info">
                      <i className="bi bi-info-circle me-2"></i>Recommendations
                    </h6>
                    <ul className="mb-0">
                      {evaluationResult.summary.recommendations.map((rec, index) => (
                        <li key={index}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-body">
                  <h5 className="card-title">Detailed Test Results</h5>
                  <pre className="bg-light p-3 rounded" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {JSON.stringify(evaluationResult.rawResults, null, 2)}
                  </pre>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ServerReport;