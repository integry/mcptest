// Public MCP fixtures share method dispatch with the read-only catalog endpoint.
// Fixture state lives in FixtureState. The catalog retains self-validating IDs.
import { RESOURCE_METADATA, ISSUER_METADATA, oauthAccess, oauthEndpoint, seconds } from './fixtureOAuth.js';
import { compileSchema } from './jsonSchema.js';
import {
  FIXTURE_NAMES,
  FIXTURE_SERVERS,
  FIXTURE_SERVER_VERSION,
  FixtureRpcError,
} from './fixtureServers.js';

export const FIXTURE_OBJECT_PREFIX = 'fixture:';
export const FIXTURE_PATH = /^\/fixtures\/([^/]+)\/mcp\/?$/;
export const MAX_FIXTURE_BODY_BYTES = 16 * 1024;
export const MODERN_PROTOCOL_VERSION = '2026-07-28';
export const LEGACY_PROTOCOL_VERSION = '2025-11-25';
export const LEGACY_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MODERN_PROTOCOL_VERSIONS = [MODERN_PROTOCOL_VERSION];

const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CLIENT_INFO = 'io.modelcontextprotocol/clientInfo';
const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';
const CACHEABLE_METHODS = new Set(['tools/list', 'prompts/list', 'resources/list', 'resources/templates/list', 'resources/read', 'server/discover']);

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const SESSION_NOT_FOUND = -32001;
const HEADER_MISMATCH = -32020;
const UNSUPPORTED_PROTOCOL_VERSION = -32022;

export const FIXTURE_CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, MCP-Protocol-Version, WWW-Authenticate, Retry-After',
  'Access-Control-Max-Age': '7200',
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const defaultWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const respond = (status, body, headers = {}) => new Response(
  body === undefined ? null : JSON.stringify(body),
  {
    status,
    headers: {
      ...FIXTURE_CORS_HEADERS,
      'Cache-Control': 'no-store',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
  },
);

const rpcError = (id, code, message, data) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});

// ---------------------------------------------------------------------------
// Session ID format shared with the catalog
// ---------------------------------------------------------------------------

const SESSION_PREFIX = 'mcptest-fx-';
const toHex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const sessionDigest = async (fixtureName, nonce) => toHex(await crypto.subtle.digest(
  'SHA-256',
  new TextEncoder().encode(`mcptest-fixture-session:${fixtureName}:${nonce}`),
)).slice(0, 16);

export const createFixtureSessionId = async (fixtureName) => {
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return `${SESSION_PREFIX}${nonce}.${await sessionDigest(fixtureName, nonce)}`;
};

/** Checks the self-validating format used by the storage-free catalog endpoint. */
export const isFixtureSessionId = async (fixtureName, value) => {
  const match = /^mcptest-fx-([0-9a-f]{32})\.([0-9a-f]{16})$/.exec(value ?? '');
  return Boolean(match) && match[2] === await sessionDigest(fixtureName, match[1]);
};

// ---------------------------------------------------------------------------
// Request reading
// ---------------------------------------------------------------------------

class HttpFailure extends Error {
  constructor(status, body, headers) {
    super(body?.error?.message ?? `HTTP ${status}`);
    this.response = respond(status, body, headers);
  }
}

const readBody = async (request) => {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_FIXTURE_BODY_BYTES) {
    throw new HttpFailure(413, rpcError(null, INVALID_REQUEST, `Request body exceeds ${MAX_FIXTURE_BODY_BYTES} bytes`));
  }
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FIXTURE_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new HttpFailure(413, rpcError(null, INVALID_REQUEST, `Request body exceeds ${MAX_FIXTURE_BODY_BYTES} bytes`));
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

const parseMessage = (text) => {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    throw new HttpFailure(400, rpcError(null, PARSE_ERROR, 'Parse error: the body is not valid JSON'));
  }
  if (Array.isArray(message)) {
    throw new HttpFailure(400, rpcError(null, INVALID_REQUEST, 'Invalid Request: JSON-RPC batches are not supported'));
  }
  const kind = isObject(message) ? classifyMessage(message) : undefined;
  if (!kind) {
    const id = isObject(message) && isValidId(message.id) ? message.id : null;
    throw new HttpFailure(400, rpcError(id, INVALID_REQUEST, 'Invalid Request: expected a JSON-RPC 2.0 request, notification or response'));
  }
  return { message, kind };
};

