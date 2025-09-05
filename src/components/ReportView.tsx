import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

// --- Type Definitions ---
interface ReportCategory {
  name: string;
  score: number;
  maxPoints: number;
  description: string;
}

interface Report {
  serverUrl: string;
  finalScore: number;
  grade: string;
  evaluationDate: string;
  categories: ReportCategory[];
  summary: {
    strengths: string[];
    weaknesses: string[];
  };
  performance: {
    tier: string;
    ttfb: number;
    totalTime: number;
  };
}

interface ProgressUpdate {
  stage: string;
  details: string;
  step: number;
  totalSteps: number;
}

type ReportStatus = 'idle' | 'in-progress' | 'complete' | 'error';


// --- Helper Components ---

const ProgressBar: React.FC<{ progress: ProgressUpdate }> = ({ progress }) => {
  const percentage = (progress.step / progress.totalSteps) * 100;
  return (
    <div className="mb-4">
      <div className="d-flex justify-content-between mb-1">
        <strong>{progress.stage}</strong>
        <span>Step {progress.step} of {progress.totalSteps}</span>
      </div>
      <div className="progress" style={{ height: '25px' }}>
        <div
          className="progress-bar progress-bar-striped progress-bar-animated"
          role="progressbar"
          style={{ width: `${percentage}%` }}
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
        ></div>
      </div>
      <div className="text-center mt-2 text-muted">{progress.details}</div>
    </div>
  );
};

