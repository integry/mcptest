import type {
  TransportDiagnostic,
  TransportDiagnosticEvidence,
  TransportDiagnosticId,
  TransportDiagnosticRemediation,
  TransportDiagnosticRoute,
  TransportDiagnosticSeverity,
} from '../types/transportDiagnostics';
import type {
  ObservedTransportRequest,
  TransportCandidateFailure,
} from './transportDetection';

interface TransportDiagnosticDefinition {
  title: string;
  explanation: string;
  remediation: TransportDiagnosticRemediation;
}

/**
 * Plain-language text and stack-specific fixes for each stable diagnostic id.
 * A reference page is generated per id, so keep ids and titles stable.
 */
export const TRANSPORT_DIAGNOSTIC_DEFINITIONS: Record<TransportDiagnosticId, TransportDiagnosticDefinition> = {
  'transport.accept-header-406': {
    title: 'Server rejected the Accept header (HTTP 406)',
    explanation: 'Streamable HTTP clients must send an Accept header that lists both application/json and text/event-stream on every POST, because the server may answer with either a JSON body or an SSE stream. The server answered HTTP 406 Not Acceptable, which usually means its Accept check is stricter than the specification: it compares the whole header to one exact string, requires one media type only, or rejects the order or parameters of the list. Other inspectors report this as a generic connection error.',
    remediation: {
      summary: 'Accept any request whose Accept header includes both application/json and text/event-stream, in any order and with any parameters. Clients that build requests by hand must send "Accept: application/json, text/event-stream".',
      hints: [
        {
          stack: 'TypeScript SDK',
          code: "// StreamableHTTPServerTransport already negotiates correctly. If you add your own check:\nconst accept = req.headers.accept ?? '';\nif (!accept.includes('application/json') || !accept.includes('text/event-stream')) {\n  return res.status(406).end();\n}",
        },
        {
          stack: 'Python SDK',
          code: 'accept = request.headers.get("accept", "")\nif "application/json" not in accept or "text/event-stream" not in accept:\n    return Response(status_code=406)\n# FastMCP.streamable_http_app() performs this check for you.',
        },
        {
          stack: 'Cloudflare Workers',
          code: "// McpAgent.serve('/mcp') from 'agents/mcp' negotiates Accept for you.\nconst accept = request.headers.get('Accept') ?? '';\nconst ok = accept.includes('application/json') && accept.includes('text/event-stream');",
        },
      ],
    },
  },
  'transport.get-stream-405': {
    title: 'Server does not offer a GET event stream (HTTP 405)',
    explanation: 'After initialization a Streamable HTTP client may send GET to the MCP endpoint to open a stream for server-initiated messages such as notifications and requests. The server answered HTTP 405 Method Not Allowed. The specification allows this, so the connection still works, but the server cannot push list-changed notifications, progress, sampling or elicitation requests outside a POST response. Treat it as a warning, not a failure.',
    remediation: {
      summary: 'If the server needs to send messages on its own, handle GET on the MCP endpoint and return a text/event-stream response. If it never does, keep the 405 and include an Allow header so clients know the stream is intentionally unavailable.',
      hints: [
        {
          stack: 'TypeScript SDK',
          code: "app.get('/mcp', (req, res) => transport.handleRequest(req, res));\n// or, when no server-initiated messages are needed:\napp.get('/mcp', (_req, res) => res.set('Allow', 'POST, DELETE').status(405).end());",
        },
        {
          stack: 'Python SDK',
          code: 'app = mcp.streamable_http_app()  # FastMCP routes GET to the standalone SSE stream',
        },
        {
          stack: 'Cloudflare Workers',
          code: "// McpAgent.serve('/mcp') handles GET streams. In a custom fetch handler:\nif (request.method === 'GET') {\n  return new Response(null, { status: 405, headers: { Allow: 'POST, DELETE' } });\n}",
        },
      ],
    },
  },
  'transport.unsupported-media-type-415': {
    title: 'Server rejected the JSON request body (HTTP 415)',
    explanation: 'MCP clients POST JSON-RPC messages with Content-Type: application/json. The server answered HTTP 415 Unsupported Media Type. This usually means it compares the Content-Type header to an exact string, requires or forbids a charset parameter such as "; charset=utf-8", or a body parser in front of it only accepts another media type.',
    remediation: {
      summary: 'Accept application/json with or without parameters: compare only the media type before the first semicolon, case-insensitively, and make sure body-parsing middleware accepts it.',
      hints: [
        {
          stack: 'TypeScript SDK',
          code: "app.use(express.json()); // matches application/json with any charset\nconst type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();\nif (type !== 'application/json') return res.status(415).end();",
        },
        {
          stack: 'Python SDK',
          code: 'media_type = request.headers.get("content-type", "").split(";")[0].strip().lower()\nif media_type != "application/json":\n    return Response(status_code=415)',
        },
        {
          stack: 'Cloudflare Workers',
          code: "const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();\nif (type !== 'application/json') return new Response(null, { status: 415 });",
        },
      ],
    },
  },
  'transport.target-rate-limited-429': {
    title: 'MCP server rate-limited the request (HTTP 429)',
    explanation: 'The MCP server itself answered HTTP 429 Too Many Requests. This is the target server\'s limit, not the mcptest proxy\'s caller limit. mcptest honors the Retry-After header (seconds or an HTTP date), retries at most once when the wait is short, and otherwise shows how long to wait. A browser can only read Retry-After from another origin when the server lists it in Access-Control-Expose-Headers.',
    remediation: {
      summary: 'Wait for the time the server requested before retrying. Server operators should send Retry-After with every 429, expose it to browsers with Access-Control-Expose-Headers, and size limits so one client connection (initialize plus discovery) does not trip them.',
      hints: [
        {
          stack: 'TypeScript SDK',
          code: "res.set('Retry-After', '30');\nres.set('Access-Control-Expose-Headers', 'Retry-After, Mcp-Session-Id, MCP-Protocol-Version');\nres.status(429).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Rate limited' }, id: null });",
        },
        {
          stack: 'Python SDK',
          code: 'return JSONResponse({"error": "rate limited"}, status_code=429, headers={"Retry-After": "30"})\n# and CORSMiddleware(..., expose_headers=["Retry-After", "Mcp-Session-Id", "MCP-Protocol-Version"])',
        },
        {
          stack: 'Cloudflare Workers',
          code: "return new Response('Too Many Requests', {\n  status: 429,\n  headers: { 'Retry-After': '30', 'Access-Control-Expose-Headers': 'Retry-After' },\n});",
        },
      ],
    },
  },
  'transport.cors-expose-headers-missing': {
    title: 'Browser cannot read Mcp-Session-Id (Access-Control-Expose-Headers missing)',
    explanation: 'A cross-origin browser client can only read response headers that the server lists in Access-Control-Expose-Headers. The initialize request succeeded, but the browser could not read an Mcp-Session-Id header, so the next request was sent without a session and the server rejected it. The server most likely issues a session id without exposing it. The same applies to MCP-Protocol-Version. Non-browser clients are unaffected, which is why this often looks like a confusing stateful fallback failure only in web clients.',
    remediation: {
      summary: 'Add Access-Control-Expose-Headers: Mcp-Session-Id, MCP-Protocol-Version to every MCP response (including the initialize response), and allow Mcp-Session-Id and MCP-Protocol-Version in Access-Control-Allow-Headers for preflight requests.',
      hints: [
        {
          stack: 'TypeScript SDK',
          code: "app.use(cors({\n  origin: allowedOrigins,\n  exposedHeaders: ['Mcp-Session-Id', 'MCP-Protocol-Version'],\n  allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id', 'MCP-Protocol-Version', 'Last-Event-ID'],\n}));",
        },
        {
          stack: 'Python SDK',
          code: 'app = CORSMiddleware(\n    mcp.streamable_http_app(),\n    allow_origins=allowed_origins,\n    allow_methods=["GET", "POST", "DELETE"],\n    allow_headers=["Content-Type", "Authorization", "Mcp-Session-Id", "MCP-Protocol-Version"],\n    expose_headers=["Mcp-Session-Id", "MCP-Protocol-Version"],\n)',
        },
        {
          stack: 'Cloudflare Workers',
          code: "const headers = new Headers(response.headers);\nheaders.set('Access-Control-Expose-Headers', 'Mcp-Session-Id, MCP-Protocol-Version');\nreturn new Response(response.body, { status: response.status, headers });",
        },
      ],
    },
  },
  'transport.sse-content-type-mismatch': {
    title: 'Response Content-Type does not match the MCP transport',
    explanation: 'An MCP response must declare what it contains: text/event-stream for an SSE stream (the legacy SSE endpoint, a GET stream, or a streamed POST response) and application/json for a plain JSON-RPC response. The server returned a successful response with a different or missing Content-Type, so clients refuse it with errors such as "Invalid content type, expected text/event-stream" or "Unexpected content type". A CDN, reverse proxy or framework default (text/plain or text/html) is a frequent cause.',
    remediation: {
      summary: 'Set Content-Type: text/event-stream on SSE responses and application/json on JSON responses, and make sure proxies or CDNs in front of the server neither rewrite the header nor buffer the stream.',
      hints: [
        {
          stack: 'TypeScript SDK',
          code: "res.writeHead(200, {\n  'Content-Type': 'text/event-stream',\n  'Cache-Control': 'no-cache',\n  Connection: 'keep-alive',\n});\n// or new StreamableHTTPServerTransport({ enableJsonResponse: true }) for JSON replies",
        },
        {
          stack: 'Python SDK',
          code: 'return StreamingResponse(event_generator(), media_type="text/event-stream")\n# or FastMCP(..., json_response=True) for application/json replies',
        },
        {
          stack: 'Cloudflare Workers',
          code: "return new Response(readable, {\n  headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },\n});",
        },
      ],
    },
  },
};