// JSON-RPC ids are strings or numbers; MCP additionally forbids null for
// requests. Infinity can only appear via an overflowing literal (1e400).
const isValidId = (id) => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
const isValidParams = (params) => params === undefined || isObject(params) || Array.isArray(params);
const isValidErrorObject = (error) => isObject(error)
  && Number.isInteger(error.code)
  && typeof error.message === 'string';

/**
 * Classifies a parsed JSON-RPC 2.0 object as 'request', 'notification' or
 * 'response', or returns undefined when the envelope is malformed (wrong
 * jsonrpc marker, non-string method, invalid id type, bad params, or a
 * response without exactly one well-formed result/error).
 */
const classifyMessage = (message) => {
  if (message.jsonrpc !== '2.0') return undefined;
  const hasId = Object.hasOwn(message, 'id');
  if (Object.hasOwn(message, 'method')) {
    if (typeof message.method !== 'string' || !isValidParams(message.params)) return undefined;
    if (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error')) return undefined;
    if (!hasId) return 'notification';
    return isValidId(message.id) ? 'request' : undefined;
  }
  const hasResult = Object.hasOwn(message, 'result');
  const hasError = Object.hasOwn(message, 'error');
  if (hasResult === hasError || !hasId) return undefined;
  if (hasResult) return isValidId(message.id) ? 'response' : undefined;
  // An error response may carry id null when the request id was unreadable.
  if (!isValidErrorObject(message.error)) return undefined;
  return message.id === null || isValidId(message.id) ? 'response' : undefined;
};

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

const authorizationFailure = (fixture, request) => {
  if (fixture.auth?.type !== 'bearer') return undefined;
  const header = request.headers.get('authorization');
  const token = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '')?.[1];
  if (token === fixture.auth.token) return undefined;
  const realm = 'realm="mcptest.io fixtures"';
  const challenge = header
    ? `Bearer ${realm}, error="invalid_token", error_description="Use the public token ${fixture.auth.token}"`
    : `Bearer ${realm}`;
  return respond(401, rpcError(null, -32001, `Unauthorized: send Authorization: Bearer ${fixture.auth.token}. See /mcp-test-servers`), {
    'WWW-Authenticate': challenge,
  });
};

// ---------------------------------------------------------------------------
// Era resolution and result encoding
// ---------------------------------------------------------------------------

const resolveModernEra = (message, request, fixture) => {
  const meta = isObject(message.params?._meta) ? message.params._meta : undefined;
  const version = meta?.[META_PROTOCOL_VERSION];
  const headerVersion = request.headers.get('mcp-protocol-version');
  if (typeof version !== 'string' || !isObject(meta[META_CLIENT_CAPABILITIES])) {
    throw new HttpFailure(400, rpcError(message.id, INVALID_PARAMS,
      `Request is missing the required _meta envelope for protocol revision ${MODERN_PROTOCOL_VERSION} (${META_PROTOCOL_VERSION}, ${META_CLIENT_CAPABILITIES})`));
  }
  if (!MODERN_PROTOCOL_VERSIONS.includes(version)) {
    throw new HttpFailure(400, rpcError(message.id, UNSUPPORTED_PROTOCOL_VERSION, `Unsupported protocol version ${version}`, {
      supported: fixture.mode === 'stateless' ? MODERN_PROTOCOL_VERSIONS : [...MODERN_PROTOCOL_VERSIONS, ...LEGACY_PROTOCOL_VERSIONS],
      requested: version,
    }));
  }
  if (headerVersion !== null && headerVersion !== version) {
    throw new HttpFailure(400, rpcError(message.id, HEADER_MISMATCH, 'MCP-Protocol-Version header does not match the _meta protocol version'));
  }
  const headerMethod = request.headers.get('mcp-method');
  if (headerMethod !== null && headerMethod !== message.method) {
    throw new HttpFailure(400, rpcError(message.id, HEADER_MISMATCH, 'Mcp-Method header does not match the JSON-RPC method'));
  }
  const headerName = request.headers.get('mcp-name');
  const bodyName = message.params?.name ?? message.params?.uri;
  if (headerName !== null && typeof bodyName === 'string' && headerName !== bodyName) {
    throw new HttpFailure(400, rpcError(message.id, HEADER_MISMATCH, 'Mcp-Name header does not match the request params'));
  }
  const clientInfo = meta[META_CLIENT_INFO];
  return {
    era: 'modern',
    protocolVersion: version,
    ...(isObject(clientInfo) && typeof clientInfo.name === 'string' ? {
      clientInfo: {
        name: clientInfo.name.slice(0, 100),
        ...(typeof clientInfo.version === 'string' ? { version: clientInfo.version.slice(0, 50) } : {}),
      },
    } : {}),
  };
};

