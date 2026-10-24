// Weekly watch of published endpoints (free tier: public, unauthenticated servers).
//
// A report owner opts an endpoint in with "Watch weekly" when publishing
// (POST /r?watch=weekly). The Cron Trigger in wrangler.toml then runs
// runWeeklyWatch, which takes at most WATCH_BATCH_PER_RUN due endpoints from
// the registry, lists their tools with a minimal MCP handshake, and compares
// the listing with the previous one using the same classifier as the
// /tools/breaking-changes page (src/utils/breakingChanges.ts). A changed listing
// is stored through the endpoint's PublishedReports instance, which keeps the
// newest PUBLISHED_REPORT_RETENTION snapshots.
//
// Nothing here sends or stores credentials: requests carry no Authorization
// header, an endpoint that answers 401/403 is recorded as "auth-required" and
// skipped, and endpoints whose stored URL carries a redacted query credential
// are never contacted. Results are public: an Atom feed per endpoint at
// /r/<encoded endpoint>/changes.xml and a "breaking change" state on the live
// report badge.
//
// Plans: only `free` exists. A paid tier adds a plan with its own interval and
// capabilities here (WATCH_PLANS) without changing the stored shapes.
import { classifyBreakingChanges, parseToolsListPayload } from '../../src/utils/breakingChanges.ts';
import { sha256Hex } from '../../src/utils/publishedReportIdentity.ts';
import {
  createInspectionBudget,
  redactReportValue,
  withInspectionBudget,
} from './reportRedaction.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const WATCH_PLANS = {
  free: { intervalMs: 7 * DAY_MS, authenticated: false },
};
export const DEFAULT_WATCH_PLAN = 'free';
/** Total endpoints the free watch accepts; opt-ins past it are refused. */
export const WATCH_MAX_ENDPOINTS = 500;
/**
 * Endpoints checked per cron run. With the hourly trigger this covers
 * 24 * 7 * 6 = 1008 checks a week, enough for the cap; each check is a few
 * sequential requests with a timeout, so a run stays far below CPU limits.
 */
export const WATCH_BATCH_PER_RUN = 6;
export const WATCH_REQUEST_TIMEOUT_MS = 10_000;
export const WATCH_MAX_TOOL_PAGES = 5;
export const WATCH_MAX_RESPONSE_BYTES = 1024 * 1024;
/** Findings kept per stored change; the feed links to the page for the rest. */
export const WATCH_MAX_STORED_FINDINGS = 50;
const REGISTRY_NAME = 'watch:registry';
const STATELESS_VERSION = '2026-07-28';
const STATEFUL_VERSION = '2025-11-25';
const CLIENT_INFO = { name: 'mcptest-weekly-watch', version: '1.0.0' };
const SITE_URL = 'https://mcptest.io';