const MAX_EVIDENCE_PER_DIAGNOSTIC = 6;

/**
 * Parses an HTTP Retry-After value: delta-seconds or an HTTP-date. Returns the
 * wait in whole seconds, or undefined when the value is absent or invalid.
 */
export const parseRetryAfter = (
  value: string | null | undefined,
  now: number = Date.now()
): number | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  // Negative or fractional numbers are invalid; do not let Date.parse read them as years.
  if (!/[a-z]/i.test(trimmed)) return undefined;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1000));
};

const mediaTypeEssence = (value: string | undefined): string | undefined => (
  value?.split(';', 1)[0].trim().toLowerCase() || undefined
);

const targetEndpoint = (request: ObservedTransportRequest): string => (
  request.targetUrl || request.candidateUrl || request.url
);

const isTargetResponse = (request: ObservedTransportRequest): boolean => (
  request.status !== undefined
  && request.responseSource === 'target'
  && !request.proxyLimit
);

const isSuccess = (status: number | undefined): boolean => (
  status !== undefined && status >= 200 && status < 300
);

const sessionHeaderReadable = (request: ObservedTransportRequest): boolean => (
  request.readableResponseHeaders?.includes('mcp-session-id') === true
);

const requestDescription = (request: ObservedTransportRequest): string => (
  `${request.method}${request.mcpMethod ? ` ${request.mcpMethod}` : ''}`
);