// \`id\` is the JSON-RPC id to echo in an error: the request id, or null for
// notifications and client responses (whose id belongs to a server request).
const resolveLegacyEra = async (request, fixture, id, event) => {
  const headerVersion = request.headers.get('mcp-protocol-version');
  if (headerVersion !== null && !LEGACY_PROTOCOL_VERSIONS.includes(headerVersion)) {
    throw new HttpFailure(400, rpcError(id, INVALID_REQUEST, `Bad Request: unsupported MCP-Protocol-Version ${headerVersion}`));
  }
  const sessionId = request.headers.get('mcp-session-id');
  if (!sessionId) {
    throw new HttpFailure(400, rpcError(id, INVALID_REQUEST,
      'Bad Request: Mcp-Session-Id header is required; send initialize first, or server/discover for the stateless revision'));
  }
  const key = 'session:' + sessionId;
  const session = fixture.store?.get(key);
  const known = fixture.store
    ? session && session.expiresAt > Date.now() && !session.deleteReceived && session.clientId === fixture.clientId
    : await isFixtureSessionId(fixture.name, sessionId);
  if (!known) throw new HttpFailure(404, rpcError(id, SESSION_NOT_FOUND, 'Session not found'));
  if (session) {
    session.requestCount++;
    if (event === 'initialized') session.initialized = true;
    if (event === 'delete') session.deleteReceived = true;
    fixture.store.set(key, session);
  }
  return { era: 'legacy', protocolVersion: headerVersion ?? session?.protocolVersion ?? LEGACY_PROTOCOL_VERSION };
};

const isModernMessage = (message, request) => {
  const meta = message.params?._meta;
  const headerVersion = request.headers.get('mcp-protocol-version');
  return message.method === 'server/discover'
    || (isObject(meta) && META_PROTOCOL_VERSION in meta)
    || (headerVersion !== null && headerVersion >= MODERN_PROTOCOL_VERSION);
};

const resolveEra = (message, request, fixture) => (isModernMessage(message, request)
  ? resolveModernEra(message, request, fixture)
  : resolveLegacyEra(request, fixture, message.id));

/**
 * Validates a notification or client response before it is accepted with 202.
 * Stateless 2026 traffic needs no session but must name a supported revision
 * (header and _meta agreeing when both are sent); anything else is stateful and
 * must carry an Mcp-Session-Id this worker issued (400 missing, 404 unknown).
 */
const validateNonRequest = async (message, request, fixture) => {
  if (!isModernMessage(message, request)) {
    await resolveLegacyEra(request, fixture, null,
      !Object.hasOwn(message, 'id') && message.method === 'notifications/initialized' ? 'initialized' : undefined);
    return;
  }
  const headerVersion = request.headers.get('mcp-protocol-version');
  const meta = isObject(message.params?._meta) ? message.params._meta : undefined;
  const metaVersion = meta?.[META_PROTOCOL_VERSION];
  const version = typeof metaVersion === 'string' ? metaVersion : headerVersion;
  if (!MODERN_PROTOCOL_VERSIONS.includes(version)) {
    throw new HttpFailure(400, rpcError(null, UNSUPPORTED_PROTOCOL_VERSION, `Unsupported protocol version ${version}`, {
      supported: fixture.mode === 'stateless' ? MODERN_PROTOCOL_VERSIONS : [...MODERN_PROTOCOL_VERSIONS, ...LEGACY_PROTOCOL_VERSIONS],
      requested: version,
    }));
  }
  if (headerVersion !== null && headerVersion !== version) {
    throw new HttpFailure(400, rpcError(null, HEADER_MISMATCH, 'MCP-Protocol-Version header does not match the _meta protocol version'));
  }
};

