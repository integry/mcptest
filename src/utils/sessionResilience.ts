/** Opt-in only. No UI, storage, logging, tool execution, or connection session reuse. */
import type { TransportDiagnostic, TransportDiagnosticEvidence } from '../types/transportDiagnostics';
import { SESSION_RESILIENCE_DEFINITIONS, SESSION_RESILIENCE_IDS, type SessionResilienceId } from './sessionResilienceDefinitions';

export interface SessionResilienceOptions {
  endpoint: string;
  /** Connection-bound fetch adapter: owns routing and credentials, never evidence. */
  fetch: typeof fetch;
  headers?: HeadersInit;
  route?: 'direct' | 'proxy';
  protocolVersion?: string;
  stateless?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}
interface Reply {
  status?: number;
  session?: string;
  message?: { id?: unknown; result?: { protocolVersion?: string }; error?: unknown };
  evidence: TransportDiagnosticEvidence;
  target: boolean;
  sessionRejected?: boolean;
}
export async function checkSessionResilience(options: SessionResilienceOptions): Promise<TransportDiagnostic[]> {
  const findings: TransportDiagnostic[] = [];
  const route = options.route ?? 'direct';
  const url = new URL(options.endpoint);
  const endpoint = `${url.origin}${url.pathname}`; // Never retain userinfo, query credentials or fragments.
  const safeVersion = (value?: string) => /^20\d{2}-\d{2}-\d{2}$/.test(value ?? '') ? value! : '2025-11-25';
  let version = safeVersion(options.protocolVersion);
  let sequence = 0;
  const owned = new Set<string>();
  const add = (id: SessionResilienceId, outcome: TransportDiagnostic['outcome'], evidence: TransportDiagnosticEvidence[], note: string, skipped = false) => {
    findings.push({ id, ...SESSION_RESILIENCE_DEFINITIONS[id], outcome,
      status: skipped ? 'not-checked' : 'detected', severity: outcome === 'fail' ? 'error' : outcome === 'warning' ? 'warning' : 'info',
      evidence, explanation: `${note} ${SESSION_RESILIENCE_DEFINITIONS[id].explanation}`,
      ...(skipped ? { notCheckedReason: note } : {}),
    });
  };
  const request = async (method: string, session?: string, httpMethod = 'POST'): Promise<Reply> => {
    const headers = new Headers(options.headers);
    headers.delete('Mcp-Session-Id');
    headers.set('Accept', 'application/json, text/event-stream');
    headers.set('Content-Type', 'application/json');
    if (method !== 'initialize') headers.set('MCP-Protocol-Version', version);
    else headers.delete('MCP-Protocol-Version');
    if (session) headers.set('Mcp-Session-Id', session);
    const id = ++sequence;
    const evidence: TransportDiagnosticEvidence = {
      route, endpoint, method: httpMethod, ...(httpMethod === 'POST' ? { mcpMethod: method } : {}),
      headersSent: { Accept: headers.get('Accept')!, 'Content-Type': 'application/json', ...(session ? { 'Mcp-Session-Id': '[REDACTED]' } : {}), ...(method !== 'initialize' ? { 'MCP-Protocol-Version': version } : {}) },
      observation: 'Request could not complete (network, CORS, timeout or cancellation).',
    };
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(abort, options.timeoutMs ?? 5000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let responseBody: ReadableStream<Uint8Array> | null = null;
    try {
      const response = await options.fetch(options.endpoint, {
        method: httpMethod, headers, signal: controller.signal, redirect: 'error',
        ...(httpMethod === 'POST' ? { body: JSON.stringify({ jsonrpc: '2.0', ...(method.startsWith('notifications/') ? {} : { id }), method,
          ...(method === 'initialize' ? { params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'mcptest-session-resilience', version: '1.0.0' } } } : {}) }) } : {}),
      });
      responseBody = response.body;
      evidence.status = response.status;
      const source = route === 'direct' ? 'target' : response.headers.get('X-MCP-Proxy-Response-Source');
      evidence.responseSource = source === 'target' ? 'target' : 'proxy';
      evidence.headersSeen = {};
      // Values from untrusted responses may contain secrets: retain presence only except fixed media types.
      for (const name of ['Mcp-Session-Id', 'MCP-Protocol-Version', 'Allow', 'Access-Control-Expose-Headers']) {
        if (response.headers.has(name)) evidence.headersSeen[name] = '[REDACTED]';
      }
      const sse = response.headers.get('Content-Type')?.split(';')[0].trim() === 'text/event-stream';
      evidence.headersSeen['Content-Type'] = sse ? 'text/event-stream' : response.headers.get('Content-Type')?.includes('application/json') ? 'application/json' : '(other or absent)';
      evidence.observation = `${httpMethod} ${method}: HTTP ${response.status}.`;
      let message: Reply['message'];
      let sessionRejected = false;
      const parse = (data: string) => {
        const parsed = JSON.parse(data);
        const errorMessage = parsed?.error?.message;
        if (typeof errorMessage === 'string' && /session/i.test(errorMessage)
          && /not found|unknown|invalid|expired|no valid|missing|terminated/i.test(errorMessage)) sessionRejected = true;
        if (parsed?.id === id) message = parsed;
      };
      if (response.body && httpMethod === 'POST' && !method.startsWith('notifications/') && (response.ok || response.status === 400)) {
        reader = response.body.getReader();
        let buffer = '';
        const decoder = new TextDecoder();
        while (buffer.length < 65536) {
          const part = await reader.read();
          buffer += decoder.decode(part.value, { stream: !part.done });
          if (sse) {
            const frames = buffer.replace(/\r\n/g, '\n').split('\n\n');
            for (const frame of frames.slice(0, -1)) {
              const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
              try { parse(data); } catch { /* keep reading */ }
            }
          } else {
            try { parse(buffer); } catch { /* incomplete JSON */ }
          }
          if (message || part.done) break;
        }
      }
      return { status: response.status, session: response.headers.get('Mcp-Session-Id') ?? undefined, message, evidence, sessionRejected, target: source === 'target' };
    } catch { return { evidence, target: false }; }
    finally {
      if (reader) void reader.cancel().catch(() => {});
      else if (responseBody) void responseBody.cancel().catch(() => {});
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  };
  const ok = (reply: Reply) => reply.target && reply.status === 200 && !!reply.message?.result && !reply.message.error;
  const blocked = (reply: Reply) => [401, 403, 429].includes(reply.status ?? 0);
  const available = (reply: Reply) => reply.target && !blocked(reply);
  if (options.stateless) {
    for (const id of SESSION_RESILIENCE_IDS) add(id, 'pass', [], 'Not applicable: stateless. The negotiated protocol uses no Mcp-Session-Id.');
    return findings;
  }
  try {
    const initial = await request('initialize');
    if (initial.session && initial.target) owned.add(initial.session);
    if (!ok(initial)) {
      for (const id of SESSION_RESILIENCE_IDS) add(id, undefined, [initial.evidence], 'A successful initialize could not be observed; session handling was not checked.', true);
      return findings;
    }
    version = safeVersion(initial.message!.result!.protocolVersion);
    if (!initial.session) {
      await request('notifications/initialized');
      const ping = await request('ping');
      for (const id of SESSION_RESILIENCE_IDS) add(id, ok(ping) ? 'pass' : undefined, [initial.evidence, ping.evidence], ok(ping) ? 'Not applicable: stateless. Initialize issued no session id and a sessionless ping succeeded.' : 'No readable session id and sessionless ping failed; check CORS header exposure before classifying this server.', !ok(ping));
      return findings;
    }
    await request('notifications/initialized', initial.session);
    const unknown = await request('ping', crypto.randomUUID());
    const stop = options.signal?.aborted || blocked(unknown);
    const unknownChecked = available(unknown) && !stop;
    add('session.unknown-id', unknownChecked ? unknown.status === 404 ? 'pass' : 'fail' : undefined, [unknown.evidence], unknownChecked ? `Unknown id returned HTTP ${unknown.status}; expected 404 so clients re-initialize.` : stop ? 'Stopped after cancellation, an authorization failure or rate limiting; unknown-id handling was not checked.' : 'Target response unavailable; unknown-id handling was not checked.', !unknownChecked);
    if (stop) {
      for (const id of ['session.reinitialize', 'session.stickiness', 'session.delete'] as const) add(id, undefined, [unknown.evidence], 'Stopped after cancellation, an authorization failure or rate limiting.', true);
      return findings;
    }
    const fresh = await request('initialize');
    if (fresh.session && fresh.target) owned.add(fresh.session);
    const recovered = ok(fresh) && !!fresh.session && fresh.session !== initial.session;
    const recoveryChecked = unknown.target && unknown.status === 404 && available(fresh) && !options.signal?.aborted;
    add('session.reinitialize', recoveryChecked ? recovered ? 'pass' : 'fail' : undefined, [unknown.evidence, fresh.evidence], unknown.status !== 404 || !unknown.target ? 'No target HTTP 404 was observed; recovery after 404 was not checked.' : !recoveryChecked ? 'Fresh initialize was unavailable due to cancellation, authorization, rate limiting or an unavailable target response; recovery after 404 was not checked.' : recovered ? 'A fresh initialize issued a different session id after 404.' : 'Fresh initialize did not issue a new usable session id after 404.', !recoveryChecked);
    if (!recovered) {
      for (const id of ['session.stickiness', 'session.delete'] as const) add(id, undefined, [fresh.evidence], 'A fresh probe session was unavailable.', true);
      return findings;
    }
    const session = fresh.session!;
    version = safeVersion(fresh.message!.result!.protocolVersion);
    await request('notifications/initialized', session);
    const burst: Reply[] = [];
    let stopped = false;
    for (let index = 0; index < 8 && !options.signal?.aborted; index++) {
      const reply = await request('ping', session);
      burst.push(reply);
      if (blocked(reply) || !reply.target) { stopped = true; break; }
    }
    if (!stopped && !options.signal?.aborted) burst.push(...await Promise.all(Array.from({ length: 4 }, () => request('ping', session))));
    // A generic 400 can be unrelated; only explicit session errors establish session loss.
    const losses = burst.filter(reply => reply.target && (reply.status === 404 || (reply.status === 400 && reply.sessionRejected))).length;
    const failures = burst.filter(reply => !ok(reply)).length;
    const complete = burst.length === 12 && burst.every(reply => reply.target);
    add('session.stickiness', losses ? 'fail' : complete && !failures ? 'pass' : undefined, burst.map(reply => reply.evidence), `${losses}/${burst.length} session rejections; ${failures}/${burst.length} unsuccessful requests (${burst.length ? Math.round(failures / burst.length * 100) : 0}% failure ratio). A small sample cannot prove durability across future restarts.`, !losses && (!complete || !!failures));
    const deletion = await request('DELETE session', session, 'DELETE');
    const after = deletion.target && deletion.status! >= 200 && deletion.status! < 300 ? await request('ping', session) : undefined;
    if (after?.target && after.status === 404) owned.delete(session);
    const unsupported = deletion.target && deletion.status === 405;
    const checked = unsupported || (!!after && available(after) && !options.signal?.aborted);
    add('session.delete', unsupported ? 'warning' : checked ? after?.status === 404 ? 'pass' : 'fail' : undefined, [deletion.evidence, ...(after ? [after.evidence] : [])], unsupported ? 'DELETE returned 405, which the specification permits.' : !checked ? 'DELETE was not accepted or its verification was unavailable due to cancellation, authorization, rate limiting or an unavailable target response.' : `After accepted DELETE, the old id returned HTTP ${after!.status}; expected 404.`, !checked);
    return findings;
  } finally {
    // Only ids created by this run; never delete the inspector connection's id.
    for (const session of owned) await request('cleanup session', session, 'DELETE');
  }
}