const toEvidence = (
  request: ObservedTransportRequest,
  route: TransportDiagnosticRoute,
  observation: string
): TransportDiagnosticEvidence => {
  const headersSeen: Record<string, string> = {};
  if (request.responseContentType) headersSeen['content-type'] = request.responseContentType;
  if (request.retryAfter) headersSeen['retry-after'] = request.retryAfter;
  const headersSent: Record<string, string> = {};
  if (request.requestAccept) headersSent.accept = request.requestAccept;
  if (request.requestContentType) headersSent['content-type'] = request.requestContentType;
  return {
    route,
    endpoint: targetEndpoint(request),
    method: request.method,
    ...(request.mcpMethod ? { mcpMethod: request.mcpMethod } : {}),
    ...(request.transportType ? { transportType: request.transportType } : {}),
    ...(request.status !== undefined ? { status: request.status } : {}),
    ...(request.responseSource ? { responseSource: request.responseSource } : {}),
    ...(Object.keys(headersSeen).length > 0 ? { headersSeen } : {}),
    ...(Object.keys(headersSent).length > 0 ? { headersSent } : {}),
    observation,
  };
};

const createDiagnostic = (
  id: TransportDiagnosticId,
  severity: TransportDiagnosticSeverity,
  evidence: TransportDiagnosticEvidence[],
  extra: Pick<TransportDiagnostic, 'retryAfterSeconds' | 'notCheckedReason'> & {
    status?: TransportDiagnostic['status'];
  } = {}
): TransportDiagnostic => {
  const definition = TRANSPORT_DIAGNOSTIC_DEFINITIONS[id];
  return {
    id,
    status: extra.status ?? 'detected',
    severity,
    title: definition.title,
    explanation: definition.explanation,
    evidence,
    remediation: definition.remediation,
    ...(extra.retryAfterSeconds !== undefined ? { retryAfterSeconds: extra.retryAfterSeconds } : {}),
    ...(extra.notCheckedReason ? { notCheckedReason: extra.notCheckedReason } : {}),
  };
};