const serverInfo = (fixture) => fixture.serverInfo
  ?? { name: `mcptest-fixture-${fixture.name}`, title: fixture.title, version: FIXTURE_SERVER_VERSION };

const encodeResult = (method, result, fixture, era) => {
  if (era !== 'modern') return result;
  return {
    ...result,
    resultType: 'complete',
    ...(CACHEABLE_METHODS.has(method) ? { ttlMs: 0, cacheScope: 'public' } : {}),
    _meta: { ...(result._meta ?? {}), [META_SERVER_INFO]: serverInfo(fixture) },
  };
};

const capabilities = (fixture) => ({
  tools: { listChanged: false },
  ...(fixture.resources.length ? { resources: { subscribe: false, listChanged: false } } : {}),
  ...(fixture.prompts.length ? { prompts: { listChanged: false } } : {}),
});

// ---------------------------------------------------------------------------
// Method dispatch
// ---------------------------------------------------------------------------

const validators = new WeakMap();
const validateArguments = (tool, args) => {
  if (!validators.has(tool)) validators.set(tool, compileSchema(tool.definition.inputSchema));
  const { valid, errors } = validators.get(tool)(args);
  if (!valid) {
    throw new FixtureRpcError(INVALID_PARAMS, `Invalid params for tool ${tool.definition.name}`, {
      data: { errors: errors.slice(0, 10) },
    });
  }
};

const requireCapability = (fixture, key, method) => {
  if (!fixture[key].length) throw new FixtureRpcError(METHOD_NOT_FOUND, `Method not found: ${method}`);
};

const dispatch = async (message, fixture, context) => {
  const params = isObject(message.params) ? message.params : {};
  switch (message.method) {
    case 'ping':
      return {};
    case 'server/discover':
      return {
        supportedVersions: fixture.mode === 'stateless' ? MODERN_PROTOCOL_VERSIONS : [...MODERN_PROTOCOL_VERSIONS, ...LEGACY_PROTOCOL_VERSIONS],
        capabilities: capabilities(fixture),
        instructions: fixture.instructions,
      };
    case 'tools/list':
      return { tools: fixture.tools.map((tool) => tool.definition) };
    case 'tools/call': {
      const tool = fixture.tools.find((candidate) => candidate.definition.name === params.name);
      if (!tool) throw new FixtureRpcError(INVALID_PARAMS, `Unknown tool: ${String(params.name).slice(0, 100)}`);
      const args = params.arguments ?? {};
      validateArguments(tool, args);
      return tool.run(args, context);
    }
    case 'resources/list':
      requireCapability(fixture, 'resources', message.method);
      return { resources: fixture.resources.map((resource) => resource.definition) };
    case 'resources/templates/list':
      requireCapability(fixture, 'resources', message.method);
      return { resourceTemplates: [] };
    case 'resources/read': {
      requireCapability(fixture, 'resources', message.method);
      const resource = fixture.resources.find((candidate) => candidate.definition.uri === params.uri);
      if (!resource) throw new FixtureRpcError(-32002, 'Resource not found', { data: { uri: String(params.uri).slice(0, 200) } });
      const { uri, mimeType } = resource.definition;
      return { contents: [{ uri, mimeType, text: resource.text }] };
    }
    case 'prompts/list':
      requireCapability(fixture, 'prompts', message.method);
      return { prompts: fixture.prompts.map((prompt) => prompt.definition) };
    case 'prompts/get': {
      requireCapability(fixture, 'prompts', message.method);
      const prompt = fixture.prompts.find((candidate) => candidate.definition.name === params.name);
      if (!prompt) throw new FixtureRpcError(INVALID_PARAMS, `Unknown prompt: ${String(params.name).slice(0, 100)}`);
      return prompt.render(params.arguments);
    }
    default:
      throw new FixtureRpcError(METHOD_NOT_FOUND, `Method not found: ${String(message.method).slice(0, 100)}`);
  }
};

