import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const ReportView: React.FC = () => {
  const [serverUrl, setServerUrl] = useState('');
  const [report, setReport] = useState<any>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [activeAccordionItem, setActiveAccordionItem] = useState<string | null>(null);

  useEffect(() => {
    // Initialize the web worker
    workerRef.current = new Worker(new URL('../workers/reportWorker.ts', import.meta.url), { type: 'module' });

    workerRef.current.onmessage = (event) => {
      const { type, message, report } = event.data;
      if (type === 'progress') {
        setProgress(prev => [...prev, message]);
      } else if (type === 'complete') {
        setReport(report);
        setIsEvaluating(false);
      }
    };

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  useEffect(() => {
    // Check for a server URL in the path
    const pathParts = location.pathname.split('/report/');
    if (pathParts.length > 1) {
      const urlFromPath = decodeURIComponent(pathParts[1]);
      if (urlFromPath) {
        setServerUrl(urlFromPath);
        startEvaluation(urlFromPath);
      }
    }
  }, [location.pathname]);

  const startEvaluation = (url: string) => {
    if (workerRef.current) {
      setReport(null);
      setProgress(['Starting evaluation...']);
      setIsEvaluating(true);
      workerRef.current.postMessage(url);
      navigate(`/report/${encodeURIComponent(url)}`);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (serverUrl) {
      startEvaluation(serverUrl);
    }
  };

  const toggleAccordion = (id: string) => {
    setActiveAccordionItem(activeAccordionItem === id ? null : id);
  };

  return (
    <div>
      <h1>MCP Server Report Card</h1>
      <form onSubmit={handleSubmit}>
        <div className="input-group mb-3">
          <input
            type="text"
            className="form-control"
            placeholder="Enter MCP Server URL (e.g., mcp.paypal.com)"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            disabled={isEvaluating}
          />
          <button className="btn btn-primary" type="submit" disabled={isEvaluating}>
            {isEvaluating ? 'Evaluating...' : 'Generate Report'}
          </button>
        </div>
      </form>

      {isEvaluating && (
        <div className="progress">
          <div
            className="progress-bar progress-bar-striped progress-bar-animated"
            role="progressbar"
            style={{ width: `${(progress.length / 6) * 100}%` }}
            aria-valuenow={(progress.length / 6) * 100}
            aria-valuemin="0"
            aria-valuemax="100"
          ></div>
        </div>
      )}

      {isEvaluating && progress.length > 0 && (
        <div className="mt-3">
          <h2>Evaluation Progress</h2>
          <ul className="list-group">
            {progress.map((item, index) => (
              <li key={index} className="list-group-item">{item}</li>
            ))}
          </ul>
        </div>
      )}

      {report && !isEvaluating && (
        <div className="mt-4">
          <h2>Report for {serverUrl}</h2>
          <div className="card">
            <div className="card-header">
              Overall Score: {report.score}
            </div>
            <div className="accordion" id="reportAccordion">
              {report.results.map((result: any, index: number) => (
                <div className="accordion-item" key={index}>
                  <h2 className="accordion-header" id={`heading-${index}`}>
                    <button
                      className={`accordion-button ${activeAccordionItem !== `collapse-${index}` ? 'collapsed' : ''}`}
                      type="button"
                      onClick={() => toggleAccordion(`collapse-${index}`)}
                    >
                      <span className="me-auto">{result.category}</span>
                      <span className="badge bg-primary rounded-pill">{result.score}</span>
                    </button>
                  </h2>
                  <div
                    id={`collapse-${index}`}
                    className={`accordion-collapse collapse ${activeAccordionItem === `collapse-${index}` ? 'show' : ''}`}
                  >
                    <div className="accordion-body">
                      <ul className="list-group">
                        {result.details.map((detail: any, detailIndex: number) => (
                          <li key={detailIndex} className="list-group-item">
                            <i className={`bi ${detail.status === 'passed' ? 'bi-check-circle-fill text-success' : 'bi-x-circle-fill text-danger'}`}></i>
                            <span className="ms-2">{detail.description}</span>
                            {detail.comment && <p className="text-muted small mb-0 mt-1">{detail.comment}</p>}
                          </li>
                        ))}
                      </ul>
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
