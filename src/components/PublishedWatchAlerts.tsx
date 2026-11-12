import React, { useEffect, useId, useState } from 'react';
import { publishedReportAlerts, type PublishedAlertStatus } from '../utils/publishedReports';

/** Mounted by endpoint identity so secret state cannot follow navigation. */
export default function PublishedWatchAlerts({ id, token, enabled }: { id: string; token: string; enabled: boolean }) {
  const fieldId = useId();
  const [url, setUrl] = useState('');
  const [alert, setAlert] = useState<PublishedAlertStatus | null>(null);
  const [secret, setSecret] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void publishedReportAlerts(id, token, 'status').then((result) => {
      if (active) setAlert(result.alert);
    }).catch(() => { if (active) setError('Alert status could not be loaded.'); });
    return () => { active = false; };
  }, [id, token]);
  const kind = (() => {
    try {
      const host = new URL(url).hostname;
      return host === 'hooks.slack.com' ? 'Slack' : ['discord.com', 'discordapp.com'].includes(host) ? 'Discord' : 'HTTPS webhook';
    } catch { return 'HTTPS webhook'; }
  })();
  const act = async (action: 'save' | 'test' | 'remove') => {
    setBusy(true); setError(undefined); setSecret(undefined);
    try {
      const result = await publishedReportAlerts(id, token, action, url);
      setAlert(result.alert); setSecret(result.signingSecret);
      if (action === 'save' || action === 'remove') setUrl('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Alerts could not be updated.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="published-alerts">
      <h4>Alerts</h4>
      <p className="published-reports-note">One free destination for breaking or risky weekly changes. Safe changes stay in the feed.</p>
      {alert && <p role="status">
        {alert.kind} · {alert.host} · {alert.enabled ? 'Enabled' : 'Disabled after 5 failed deliveries; save a destination to enable again'}
        {alert.lastDelivery && ` · Last delivery ${alert.lastDelivery.status}${alert.lastDelivery.httpStatus ? ` (HTTP ${alert.lastDelivery.httpStatus})` : ''} · ${new Date(alert.lastDelivery.timestamp).toLocaleString()}`}
      </p>}
      <form onSubmit={(event) => { event.preventDefault(); void act('save'); }}>
        <label htmlFor={fieldId}>Alert destination URL</label>
        <input id={fieldId} type="url" className="form-control form-control-sm" value={url}
          onChange={(event) => setUrl(event.target.value)} maxLength={2048} required autoComplete="off"
          spellCheck={false} aria-invalid={Boolean(error)} aria-describedby={`${fieldId}-hint${error ? ` ${fieldId}-error` : ''}`} />
        <p id={`${fieldId}-hint`} className="published-reports-note">Detected: {kind}. HTTPS only. The saved URL is secret and cannot be retrieved.</p>
        {error && <p id={`${fieldId}-error`} className="text-danger" role="alert">{error}</p>}
        <div className="published-watch-actions">
          <button className="btn btn-sm btn-outline-primary" disabled={busy || !enabled || !url}>Save alerts</button>
          {alert && <>
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={busy || !enabled || !alert.enabled} onClick={() => void act('test')}>Send test alert</button>
            <button type="button" className="btn btn-sm btn-outline-danger" disabled={busy} onClick={() => void act('remove')}>Remove alerts</button>
          </>}
        </div>
      </form>
      {secret && <div className="published-token" role="status">
        <label htmlFor={`${fieldId}-secret`}>Webhook signing secret — save now; shown once</label>
        <input id={`${fieldId}-secret`} className="form-control" readOnly value={secret} />
        <a href="/learn/which-mcp-tool-changes-break-clients#verifying-webhook-alerts">How to verify signatures</a>
      </div>}
    </div>
  );
}