const errorResponseFor = (error, id) => {
  if (error instanceof FixtureRpcError) {
    return { status: error.httpStatus ?? 200, body: rpcError(id, error.code, error.message, error.data) };
  }
  console.error('[fixtures] unexpected error', error);
  return { status: 200, body: rpcError(id, -32603, 'Internal error') };
};

/**
 * Returns a description of what is wrong with initialize params, or undefined
 * when they carry a string protocolVersion, object capabilities and a
 * clientInfo with string name and version. An unsupported but well-typed
 * version is not an error here: initialize negotiates it down instead.
 */
const initializeParamsProblem = (params) => {
  if (!isObject(params)) return 'params must be an object';
  if (typeof params.protocolVersion !== 'string') return 'params.protocolVersion must be a string';
  if (!isObject(params.capabilities)) return 'params.capabilities must be an object';
  const { clientInfo } = params;
  if (!isObject(clientInfo)) return 'params.clientInfo must be an object';
  if (typeof clientInfo.name !== 'string') return 'params.clientInfo.name must be a string';
  if (typeof clientInfo.version !== 'string') return 'params.clientInfo.version must be a string';
  return undefined;
};

const initialize = async (message, fixture, request) => {
  const problem = initializeParamsProblem(message.params);
  if (problem) {
    // Rejected before any session is issued, so a broken handshake never
    // yields a usable Mcp-Session-Id.
    return respond(400, rpcError(message.id, INVALID_PARAMS, `Invalid params for initialize: ${problem}`));
  }
  const requested = message.params.protocolVersion;
  const protocolVersion = LEGACY_PROTOCOL_VERSIONS.includes(requested) ? requested : LEGACY_PROTOCOL_VERSION;
  const sessionId = await createFixtureSessionId(fixture.name);
  if (fixture.store) {
    const ttl = seconds(new URL(request.url).searchParams.get('session_ttl'), 3600);
    if (!ttl) return respond(400, rpcError(message.id, INVALID_PARAMS, 'session_ttl must be 1 to 3600 seconds'));
    fixture.store.set('session:' + sessionId, {
      protocolVersion, initialized: false, deleteReceived: false, requestCount: 1,
      expiresAt: Date.now() + 1000 * ttl, clientId: fixture.clientId,
    });
  }
  return respond(200, {
    jsonrpc: '2.0',
    id: message.id,
    result: {
      protocolVersion,
      capabilities: capabilities(fixture),
      serverInfo: serverInfo(fixture),
      instructions: fixture.instructions,
    },
  }, { 'Mcp-Session-Id': sessionId, 'MCP-Protocol-Version': protocolVersion });
};

const streamToolCall = (message, fixture, context, protocolVersion) => {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (payload) => writer.write(encoder.encode(`event: message\ndata: ${JSON.stringify(payload)}\n\n`));
  const progressToken = message.params?._meta?.progressToken;
  const streamingContext = {
    ...context,
    progress: (progress, total, text) => (progressToken === undefined ? Promise.resolve() : send({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progressToken, progress, total, message: text },
    })),
  };
  (async () => {
    let payload;
    try {
      const result = await dispatch(message, fixture, streamingContext);
      payload = { jsonrpc: '2.0', id: message.id, result: encodeResult(message.method, result, fixture, context.era) };
    } catch (error) {
      payload = errorResponseFor(error, message.id).body;
    }
    await send(payload);
    await writer.close();
  })().catch(() => writer.abort().catch(() => {}));
  return new Response(readable, {
    status: 200,
    headers: {
      ...FIXTURE_CORS_HEADERS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'MCP-Protocol-Version': protocolVersion,
    },
  });
};

