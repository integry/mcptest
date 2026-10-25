// Destination credentials stay exclusively in the endpoint PublishedReports object.
import { isPrivateOrReservedHost } from '../../src/utils/catalogSubmission.ts';

export function validateAlertDestination(value) {
  if (typeof value !== 'string' || value.length > 2048 || !value || /[\s\\\u0000-\u001f]/.test(value)) return undefined;
  let url;
  try { url = new URL(value); } catch { return undefined; }
  if (/^https:\/\/[^/]*@/i.test(value) || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
      || isPrivateOrReservedHost(url.hostname)) return undefined;
  url.hostname = url.hostname.replace(/\.$/, '');
  if (url.href.length > 2048) return undefined;
  let kind = 'webhook';
  if (url.hostname === 'hooks.slack.com') {
    if (!/^\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname) || url.search) return undefined;
    kind = 'slack';
  } else if (['discord.com', 'discordapp.com'].includes(url.hostname)) {
    if (!/^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname) || url.search) return undefined;
    kind = 'discord';
  }
  return { url: url.href, kind, host: url.hostname };
}

export const newAlertSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Signature covers the exact UTF-8 request body, with the setup secret as UTF-8 key. */
export async function signAlert(secret, body) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return `sha256=${Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function renderAlert(kind, { endpoint, entry, feedUrl, test = false }) {
  const reportUrl = `https://mcptest.io/report/${encodeURIComponent(endpoint)}`;
  const guideUrl = 'https://mcptest.io/learn/which-mcp-tool-changes-break-clients';
  const payload = {
    event: test ? 'watch.test' : `watch.${entry.severity}`,
    endpoint, classifiedAt: entry.observedAt,
    summary: entry.summary, counts: entry.counts || { breaking: 0, risky: 0, safe: 0 },
    topFindings: (entry.findings || []).slice(0, 5).map(({ severity, subject, title }) => ({ severity, subject: String(subject).slice(0, 200), title: String(title).slice(0, 300) })),
    reportUrl, feedUrl, guideUrl,
  };
  // Plain text prevents endpoint/tool names from triggering mentions or formatting.
  const text = `${test ? 'Test alert: ' : ''}${payload.summary}\n${endpoint}\nBreaking: ${payload.counts.breaking}; risky: ${payload.counts.risky}; safe: ${payload.counts.safe}\n${payload.topFindings.map((f) => `${f.severity}: ${f.subject}: ${f.title}`).join('\n')}`.slice(0, 2500);
  if (kind === 'slack') return { text: 'mcptest weekly watch alert', blocks: [
    { type: 'section', text: { type: 'plain_text', text } },
    { type: 'actions', elements: [
      { type: 'button', text: { type: 'plain_text', text: 'View report' }, url: reportUrl },
      { type: 'button', text: { type: 'plain_text', text: 'Breaking changes guide' }, url: guideUrl },
    ] },
  ] };
  if (kind === 'discord') return { allowed_mentions: { parse: [] }, embeds: [{
    title: test ? 'mcptest test alert' : 'mcptest weekly watch alert',
    description: text, url: reportUrl, timestamp: entry.observedAt,
    fields: [{ name: 'Breaking changes guide', value: guideUrl }],
  }] };
  return payload;
}

/** Two attempts maximum; errors and response bodies never escape or enter storage. */
export async function deliverAlert(destination, payload, { fetchImpl = fetch, now = Date.now() } = {}) {
  const body = JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json' };
  if (destination.kind === 'webhook') headers['X-Mcptest-Signature'] = await signAlert(destination.secret, body);
  let status = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(destination.url, {
        method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(5000),
      });
      status = response.status;
      await response.body?.cancel().catch(() => {});
      if (response.ok) return { status: 'ok', httpStatus: status, timestamp: new Date(now).toISOString() };
    } catch { status = null; }
  }
  return { status: 'failed', httpStatus: status, timestamp: new Date(now).toISOString() };
}