const callStub = (stub, path, body) => stub.fetch(new Request(`https://published-reports${path}`, body === undefined
  ? undefined
  : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

const registryStub = (env) => env.PUBLISHED_REPORTS.get(env.PUBLISHED_REPORTS.idFromName(REGISTRY_NAME));
const endpointStub = (env, endpointKey) => env.PUBLISHED_REPORTS.get(env.PUBLISHED_REPORTS.idFromName(`endpoint:${endpointKey}`));

/** Whether the weekly watch may contact this stored endpoint at all. */
export const isWatchableEndpoint = (endpoint) => (
  typeof endpoint === 'string'
  && /^https?:\/\//.test(endpoint)
  && !/REDACTED/i.test(decodeURIComponentSafe(endpoint))
);

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// --- Minimal MCP client: just enough to list tools ---

class HandshakeError extends Error {
  constructor(message, outcome = 'unreachable', status) {
    super(message);
    this.outcome = outcome;
    this.status = status;
  }
}

/** The body as text, never buffering more than WATCH_MAX_RESPONSE_BYTES whatever the server sends. */
const readLimited = async (response) => {
  const declared = Number(response.headers.get('Content-Length') || 0);
  if (declared > WATCH_MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new HandshakeError('The response is too large.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > WATCH_MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new HandshakeError('The response is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

/** The JSON-RPC message answering `id`, from a JSON or an SSE body. */
const parseRpcBody = (text, contentType, id) => {
  const messages = [];
  if (/text\/event-stream/i.test(contentType)) {
    for (const event of text.split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
      if (!data) continue;
      try {
        messages.push(JSON.parse(data));
      } catch {
        // Ignore non-JSON events.
      }
    }
  } else if (text.trim()) {
    try {
      const parsed = JSON.parse(text);
      messages.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      return undefined;
    }
  }
  return messages.find((message) => message && message.id === id && (message.result !== undefined || message.error !== undefined));
};

const createRpc = (endpoint, fetchImpl) => {
  let nextId = 1;
  let sessionId;
  let protocolVersion;
  const send = async (method, params, { notification = false, version } = {}) => {
    const id = notification ? undefined : nextId++;
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': `${CLIENT_INFO.name}/${CLIENT_INFO.version} (+${SITE_URL}${'/tools/breaking-changes'})`,
    };
    const negotiated = version ?? protocolVersion;
    if (negotiated) headers['MCP-Protocol-Version'] = negotiated;
    if (negotiated === STATELESS_VERSION) headers['Mcp-Method'] = method;
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, ...(params ? { params } : {}) }),
        redirect: 'manual',
        signal: AbortSignal.timeout(WATCH_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new HandshakeError(`The endpoint did not answer: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new HandshakeError(`The endpoint requires authorization (HTTP ${response.status}).`, 'auth-required', response.status);
    }
    if (notification) {
      await response.body?.cancel().catch(() => {});
      return { status: response.status };
    }
    const issuedSession = response.headers.get('Mcp-Session-Id');
    if (issuedSession) sessionId = issuedSession;
    const text = await readLimited(response);
    const message = parseRpcBody(text, response.headers.get('Content-Type') || '', id);
    return { status: response.status, message };
  };
  return {
    send,
    setVersion: (version) => { protocolVersion = version; },
    close: async () => {
      if (!sessionId) return;
      await fetchImpl(endpoint, {
        method: 'DELETE',
        headers: { 'Mcp-Session-Id': sessionId, ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}) },
        signal: AbortSignal.timeout(WATCH_REQUEST_TIMEOUT_MS),
      }).then((response) => response.body?.cancel()).catch(() => {});
    },
  };
};

const resultOf = ({ status, message }, method) => {
  if (message?.error) throw new HandshakeError(`${method} failed: ${String(message.error.message || message.error.code).slice(0, 200)}`, 'error');
  if (status >= 400 || !message || typeof message.result !== 'object' || message.result === null) {
    throw new HandshakeError(`${method} was not answered (HTTP ${status}).`, 'error', status);
  }
  return message.result;
};

/**
 * Lists the endpoint's tools the way a client does on connect: the 2026-07-28
 * stateless discovery first, then the 2025 initialize handshake. Resolves to
 * `{ outcome: 'ok', tools, protocolVersion }`, or to `{ outcome, message }`
 * with outcome `auth-required`, `unreachable` or `error`. Never throws.
 */
export async function listToolsForWatch(endpoint, { fetchImpl = fetch } = {}) {
  const rpc = createRpc(endpoint, fetchImpl);
  try {
    let discovered = false;
    const discover = await rpc.send('server/discover', {}, { version: STATELESS_VERSION });
    if (discover.status < 400 && discover.message?.result && typeof discover.message.result === 'object') {
      rpc.setVersion(STATELESS_VERSION);
      discovered = true;
    }
    if (!discovered) {
      const initialize = await rpc.send('initialize', {
        protocolVersion: STATEFUL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      }, { version: STATEFUL_VERSION });
      const result = resultOf(initialize, 'initialize');
      rpc.setVersion(typeof result.protocolVersion === 'string' ? result.protocolVersion : STATEFUL_VERSION);
      await rpc.send('notifications/initialized', undefined, { notification: true });
    }
    const tools = [];
    let cursor;
    for (let page = 0; page < WATCH_MAX_TOOL_PAGES; page += 1) {
      const result = resultOf(await rpc.send('tools/list', cursor ? { cursor } : {}), 'tools/list');
      if (!Array.isArray(result.tools)) throw new HandshakeError('tools/list returned no tools array.', 'error');
      tools.push(...result.tools);
      if (typeof result.nextCursor !== 'string' || !result.nextCursor) {
        return { outcome: 'ok', tools, protocolVersion: discovered ? STATELESS_VERSION : undefined };
      }
      cursor = result.nextCursor;
    }
    return { outcome: 'error', message: `tools/list has more than ${WATCH_MAX_TOOL_PAGES} pages; the free watch stops there.` };
  } catch (error) {
    if (error instanceof HandshakeError) return { outcome: error.outcome, message: error.message };
    return { outcome: 'error', message: error instanceof Error ? error.message : String(error) };
  } finally {
    await rpc.close();
  }
}

// --- Cron run ---

/** The stored form of a listing: redacted like a published report, keys in a stable order. */
const storedListing = (tools) => {
  const redacted = withInspectionBudget(createInspectionBudget(), () => redactReportValue({ tools }));
  const parsed = parseToolsListPayload(redacted);
  if (!parsed.ok) throw new Error(parsed.error);
  return { snapshot: parsed.snapshot, json: JSON.stringify({ tools: redacted.tools }) };
};

const trimFindings = (findings) => findings.slice(0, WATCH_MAX_STORED_FINDINGS).map((item) => ({
  severity: item.severity,
  rule: item.rule,
  subjectKind: item.subjectKind,
  subject: item.subject,
  title: item.title,
  reason: item.reason,
}));

/** Checks one registered endpoint and records the outcome; returns a short result. */
export async function checkWatchedEndpoint(env, registration, { now = Date.now(), fetchImpl = fetch } = {}) {
  const checkedAt = new Date(now).toISOString();
  const stub = endpointStub(env, registration.endpointKey);
  const latest = await (await callStub(stub, '/watch/latest')).json();
  if (!latest.config?.enabled) return { endpointKey: registration.endpointKey, outcome: 'not-watched' };
  if (!isWatchableEndpoint(registration.endpoint)) {
    await callStub(stub, '/watch/state', { state: { state: 'skipped', checkedAt, message: 'The endpoint URL carries a credential, so it is not contacted.' } });
    return { endpointKey: registration.endpointKey, outcome: 'skipped' };
  }
  const listed = await listToolsForWatch(registration.endpoint, { fetchImpl });
  if (listed.outcome !== 'ok') {
    await callStub(stub, '/watch/state', {
      state: { state: listed.outcome, checkedAt, message: listed.message, previous: latest.entry?.observedAt ?? null },
    });
    return { endpointKey: registration.endpointKey, outcome: listed.outcome };
  }
  let stored;
  try {
    stored = storedListing(listed.tools);
  } catch (error) {
    await callStub(stub, '/watch/state', { state: { state: 'error', checkedAt, message: `The listing could not be stored: ${error.message}` } });
    return { endpointKey: registration.endpointKey, outcome: 'error' };
  }
  const contentHash = (await sha256Hex(stored.json)).slice(0, 20);
  if (latest.entry && latest.entry.contentHash === contentHash) {
    await callStub(stub, '/watch/state', { state: { state: 'unchanged', checkedAt, changedAt: latest.entry.observedAt } });
    return { endpointKey: registration.endpointKey, outcome: 'unchanged' };
  }
  const previous = latest.snapshotJson ? parseToolsListPayload(latest.snapshotJson) : undefined;
  const report = previous?.ok ? classifyBreakingChanges(previous.snapshot, stored.snapshot) : undefined;
  const entry = {
    id: `${now.toString(36)}-${contentHash.slice(0, 8)}`,
    observedAt: checkedAt,
    contentHash,
    toolCount: stored.snapshot.tools.length,
    ...(report ? {
      summary: report.summary,
      counts: report.counts,
      severity: report.counts.breaking ? 'breaking' : report.counts.risky ? 'risky' : 'safe',
      findings: trimFindings(report.findings),
      findingCount: report.findings.length,
    } : { baseline: true, summary: `Baseline recorded: ${stored.snapshot.tools.length} tools` }),
  };
  await callStub(stub, '/watch/snapshot', {
    entry,
    snapshotJson: stored.json,
    state: { state: report ? entry.severity : 'baseline', checkedAt, changedAt: checkedAt, summary: entry.summary },
  });
  return { endpointKey: registration.endpointKey, outcome: report ? entry.severity : 'baseline' };
}

/** One cron run: checks up to `batchSize` due endpoints, sequentially. */
export async function runWeeklyWatch(env, { now = Date.now(), fetchImpl = fetch, batchSize = WATCH_BATCH_PER_RUN } = {}) {
  if (!env.PUBLISHED_REPORTS) return [];
  const registry = registryStub(env);
  const intervals = Object.fromEntries(Object.entries(WATCH_PLANS).map(([plan, value]) => [plan, value.intervalMs]));
  const { entries } = await (await callStub(registry, '/registry/due', { now, limit: batchSize, intervals })).json();
  const results = [];
  for (const registration of entries) {
    let result;
    try {
      result = await checkWatchedEndpoint(env, registration, { now, fetchImpl });
    } catch (error) {
      result = { endpointKey: registration.endpointKey, outcome: 'error', message: error instanceof Error ? error.message : String(error) };
    }
    if (result.outcome === 'not-watched') {
      await callStub(registry, '/registry/remove', { endpointKey: registration.endpointKey });
    } else {
      await callStub(registry, '/registry/checked', { endpointKey: registration.endpointKey, checkedAt: new Date(now).toISOString(), outcome: result.outcome });
    }
    results.push(result);
  }
  return results;
}

// --- Opt-in and opt-out ---

/**
 * Turns the watch on or off for an endpoint. Opting in is refused for
 * endpoints that require authorization or carry a credential in the URL, and
 * once WATCH_MAX_ENDPOINTS are watched.
 */
export async function setEndpointWatch(env, { endpoint, endpointKey, enabled, requiresAuthorization = false, now = Date.now() }) {
  const nowIso = new Date(now).toISOString();
  const stub = endpointStub(env, endpointKey);
  const registry = registryStub(env);
  if (!enabled) {
    await callStub(stub, '/watch', { enabled: false, now: nowIso });
    await callStub(registry, '/registry/remove', { endpointKey });
    return { enabled: false };
  }
  if (requiresAuthorization) return { enabled: false, reason: 'The free weekly watch covers only servers that list tools without authorization.' };
  if (!isWatchableEndpoint(endpoint)) return { enabled: false, reason: 'The endpoint URL carries a credential, so it cannot be watched.' };
  const added = await (await callStub(registry, '/registry/add', {
    endpointKey, endpoint, plan: DEFAULT_WATCH_PLAN, now: nowIso, max: WATCH_MAX_ENDPOINTS,
  })).json();
  if (!added.watching) return { enabled: false, reason: 'The free weekly watch is full. Try again later.' };
  const enabledWatch = await callStub(stub, '/watch', { enabled: true, endpoint, plan: DEFAULT_WATCH_PLAN, now: nowIso });
  if (!enabledWatch.ok) {
    // The last snapshot was removed meanwhile; nobody could turn this watch off.
    if (added.added) await callStub(registry, '/registry/remove', { endpointKey });
    return { enabled: false, reason: 'The endpoint has no published report, so it cannot be watched.' };
  }
  return { enabled: true, plan: DEFAULT_WATCH_PLAN, interval: 'weekly' };
}

/** Drops an endpoint whose watch was stopped with its last snapshot from the cron registry. */
export async function removeFromWatchRegistry(env, endpointKey) {
  await callStub(registryStub(env), '/registry/remove', { endpointKey });
}

// --- Atom feed ---

const escapeXml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const findingHtml = (entry) => {
  if (entry.baseline) return `<p>${escapeXml(entry.summary)}. Later checks are compared with this listing.</p>`;
  const items = (entry.findings || []).map((item) => (
    `<li><strong>${escapeXml(item.severity)}</strong> · ${escapeXml(item.subject)}: ${escapeXml(item.title)}. ${escapeXml(item.reason)}</li>`
  )).join('');
  const more = entry.findingCount > (entry.findings || []).length
    ? `<p>${entry.findingCount - entry.findings.length} more findings are not shown.</p>` : '';
  return `<p>${escapeXml(entry.summary)}</p><ul>${items}</ul>${more}`;
};

/** Atom feed of the classified changes for one endpoint, newest first. */
export function renderChangesFeed({ endpoint, endpointKey, entries, feedUrl }) {
  const reportUrl = `${SITE_URL}/report/${encodeURIComponent(endpoint)}`;
  const updated = entries[0]?.observedAt || '1970-01-01T00:00:00.000Z';
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>tag:mcptest.io,2026:watch:${escapeXml(endpointKey)}</id>`,
    `  <title>${escapeXml(`MCP interface changes: ${endpoint}`)}</title>`,
    '  <subtitle>Weekly tools/list checks by mcptest.io, classified as breaking, risky or safe for clients that cached the previous listing.</subtitle>',
    `  <updated>${escapeXml(updated)}</updated>`,
    `  <link rel="self" type="application/atom+xml" href="${escapeXml(feedUrl)}"/>`,
    `  <link rel="alternate" type="text/html" href="${escapeXml(reportUrl)}"/>`,
    '  <author><name>mcptest.io</name></author>',
    '  <generator uri="https://mcptest.io/tools/breaking-changes">mcptest weekly watch</generator>',
    ...entries.map((entry) => [
      '  <entry>',
      `    <id>tag:mcptest.io,2026:watch:${escapeXml(endpointKey)}:${escapeXml(entry.id)}</id>`,
      `    <title>${escapeXml(entry.baseline ? entry.summary : `${entry.summary} (${entry.toolCount} tools)`)}</title>`,
      `    <updated>${escapeXml(entry.observedAt)}</updated>`,
      `    <link rel="alternate" type="text/html" href="${escapeXml(reportUrl)}"/>`,
      `    <content type="html">${escapeXml(findingHtml(entry))}</content>`,
      '  </entry>',
    ].join('\n')),
    '</feed>',
    '',
  ].join('\n');
}