// Stateless OAuth traffic has no MCP session ID. Use its registration ID as
// the diagnostics handle, so a harness can still observe a refresh and retry.
function recordStatelessOAuth(fixture, protocolVersion) {
  if (!fixture.clientId) return;
  const key = 'session:' + fixture.clientId;
  const previous = fixture.store.get(key);
  fixture.store.set(key, {
    clientId: fixture.clientId, protocolVersion, requestCount: (previous?.requestCount ?? 0) + 1,
    initialized: false, deleteReceived: false, stateless: true,
  });
}

const handlePost = async (request, fixture, options) => {
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(contentType)) {
    return respond(415, rpcError(null, INVALID_REQUEST, 'Unsupported Media Type: send Content-Type: application/json'));
  }
  const { message, kind } = parseMessage(await readBody(request));
  const modern = message.method !== 'initialize' && isModernMessage(message, request);
  if (fixture.mode === 'stateful' && modern) {
    return respond(400, rpcError(message.id, METHOD_NOT_FOUND, 'Stateful fixture: send initialize first'));
  }
  if (fixture.mode === 'stateless' && !modern) {
    return respond(400, rpcError(message.id, UNSUPPORTED_PROTOCOL_VERSION, 'Stateless fixture requires ' + MODERN_PROTOCOL_VERSION,
      { supported: MODERN_PROTOCOL_VERSIONS }));
  }
  if (kind !== 'request') {
    // Well-formed notifications (notifications/initialized, cancelled, ...) and
    // client responses, once their session or stateless revision checks out.
    await validateNonRequest(message, request, fixture);
    if (modern) recordStatelessOAuth(fixture, MODERN_PROTOCOL_VERSION);
    return respond(202, undefined);
  }
  if (message.method === 'initialize') return initialize(message, fixture, request);

  const eraContext = await resolveEra(message, request, fixture);
  if (eraContext.era === 'modern') recordStatelessOAuth(fixture, eraContext.protocolVersion);
  const context = {
    ...eraContext,
    fixture: fixture.name,
    headers: request.headers,
    wait: (ms) => options.wait(Math.max(0, Math.min(ms, 10_000))),
    progress: () => Promise.resolve(),
  };
  const tool = message.method === 'tools/call'
    ? fixture.tools.find((candidate) => candidate.definition.name === message.params?.name)
    : undefined;
  if (tool?.streams && /text\/event-stream/i.test(request.headers.get('accept') ?? '')) {
    return streamToolCall(message, fixture, context, eraContext.protocolVersion);
  }
  try {
    const result = await dispatch(message, fixture, context);
    return respond(200, {
      jsonrpc: '2.0',
      id: message.id,
      result: encodeResult(message.method, result, fixture, eraContext.era),
    }, { 'MCP-Protocol-Version': eraContext.protocolVersion });
  } catch (error) {
    const { status, body } = errorResponseFor(error, message.id);
    return respond(status, body);
  }
};

/**
 * Handles /fixtures/<name>/mcp. Returns undefined for any other path so the
 * worker's other routes are untouched.
 */