const rateLimitObservation = (
  request: ObservedTransportRequest,
  retryAfterSeconds: number | undefined
): string => {
  const wait = request.retryAfter === undefined
    ? 'No readable Retry-After header (absent, or not listed in Access-Control-Expose-Headers).'
    : retryAfterSeconds === undefined
      ? `Retry-After "${request.retryAfter}" is not a valid number of seconds or HTTP date.`
      : `Retry-After asks clients to wait ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.`;
  const retry = request.rateLimitRetry?.action === 'retried'
    ? ` mcptest retried once after waiting ${formatRetryWait(Math.ceil((request.rateLimitRetry.waitMs ?? 0) / 1000))}.`
    : request.rateLimitRetry?.reason
      ? ` Not retried automatically: ${request.rateLimitRetry.reason}`
      : '';
  return `The MCP server answered ${requestDescription(request)} with HTTP 429. ${wait}${retry}`;
};

/**
 * Detects transport diagnostics in the ordered requests of one connection
 * route. Only responses attributable to the target are considered, so a proxy
 * response (for example the proxy's own 406 or caller-limit 429) never becomes
 * a target diagnostic.
 */
export const detectTransportDiagnostics = (
  requests: readonly ObservedTransportRequest[],
  route: TransportDiagnosticRoute
): TransportDiagnostic[] => {
  const diagnostics: TransportDiagnostic[] = [];

  for (const [index, request] of requests.entries()) {
    if (!isTargetResponse(request)) continue;
    const status = request.status as number;
    const streamableGet = request.method === 'GET' && request.transportType === 'streamable-http';

    if (status === 406) {
      diagnostics.push(createDiagnostic(
        'transport.accept-header-406',
        streamableGet ? 'warning' : 'error',
        [toEvidence(request, route, `The MCP server answered ${requestDescription(request)} with HTTP 406 although the request sent Accept: ${request.requestAccept || '(unknown)'}.`)]
      ));
    } else if (status === 405 && streamableGet) {
      diagnostics.push(createDiagnostic(
        'transport.get-stream-405',
        'warning',
        [toEvidence(request, route, 'The optional GET stream for server-initiated messages was refused with HTTP 405. POST requests are unaffected.')]
      ));
    } else if (status === 415) {
      diagnostics.push(createDiagnostic(
        'transport.unsupported-media-type-415',
        'error',
        [toEvidence(request, route, `The MCP server answered ${requestDescription(request)} with HTTP 415 for Content-Type: ${request.requestContentType || '(unknown)'}.`)]
      ));
    } else if (status === 429) {
      const now = request.startedAt ? Date.parse(request.startedAt) : Date.now();
      const retryAfterSeconds = parseRetryAfter(request.retryAfter, Number.isNaN(now) ? Date.now() : now);
      const recovered = request.rateLimitRetry?.action === 'retried' && requests.slice(index + 1).some((later) => (
        later.automaticRetry?.reason === 'target-rate-limit'
        && later.candidateUrl === request.candidateUrl
        && isSuccess(later.status)
      ));
      diagnostics.push(createDiagnostic(
        'transport.target-rate-limited-429',
        recovered ? 'warning' : 'error',
        [toEvidence(request, route, rateLimitObservation(request, retryAfterSeconds))],
        retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}
      ));
    } else if (isSuccess(status) && status !== 202 && status !== 204) {
      const essence = mediaTypeEssence(request.responseContentType);
      const shown = request.responseContentType || '(missing)';
      // An HTML page on GET is a website at a guessed sibling path, not a
      // mislabelled MCP stream; the attempts table already shows it.
      if (request.method === 'GET' && essence !== 'text/event-stream' && essence !== 'text/html') {
        diagnostics.push(createDiagnostic(
          'transport.sse-content-type-mismatch',
          streamableGet ? 'warning' : 'error',
          [toEvidence(request, route, `The ${request.transportType === 'legacy-sse' ? 'legacy SSE endpoint' : 'GET stream'} answered HTTP ${status} with Content-Type ${shown} instead of text/event-stream.`)]
        ));
      } else if (
        request.method === 'POST'
        && request.transportType === 'streamable-http'
        && request.mcpMethod
        && !request.mcpMethod.startsWith('notifications/')
        && essence !== 'application/json'
        && essence !== 'text/event-stream'
      ) {
        diagnostics.push(createDiagnostic(
          'transport.sse-content-type-mismatch',
          'error',
          [toEvidence(request, route, `The response to POST ${request.mcpMethod} had Content-Type ${shown}; expected application/json or text/event-stream.`)]
        ));
      }
    }

    // A readable, cross-origin initialize without a readable session id,
    // followed by a session rejection, means the id was issued but not exposed.
    if (
      route === 'direct'
      && request.method === 'POST'
      && request.mcpMethod === 'initialize'
      && request.transportType === 'streamable-http'
      && request.crossOrigin === true
      && isSuccess(status)
      && !sessionHeaderReadable(request)
    ) {
      const rejected = requests.slice(index + 1).find((later) => (
        later.candidateUrl === request.candidateUrl
        && later.transportType === request.transportType
        && later.mcpMethod !== 'initialize'
        && isTargetResponse(later)
        && (later.status === 400 || later.status === 404)
        && !later.requestHeaders?.some((header) => header.toLowerCase() === 'mcp-session-id')
      ));
      if (rejected) {
        diagnostics.push(createDiagnostic(
          'transport.cors-expose-headers-missing',
          'error',
          [
            toEvidence(request, route, `initialize succeeded with HTTP ${status}, but the browser could not read Mcp-Session-Id${request.readableResponseHeaders?.includes('mcp-protocol-version') ? '' : ' or MCP-Protocol-Version'} on the response.`),
            toEvidence(rejected, route, `The next request, ${requestDescription(rejected)}, was sent without a session id and rejected with HTTP ${rejected.status}.`),
          ]
        ));
      }
    }
  }

  return diagnostics;
};

