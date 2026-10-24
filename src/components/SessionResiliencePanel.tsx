import React, { useEffect, useRef, useState } from 'react';
import type { TransportDiagnostic } from '../types/transportDiagnostics';
import TransportDiagnosticsPanel from './TransportDiagnosticsPanel';
import { sessionResilienceConnection } from '../utils/sessionResilienceConnection';

interface Props {
  endpoint: string;
  protocolVersion?: string | null;
  stateless: boolean;
  proxyUrl?: string;
  headers?: HeadersInit;
  oauthToken?: string | null;
  getFirebaseToken: () => Promise<string | undefined>;
}
export default function SessionResiliencePanel(props: Props) {
  const [results, setResults] = useState<TransportDiagnostic[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const run = async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setRunning(true);
    setError(false);
    setResults([]);
    try {
      const { checkSessionResilience } = await import('../utils/sessionResilience');
      const firebaseToken = props.proxyUrl ? await props.getFirebaseToken() : undefined;
      const results = await checkSessionResilience({
        ...sessionResilienceConnection({ ...props, firebaseToken }),
        stateless: props.stateless, protocolVersion: props.protocolVersion ?? undefined,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setResults(results);
    } catch { if (!controller.signal.aborted) setError(true); }
    finally { active.current = null; if (!controller.signal.aborted) setRunning(false); }
  };
  return <section className="mb-3" aria-label="Session resilience diagnostics">
    <button className="btn btn-outline-primary btn-sm" disabled={running} onClick={() => void run()}>
      {running ? 'Checking session resilience…' : 'Check session resilience'}
    </button>
    <p className="small text-muted mt-1">Free, opt-in check: temporary sessions, 8 sequential then 4 parallel pings, and DELETE. No tools run. This sample cannot prove survival of a future restart.</p>
    {error && <p role="alert">Session checks could not complete. Reconnect and try again.</p>}
    <div aria-live="polite"><TransportDiagnosticsPanel diagnostics={results} /></div>
  </section>;
}