export const handleFixtureRequest = async (request, options = {}) => {
  const url = new URL(request.url);
  const { pathname } = url;
  const metadata = [RESOURCE_METADATA, ISSUER_METADATA].includes(pathname);
  if (!metadata && pathname !== '/fixtures' && !pathname.startsWith('/fixtures/')) return undefined;
  if (request.method === 'OPTIONS') return respond(204);
  const match = /^\/fixtures\/([^/]+)\/sessions\/([^/]+)$/.exec(pathname);
  const oauth = metadata || /^\/fixtures\/oauth\/(register|authorize|token|revoke)$/.test(pathname);
  const name = oauth ? 'oauth' : match?.[1] ?? FIXTURE_PATH.exec(pathname)?.[1];
  if (!Object.hasOwn(FIXTURE_SERVERS, name)) {
    return respond(404, { error: 'Unknown fixture', fixtures: FIXTURE_NAMES.map(n => `/fixtures/${n}/mcp`) });
  }
  const { store } = options;
  if (!store) {
    const ns = options.env.SUBMISSION_RATE_LIMITER;
    const response = await ns.get(ns.idFromName(FIXTURE_OBJECT_PREFIX + url.origin + '/' + name)).fetch(request);
    // The object binding is an internal HTTP hop. Only forward the fixture's
    // end-to-end headers, and let the edge frame the body for HTTP/1 or HTTP/2.
    const headers = new Headers();
    for (const key of [...Object.keys(FIXTURE_CORS_HEADERS), 'Content-Type', 'Cache-Control', 'Allow',
      'Location', 'WWW-Authenticate', 'Mcp-Session-Id', 'MCP-Protocol-Version']) {
      if (response.headers.has(key)) headers.set(key, response.headers.get(key));
    }
    return new Response(response.body, { status: response.status, headers });
  }
  try {
    if (oauth) return await oauthEndpoint(request, store, readBody, respond);
    if (match) {
      if (request.method !== 'GET') return respond(405, undefined, { Allow: 'GET, OPTIONS' });
      const session = store.get('session:' + match[2]);
      if (!session) return respond(404, rpcError(null, SESSION_NOT_FOUND, 'Session not found'));
      const { clientId, ...info } = session;
      const client = clientId && store.get('client:' + clientId);
      return respond(200, { ...info, ...(clientId && { refreshCount: client?.refreshCount ?? 0, last401: client?.last401 ?? null }) });
    }
    const fixture = { ...FIXTURE_SERVERS[name], store };
    if (request.method === 'GET' && /text\/html/i.test(request.headers.get('accept') ?? '') && !request.headers.has('mcp-session-id')) {
      return respond(200, { name, tools: fixture.tools.map(t => t.definition.name), auth: fixture.auth?.type ?? 'none',
        modes: fixture.mode ? [fixture.mode] : ['stateful', 'stateless'], docs: url.origin + '/mcp-test-servers' });
    }
    if (name === 'oauth') {
      fixture.clientId = oauthAccess(request, store);
      if (!fixture.clientId) {
        const metadataUrl = new URL(RESOURCE_METADATA, url.origin);
        metadataUrl.search = url.search;
        return respond(401, rpcError(null, -32001, 'OAuth authorization required. See /mcp-test-servers'), {
          'WWW-Authenticate': `Bearer resource_metadata="${metadataUrl.href}"${request.headers.has('Authorization') ? ', error="invalid_token"' : ''}`,
        });
      }
    }
    const unauthorized = authorizationFailure(fixture, request);
    if (unauthorized) return unauthorized;
    if (request.method === 'DELETE' && fixture.mode !== 'stateless' && request.headers.get('mcp-protocol-version') !== MODERN_PROTOCOL_VERSION) {
      await resolveLegacyEra(request, fixture, null, 'delete');
      return respond(204);
    }
    return serveMcpServer(request, fixture, options);
  } catch (error) {
    if (error instanceof HttpFailure) return error.response;
    throw error;
  }
};

/**
 * Serves one fixture-shaped MCP server definition ({ name, title, instructions,
 * tools, resources, prompts, optional serverInfo }) at a path the caller already
 * matched: CORS preflight, the permitted GET/DELETE 405s and both protocol eras
 * on POST. Shared by the fixtures and the public catalog endpoint (catalogMcp.js).
 */
export const serveMcpServer = async (request, server, options = {}) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: FIXTURE_CORS_HEADERS });
  const allow = server.store ? (server.mode === 'stateless' ? 'GET, POST, OPTIONS' : 'GET, POST, DELETE, OPTIONS') : 'POST, OPTIONS';
  if (request.method === 'GET' || request.method === 'DELETE') {
    return respond(405, undefined, { Allow: allow });
  }
  if (request.method !== 'POST') {
    return respond(405, rpcError(null, INVALID_REQUEST, 'Method Not Allowed'), { Allow: allow });
  }
  try {
    return await handlePost(request, server, { wait: options.wait ?? defaultWait });
  } catch (error) {
    if (error instanceof HttpFailure) return error.response;
    throw error;
  }
};