const severityRank: Record<TransportDiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Combines diagnostics with the same id into one, keeping the strongest severity. */
export const mergeTransportDiagnostics = (
  diagnostics: readonly TransportDiagnostic[]
): TransportDiagnostic[] => {
  const merged = new Map<TransportDiagnosticId, TransportDiagnostic>();
  for (const diagnostic of diagnostics) {
    const existing = merged.get(diagnostic.id);
    if (!existing || (existing.status === 'not-checked' && diagnostic.status === 'detected')) {
      merged.set(diagnostic.id, { ...diagnostic, evidence: [...diagnostic.evidence] });
      continue;
    }
    if (diagnostic.status === 'not-checked') continue;
    const evidenceKeys = new Set(existing.evidence.map((item) => JSON.stringify(item)));
    for (const item of diagnostic.evidence) {
      const key = JSON.stringify(item);
      if (evidenceKeys.has(key) || existing.evidence.length >= MAX_EVIDENCE_PER_DIAGNOSTIC) continue;
      evidenceKeys.add(key);
      existing.evidence.push(item);
    }
    if (severityRank[diagnostic.severity] < severityRank[existing.severity]) {
      existing.severity = diagnostic.severity;
    }
    if (diagnostic.retryAfterSeconds !== undefined) {
      existing.retryAfterSeconds = Math.max(existing.retryAfterSeconds ?? 0, diagnostic.retryAfterSeconds);
    }
  }
  return [...merged.values()].sort((left, right) => (
    severityRank[left.severity] - severityRank[right.severity]
  ));
};