const ReportCard: React.FC<{ report: Report, onRunAgain: () => void }> = ({ report, onRunAgain }) => {
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

    const getScoreColor = (score: number, max: number) => {
        const percentage = (score / max) * 100;
        if (percentage >= 90) return 'text-success';
        if (percentage >= 70) return 'text-primary';
        if (percentage >= 50) return 'text-warning';
        return 'text-danger';
    };

    const getGradeClass = (grade: string) => {
        if (grade.startsWith('A')) return 'bg-success text-white';
        if (grade.startsWith('B')) return 'bg-primary text-white';
        if (grade.startsWith('C')) return 'bg-warning text-dark';
        if (grade.startsWith('D')) return 'bg-warning text-dark';
        return 'bg-danger text-white';
    };

    const getFindingClass = (finding: string) => {
        if (finding.startsWith('[PASS]')) return 'text-success';
        if (finding.startsWith('[FAIL]')) return 'text-danger';
        if (finding.startsWith('[WARN]')) return 'text-warning';
        return 'text-muted';
    }

    const toggleCategory = (name: string) => {
        setExpandedCategory(expandedCategory === name ? null : name);
    }

    return (
        <div className="card shadow-sm">
            <div className="card-header d-flex justify-content-between align-items-center">
                <h3 className="mb-0">MCP Server Evaluation Report Card</h3>
                <button className="btn btn-secondary" onClick={onRunAgain}>
                    <i className="bi bi-arrow-clockwise me-2"></i>Run Again
                </button>
            </div>
            <div className="card-body">
                <div className="row mb-4">
                    <div className="col-md-8">
                        <h5>Server URL: <a href={report.serverUrl} target="_blank" rel="noopener noreferrer">{report.serverUrl}</a></h5>
                        <p className="text-muted">Evaluation Date: {report.evaluationDate}</p>
                    </div>
                    <div className="col-md-4 text-md-end">
                        <div className="final-score">
                            <span className="fs-1 fw-bold">{report.finalScore}</span>
                            <span className="fs-4">/ 100</span>
                        </div>
                        <div className={`badge fs-5 ${getGradeClass(report.grade)}`}>Grade: {report.grade}</div>
                    </div>
                </div>

                <h4 className="mb-3">Score Breakdown</h4>
                <div className="table-responsive">
                    <table className="table table-hover">
                        <thead>
                            <tr>
                                <th>Category</th>
                                <th>Description</th>
                                <th className="text-end">Score</th>
                            </tr>
                        </thead>
                        <tbody>
                            {report.categories.map(cat => (
                                <React.Fragment key={cat.name}>
                                    <tr onClick={() => toggleCategory(cat.name)} style={{ cursor: 'pointer' }} title="Click to see details">
                                        <td className="fw-bold">{cat.name}</td>
                                        <td>{cat.description}</td>
                                        <td className={`text-end fw-bold ${getScoreColor(cat.score, cat.maxPoints)}`}>
                                            {cat.score} / {cat.maxPoints}
                                        </td>
                                    </tr>
                                    {expandedCategory === cat.name && (
                                        <tr>
                                            <td colSpan={3} className="p-0">
                                                <div className="p-3 bg-light-subtle">
                                                    <h6 className="mb-2">Detailed Findings:</h6>
                                                    <ul className="list-unstyled mb-0 small">
                                                        {cat.findings.map((finding, i) => (
                                                            <li key={i} className={`mb-1 ${getFindingClass(finding)}`}>{finding}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="row mt-4">
                    <div className="col-md-6">
                        <h5><i className="bi bi-check-circle-fill text-success me-2"></i>Strengths</h5>
                        <ul className="list-group list-group-flush">
                            {report.summary.strengths.map((item, i) => <li key={i} className="list-group-item">{item}</li>)}
                        </ul>
                    </div>
                    <div className="col-md-6">
                        <h5><i className="bi bi-exclamation-triangle-fill text-warning me-2"></i>Weaknesses</h5>
                        <ul className="list-group list-group-flush">
                            {report.summary.weaknesses.map((item, i) => <li key={i} className="list-group-item">{item}</li>)}
                        </ul>
                    </div>
                </div>
                 <div className="row mt-4">
                    <div className="col-12">
                        <h5><i className="bi bi-speedometer2 me-2"></i>Performance</h5>
                         <div className="alert alert-light">
                            <p className="mb-1"><strong>Tier:</strong> <span className={`fw-bold ${getScoreColor(report.performance.ttfb < 100 ? 15 : 5, 15)}`}>{report.performance.tier}</span></p>
                            <p className="mb-1"><strong>Time to First Byte (TTFB):</strong> {report.performance.ttfb} ms</p>
                            <p className="mb-0"><strong>Total Response Time:</strong> {report.performance.totalTime} ms</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};


import { runEvaluation, Report, ProgressUpdate } from '../services/evaluationService';

// --- Main ReportView Component ---

const ReportView: React.FC = () => {
  const { serverUrl: urlParam } = useParams<{ serverUrl?: string }>();
  const navigate = useNavigate();

  const [serverUrl, setServerUrl] = useState('');
  const [status, setStatus] = useState<ReportStatus>('idle');
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (urlParam) {
      // Basic validation and sanitization
      let decodedUrl = decodeURIComponent(urlParam);
      if (!/^https?:\/\//i.test(decodedUrl)) {
        decodedUrl = `https://${decodedUrl}`;
      }
      setServerUrl(decodedUrl);
    }
  }, [urlParam]);

  const handleRunReport = async () => {
    if (!serverUrl.trim()) {
      setError('Please enter a server URL to evaluate.');
      return;
    }

    const normalizedUrl = serverUrl.replace(/^https?:\/\//, '');
    navigate(`/report/${normalizedUrl}`);

    setStatus('in-progress');
    setError(null);
    setReport(null);

    try {
      const finalReport = await runEvaluation(serverUrl, (progressUpdate) => {
        setProgress(progressUpdate);
      });
      setReport(finalReport);
      setStatus('complete');
    } catch (e: any) {
      console.error("Evaluation failed:", e);
      setError(`An error occurred during evaluation: ${e.message}`);
      setStatus('error');
    } finally {
      setProgress(null);
    }
  };

  const handleRunAgain = () => {
    setStatus('idle');
    setReport(null);
    handleRunReport();
  }

  return (
    <div className="container-fluid py-4">
      <div className="row justify-content-center">
        <div className="col-lg-10 col-xl-8">
          <div className="text-center mb-4">
            <h1 className="display-5">MCP Server Evaluation Report</h1>
            <p className="lead text-muted">A comprehensive report and grade for any remote MCP server implementation.</p>
          </div>

          {status !== 'in-progress' && (
            <div className="input-group mb-3">
              <span className="input-group-text"><i className="bi bi-hdd-stack"></i></span>
              <input
                type="text"
                className="form-control"
                placeholder="e.g., mcp.example.com"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRunReport()}
                disabled={status === 'in-progress'}
              />
              <button
                className="btn btn-primary"
                onClick={handleRunReport}
                disabled={status === 'in-progress'}
              >
                <i className="bi bi-clipboard2-pulse-fill me-2"></i>
                {status === 'in-progress' ? 'Evaluating...' : 'Run Evaluation'}
              </button>
            </div>
          )}

          {error && <div className="alert alert-danger">{error}</div>}

          {status === 'in-progress' && progress && <ProgressBar progress={progress} />}

          {status === 'complete' && report && <ReportCard report={report} onRunAgain={handleRunAgain} />}
        </div>
      </div>
    </div>
  );
};

export default ReportView;
