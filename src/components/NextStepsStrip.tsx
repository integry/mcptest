import React, { useEffect, useState } from 'react';
import { trackEvent } from '../utils/analytics';
import { completeNextStep, NEXT_STEPS_PROGRESS_EVENT, readCompletedSteps } from '../utils/nextStepsProgress';

const dismissalKey = 'mcptest-next-steps-dismissed';
const dismissed = () => { try { return localStorage.getItem(dismissalKey) === 'true'; } catch { return false; } };
export default function NextStepsStrip({ endpoint, onCallTool }: { endpoint: string; onCallTool: () => void }) {
  const [hidden, setHidden] = useState(dismissed);
  const [completed, setCompleted] = useState(readCompletedSteps);
  useEffect(() => {
    const update = () => setCompleted(readCompletedSteps());
    window.addEventListener(NEXT_STEPS_PROGRESS_EVENT, update);
    return () => window.removeEventListener(NEXT_STEPS_PROGRESS_EVENT, update);
  }, []);
  if (hidden || window.location.pathname.startsWith('/call/')) return null;
  const report = `/report/${encodeURIComponent(endpoint)}`;
  const steps = [
    ['tool', 'Call a tool', ''],
    ['report', 'Run the full report', report],
    ['badge', 'Publish and embed the badge', `${report}#report-badge-embed-title`],
    ['watch', 'Watch weekly for breaking changes', `/tools/breaking-changes?endpoint=${encodeURIComponent(endpoint)}`],
    ['ci', 'Add the GitHub Action to CI', '/ci'],
  ];
  const click = (step: string) => {
    trackEvent('next_steps_click', { step });
    if (step === 'watch' || step === 'ci') completeNextStep(step);
    if (step === 'tool') onCallTool();
  };
  return <aside className="next-steps-strip border-bottom p-2" aria-label="Next steps">
    <div className="d-flex justify-content-between align-items-center"><strong>Next steps</strong><button className="btn btn-sm btn-ghost" aria-label="Dismiss next steps" onClick={() => {
      try { localStorage.setItem(dismissalKey, 'true'); } catch { /* Dismiss for this view. */ }
      setHidden(true); trackEvent('next_steps_dismiss');
    }}>Dismiss</button></div>
    <ul className="d-flex flex-wrap gap-3 list-unstyled mb-0">{steps.map(([step, label, href]) => <li key={step}>
      {completed.includes(step) && <span aria-label="Completed">✓ </span>}
      {href ? <a href={href} onClick={() => click(step)}>{label}</a> : <button className="btn btn-link p-0 align-baseline" onClick={() => click(step)}>{label}</button>}
    </li>)}</ul>
  </aside>;
}