export interface TransportDiagnosticSource {
  route: TransportDiagnosticRoute;
  requests: readonly ObservedTransportRequest[];
}

/** Collects every candidate's observed requests from a failed connection error. */
export const observedRequestsFromError = (
  error: unknown,
  seen = new Set<object>()
): ObservedTransportRequest[][] => {
  if (!error || typeof error !== 'object' || seen.has(error)) return [];
  seen.add(error);
  const value = error as {
    candidateFailures?: readonly TransportCandidateFailure[];
    errors?: readonly unknown[];
    cause?: unknown;
  };
  const groups: ObservedTransportRequest[][] = [];
  const represented = new Set<unknown>();
  for (const failure of Array.isArray(value.candidateFailures) ? value.candidateFailures : []) {
    represented.add(failure.error);
    if (failure.observedRequests?.length) groups.push([...failure.observedRequests]);
    else groups.push(...observedRequestsFromError(failure.error, seen));
  }
  for (const nested of Array.isArray(value.errors) ? value.errors : []) {
    if (!represented.has(nested)) groups.push(...observedRequestsFromError(nested, seen));
  }
  groups.push(...observedRequestsFromError(value.cause, seen));
  return groups;
};

export const transportDiagnosticSourcesFromFailures = (
  failures: ReadonlyArray<{ route: TransportDiagnosticRoute; error: unknown }>
): TransportDiagnosticSource[] => failures.flatMap(({ route, error }) => (
  observedRequestsFromError(error).map((requests) => ({ route, requests }))
));

export type TransportDiagnosticRuntime = 'browser' | 'headless';

const exposeHeadersNotChecked = (reason: string): TransportDiagnostic => createDiagnostic(
  'transport.cors-expose-headers-missing',
  'info',
  [],
  { status: 'not-checked', notCheckedReason: reason }
);

/**
 * Says explicitly when the Expose-Headers check could not be performed. The
 * check needs a readable, cross-origin, direct initialize response; anything
 * the browser read through the proxy describes the proxy's headers instead.
 */
const exposeHeadersCheckStatus = (
  sources: readonly TransportDiagnosticSource[],
  runtime: TransportDiagnosticRuntime
): TransportDiagnostic | undefined => {
  const requests = sources.flatMap(({ requests: items }) => items);
  if (!requests.some((request) => request.transportType === 'streamable-http')) return undefined;
  if (runtime === 'headless') {
    return exposeHeadersNotChecked('This run did not use a browser, so CORS header exposure was not observed.');
  }
  const directInitialize = sources.some(({ route, requests: items }) => route === 'direct' && items.some((request) => (
    request.mcpMethod === 'initialize'
    && request.transportType === 'streamable-http'
    && request.crossOrigin === true
    && isTargetResponse(request)
    && isSuccess(request.status)
  )));
  if (directInitialize) return undefined;
  const statelessOnly = !requests.some((request) => request.mcpMethod === 'initialize');
  if (statelessOnly) return undefined;
  if (sources.some(({ route }) => route === 'proxy')) {
    return exposeHeadersNotChecked('The connection went through the mcptest proxy, so the browser read the proxy\'s response headers, not the MCP server\'s. Access-Control-Expose-Headers on the server could not be checked.');
  }
  return exposeHeadersNotChecked('No direct, cross-origin initialize response was readable by the browser, so Access-Control-Expose-Headers could not be checked.');
};

/**
 * Builds the diagnostics for one connection or evaluation from every route it
 * attempted, including the explicit "not checked" status for Expose-Headers.
 */
export const collectTransportDiagnostics = (
  sources: readonly TransportDiagnosticSource[],
  runtime: TransportDiagnosticRuntime = 'browser'
): TransportDiagnostic[] => {
  const detected = sources.flatMap(({ route, requests }) => detectTransportDiagnostics(requests, route));
  const hasExposeFinding = detected.some(({ id }) => id === 'transport.cors-expose-headers-missing');
  const status = hasExposeFinding ? undefined : exposeHeadersCheckStatus(sources, runtime);
  return mergeTransportDiagnostics(status ? [...detected, status] : detected);
};

/** Diagnostics that are findings against the server (not "not checked" notes). */
export const detectedTransportDiagnostics = (
  diagnostics: readonly TransportDiagnostic[] | undefined
): TransportDiagnostic[] => (diagnostics || []).filter(({ status }) => status === 'detected');

/** Short human description of a wait, for UI and report text. */
export const formatRetryWait = (seconds: number): string => {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
};

const reportIcon = (diagnostic: TransportDiagnostic): string => {
  if (diagnostic.status === 'not-checked') return 'ℹ';
  return diagnostic.severity === 'error' ? '✗' : diagnostic.severity === 'warning' ? '⚠' : 'ℹ';
};

/**
 * Report evidence item carrying the full diagnostic under one metadata key, so
 * the JSON and Markdown artifacts keep its stable id without a schema change.
 */
export const transportDiagnosticReportDetail = (diagnostic: TransportDiagnostic): {
  text: string;
  context: string;
  metadata: { transportDiagnostic: TransportDiagnostic };
} => ({
  text: diagnostic.status === 'not-checked'
    ? `${reportIcon(diagnostic)} Check not performed: ${diagnostic.title} (${diagnostic.id})`
    : `${reportIcon(diagnostic)} ${diagnostic.title} (${diagnostic.id})`,
  context: diagnostic.status === 'not-checked'
    ? diagnostic.notCheckedReason || diagnostic.explanation
    : diagnostic.explanation,
  metadata: { transportDiagnostic: diagnostic },
});

const isDiagnosticRecord = (value: unknown): value is TransportDiagnostic => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && record.id in TRANSPORT_DIAGNOSTIC_DEFINITIONS
    && (record.status === 'detected' || record.status === 'not-checked')
    && (record.severity === 'error' || record.severity === 'warning' || record.severity === 'info');
};

/** Reads the transport diagnostics an evaluation report recorded in its section evidence. */
export const transportDiagnosticsFromSections = (
  sections: Record<string, { details: ReadonlyArray<{ metadata?: unknown }> }>
): TransportDiagnostic[] => Object.values(sections)
  .flatMap((section) => section.details)
  .map((detail) => (detail.metadata as { transportDiagnostic?: unknown } | undefined)?.transportDiagnostic)
  .filter(isDiagnosticRecord);
