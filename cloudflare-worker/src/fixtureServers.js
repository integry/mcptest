// Definitions of the public deterministic MCP fixture servers served by
// src/fixtures.js under /fixtures/<name>/mcp. Every tool here is pure: no
// storage, no outbound fetches, bounded inputs and small fixed outputs. The
// protocol layer (eras, sessions, CORS, auth, SSE) lives in src/fixtures.js.

export const FIXTURE_SERVER_VERSION = '1.0.0';
export const PUBLIC_BEARER_TOKEN = 'mcptest-public-token';
/** Hard cap on any delay a fixture tool can be asked for. */
export const MAX_DELAY_MS = 10_000;
export const MAX_PROGRESS_STEPS = 10;
export const MAX_ECHO_LENGTH = 1_000;

/** Thrown by a tool to produce a JSON-RPC error response instead of a result. */
export class FixtureRpcError extends Error {
  constructor(code, message, { data, httpStatus } = {}) {
    super(message);
    this.code = code;
    if (data !== undefined) this.data = data;
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
  }
}

const json = (value) => JSON.stringify(value, null, 2);
const textResult = (text) => ({ content: [{ type: 'text', text }] });
const structuredResult = (value) => ({ content: [{ type: 'text', text: json(value) }], structuredContent: value });
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// Request headers whose values whoami/headers may echo. Everything else is
// listed by name only; credential-shaped headers are never echoed.
const ECHOED_HEADERS = [
  'accept', 'content-type', 'mcp-method', 'mcp-name', 'mcp-protocol-version', 'origin', 'user-agent',
];
const SENSITIVE_HEADER = /auth|cookie|token|secret|key|session|signature|password|credential/i;
const INFRASTRUCTURE_HEADER = /^(cf-|x-forwarded-|x-real-ip$|true-client-ip$|cdn-loop$|x-amzn-)/i;
const MAX_HEADER_VALUE_LENGTH = 200;
const MAX_LISTED_HEADERS = 32;

const truncate = (value, max) => (value.length > max ? `${value.slice(0, max)}…` : value);

const echoedHeaders = (headers) => Object.fromEntries(ECHOED_HEADERS
  .filter((name) => headers.has(name))
  .map((name) => [name, truncate(headers.get(name), MAX_HEADER_VALUE_LENGTH)]));

const authorizationSummary = (headers) => {
  const value = headers.get('authorization');
  if (!value) return { present: false };
  const scheme = /^([A-Za-z][A-Za-z0-9-]{0,19})\s/.exec(value)?.[1];
  return { present: true, ...(scheme ? { scheme } : {}) };
};

const whoami = (_args, context) => structuredResult({
  fixture: context.fixture,
  protocolEra: context.era === 'modern' ? 'stateless' : 'stateful',
  protocolVersion: context.protocolVersion ?? null,
  ...(context.clientInfo ? { clientInfo: context.clientInfo } : {}),
  session: context.era === 'modern' ? 'none' : 'present',
  authorization: authorizationSummary(context.headers),
  headers: echoedHeaders(context.headers),
});

const headersTool = (_args, context) => {
  const names = [...context.headers.keys()]
    .filter((name) => !INFRASTRUCTURE_HEADER.test(name))
    .sort();
  const listed = names.slice(0, MAX_LISTED_HEADERS);
  return structuredResult({
    headers: Object.fromEntries(listed.map((name) => [
      name.slice(0, 64),
      ECHOED_HEADERS.includes(name) ? truncate(context.headers.get(name), MAX_HEADER_VALUE_LENGTH)
        : SENSITIVE_HEADER.test(name) ? '[redacted]'
          : '[present]',
    ])),
    omitted: names.length - listed.length,
    note: 'Values are shown only for MCP and content-negotiation headers; credentials and cookies are never echoed.',
  });
};

const BASIC_TOOLS = [
  {
    definition: {
      name: 'echo',
      title: 'Echo',
      description: 'Returns the message argument unchanged.',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string', maxLength: MAX_ECHO_LENGTH, description: 'Text to echo back.' } },
        required: ['message'],
        additionalProperties: false,
      },
      annotations: readOnly,
    },
    run: ({ message }) => textResult(message),
  },
  {
    definition: {
      name: 'add',
      title: 'Add',
      description: 'Adds two numbers and returns the sum.',
      inputSchema: {
        type: 'object',
        properties: { a: { type: 'number', description: 'First addend.' }, b: { type: 'number', description: 'Second addend.' } },
        required: ['a', 'b'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: { sum: { type: 'number' } },
        required: ['sum'],
        additionalProperties: false,
      },
      annotations: readOnly,
    },
    run: ({ a, b }) => {
      const sum = a + b;
      // Finite addends can still overflow (1e308 + 1e308). JSON has no
      // Infinity, so a "successful" result would serialise sum as null and
      // break the advertised outputSchema; answer deterministically instead.
      if (!Number.isFinite(sum)) {
        throw new FixtureRpcError(-32602, 'Invalid params: the sum of a and b is not a finite number', {
          data: { errors: [{ path: '', message: 'sum overflows the IEEE 754 double range' }] },
        });
      }
      return { content: [{ type: 'text', text: String(sum) }], structuredContent: { sum } };
    },
  },
  {
    definition: {
      name: 'whoami',
      title: 'Who am I',
      description: 'Returns the negotiated protocol version, era and selected request headers. Never echoes credentials.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: readOnly,
    },
    run: whoami,
  },
  {
    definition: {
      name: 'headers',
      title: 'Request headers',
      description: 'Lists the request header names the server received, with values only for MCP and content-negotiation headers.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: readOnly,
    },
    run: headersTool,
  },
];

const README_RESOURCE = {
  definition: {
    uri: 'mcptest://fixtures/readme',
    name: 'readme',
    title: 'Fixture README',
    description: 'Static description of the mcptest.io fixture servers.',
    mimeType: 'text/plain',
  },
  text: [
    'mcptest.io public MCP fixture servers',
    '',
    'Deterministic, stateless test endpoints for MCP clients and testers:',
    '  https://mcptest.io/fixtures/echo/mcp         no auth',
    `  https://mcptest.io/fixtures/auth-bearer/mcp  Authorization: Bearer ${PUBLIC_BEARER_TOKEN}`,
    '  https://mcptest.io/fixtures/errors/mcp       deterministic error modes',
    '  https://mcptest.io/fixtures/slow/mcp         bounded delays and progress',
    '  https://mcptest.io/fixtures/schemas/mcp      complex input and output schemas',
    '',
    'Supports the stateless 2026-07-28 revision (server/discover) and the stateful',
    '2025-11-25 revision (initialize + Mcp-Session-Id) on the same endpoint.',
  ].join('\n'),
};

const GREETING_PROMPT = {
  definition: {
    name: 'greeting',
    title: 'Greeting',
    description: 'A fixed greeting prompt with an optional name argument.',
    arguments: [{ name: 'name', description: 'Who to greet (at most 100 characters).', required: false }],
  },
  render: (args) => {
    const name = typeof args?.name === 'string' && args.name ? truncate(args.name, 100) : 'world';
    return {
      description: 'A fixed greeting prompt.',
      messages: [{ role: 'user', content: { type: 'text', text: `Say hello to ${name} from the mcptest.io echo fixture.` } }],
    };
  },
};

const ERROR_TOOLS = [
  {
    definition: {
      name: 'protocol_error',
      title: 'JSON-RPC protocol error',
      description: 'Always answers with a JSON-RPC error response (code -32603) instead of a result.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: readOnly,
    },
    run: () => {
      throw new FixtureRpcError(-32603, 'Deterministic protocol error from the errors fixture', { data: { fixture: 'errors' } });
    },
  },
  {
    definition: {
      name: 'tool_error',
      title: 'Tool execution error',
      description: 'Always returns a tool result with isError: true.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: readOnly,
    },
    run: () => ({ content: [{ type: 'text', text: 'Deterministic tool execution error from the errors fixture.' }], isError: true }),
  },
  {
    definition: {
      name: 'invalid_params',
      title: 'Invalid params error',
      description: 'Always answers with a JSON-RPC invalid params error (code -32602).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: readOnly,
    },
    run: () => {
      throw new FixtureRpcError(-32602, 'Invalid params: deterministic error from the errors fixture', { data: { fixture: 'errors' } });
    },
  },
  {
    definition: {
      name: 'http_500',
      title: 'HTTP 500',
      description: 'Answers the HTTP request with status 500 and a JSON-RPC internal error body.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: readOnly,
    },
    run: () => {
      throw new FixtureRpcError(-32603, 'Internal error: deterministic HTTP 500 from the errors fixture', { httpStatus: 500 });
    },
  },
];

const SLOW_TOOLS = [
  {
    definition: {
      name: 'sleep',
      title: 'Sleep',
      description: `Waits for ms milliseconds, capped at ${MAX_DELAY_MS}, then returns. Use it to test client timeouts.`,
      inputSchema: {
        type: 'object',
        properties: { ms: { type: 'integer', minimum: 0, description: `Delay in milliseconds; values above ${MAX_DELAY_MS} are capped.` } },
        required: ['ms'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: { requestedMs: { type: 'integer' }, sleptMs: { type: 'integer' }, capped: { type: 'boolean' } },
        required: ['requestedMs', 'sleptMs', 'capped'],
        additionalProperties: false,
      },
      annotations: readOnly,
    },
    run: async ({ ms }, context) => {
      const sleptMs = Math.min(ms, MAX_DELAY_MS);
      await context.wait(sleptMs);
      return structuredResult({ requestedMs: ms, sleptMs, capped: sleptMs !== ms });
    },
  },
  {
    definition: {
      name: 'progress',
      title: 'Progress',
      description: `Sends one notifications/progress per step over an SSE response when the request carries a progressToken. At most ${MAX_PROGRESS_STEPS} steps and ${MAX_DELAY_MS} ms in total.`,
      inputSchema: {
        type: 'object',
        properties: {
          steps: { type: 'integer', minimum: 1, maximum: MAX_PROGRESS_STEPS, description: 'Number of progress notifications (default 3).' },
          intervalMs: { type: 'integer', minimum: 0, maximum: 1_000, description: 'Delay between steps in milliseconds (default 200).' },
        },
        additionalProperties: false,
      },
      annotations: readOnly,
    },
    streams: true,
    run: async ({ steps = 3, intervalMs = 200 }, context) => {
      for (let step = 1; step <= steps; step += 1) {
        await context.wait(intervalMs);
        await context.progress(step, steps, `Step ${step} of ${steps}`);
      }
      return textResult(`Completed ${steps} steps.`);
    },
  },
];

const ADDRESS_SCHEMA = {
  type: 'object',
  properties: {
    street: { type: 'string', maxLength: 200 },
    city: { type: 'string', maxLength: 100 },
    country: { type: 'string', enum: ['US', 'GB', 'DE', 'FR', 'IT', 'JP'] },
    postalCode: { type: 'string', maxLength: 20 },
  },
  required: ['street', 'city', 'country'],
  additionalProperties: false,
};

const SCHEMA_TOOLS = [
  {
    definition: {
      name: 'create_order',
      title: 'Create order (dry run)',
      description: 'Validates a nested order and returns a deterministic quote. Nothing is stored.',
      inputSchema: {
        type: 'object',
        properties: {
          customer: {
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 100 },
              email: { type: 'string', maxLength: 200 },
              tier: { type: 'string', enum: ['free', 'pro', 'enterprise'], description: 'Defaults to free.' },
            },
            required: ['name'],
            additionalProperties: false,
          },
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: {
              type: 'object',
              properties: {
                sku: { type: 'string', pattern: '^[A-Z]{3}-[0-9]{3}$' },
                quantity: { type: 'integer', minimum: 1, maximum: 100 },
                unitPrice: { type: 'number', minimum: 0, maximum: 10_000 },
                options: { type: 'array', maxItems: 5, items: { type: 'string', enum: ['gift-wrap', 'express', 'insured'] } },
              },
              required: ['sku', 'quantity', 'unitPrice'],
              additionalProperties: false,
            },
          },
          shipping: ADDRESS_SCHEMA,
          notes: { type: 'string', maxLength: 500 },
        },
        required: ['customer', 'items'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          itemCount: { type: 'integer' },
          subtotal: { type: 'number' },
          discount: { type: 'number' },
          total: { type: 'number' },
          currency: { type: 'string', enum: ['USD'] },
          shipsTo: { type: ['string', 'null'] },
        },
        required: ['orderId', 'itemCount', 'subtotal', 'discount', 'total', 'currency', 'shipsTo'],
        additionalProperties: false,
      },
      annotations: readOnly,
    },
    run: ({ customer, items, shipping }) => {
      const cents = (value) => Math.round(value * 100) / 100;
      const subtotal = cents(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
      const rate = { free: 0, pro: 0.1, enterprise: 0.2 }[customer.tier ?? 'free'];
      const discount = cents(subtotal * rate);
      const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
      return structuredResult({
        orderId: `ORD-${String(itemCount).padStart(3, '0')}-${items.map((item) => item.sku.slice(-3)).join('')}`.slice(0, 40),
        itemCount,
        subtotal,
        discount,
        total: cents(subtotal - discount),
        currency: 'USD',
        shipsTo: shipping ? `${shipping.city}, ${shipping.country}` : null,
      });
    },
  },
  {
    definition: {
      name: 'classify',
      title: 'Classify values',
      description: 'Classifies a list of mixed values and returns counts per JSON type.',
      inputSchema: {
        type: 'object',
        properties: {
          values: {
            type: 'array',
            maxItems: 50,
            items: { type: ['string', 'number', 'boolean', 'null', 'object', 'array'] },
          },
          mode: { type: 'string', enum: ['count', 'list'], description: 'Defaults to count.' },
          caseSensitive: { type: 'boolean' },
        },
        required: ['values'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          counts: {
            type: 'object',
            properties: Object.fromEntries(['string', 'number', 'boolean', 'null', 'object', 'array'].map((type) => [type, { type: 'integer' }])),
            required: ['string', 'number', 'boolean', 'null', 'object', 'array'],
            additionalProperties: false,
          },
          types: { type: 'array', items: { type: 'string' } },
        },
        required: ['total', 'counts'],
        additionalProperties: false,
      },
      annotations: readOnly,
    },
    run: ({ values, mode = 'count' }) => {
      const typeOf = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);
      const counts = { string: 0, number: 0, boolean: 0, null: 0, object: 0, array: 0 };
      const types = values.map(typeOf);
      types.forEach((type) => { counts[type] += 1; });
      return structuredResult({ total: values.length, counts, ...(mode === 'list' ? { types } : {}) });
    },
  },
];

const fixture = (name, title, instructions, { tools, resources = [], prompts = [], auth } = {}) => ({
  name,
  title,
  instructions,
  tools,
  resources,
  prompts,
  ...(auth ? { auth } : {}),
});

export const FIXTURE_SERVERS = Object.freeze({
  echo: fixture('echo', 'mcptest.io echo fixture',
    'Deterministic public test server. Tools: echo, add, whoami, headers. One static resource and one prompt.',
    { tools: BASIC_TOOLS, resources: [README_RESOURCE], prompts: [GREETING_PROMPT] }),
  'auth-bearer': fixture('auth-bearer', 'mcptest.io bearer-auth fixture',
    `Same tools as the echo fixture. Requires Authorization: Bearer ${PUBLIC_BEARER_TOKEN} (a documented public token).`,
    { tools: BASIC_TOOLS, resources: [README_RESOURCE], prompts: [GREETING_PROMPT], auth: { type: 'bearer', token: PUBLIC_BEARER_TOKEN } }),
  errors: fixture('errors', 'mcptest.io errors fixture',
    'Each tool fails deterministically: protocol_error (-32603), tool_error (isError: true), invalid_params (-32602), http_500 (HTTP 500).',
    { tools: ERROR_TOOLS }),
  slow: fixture('slow', 'mcptest.io slow fixture',
    `sleep waits up to ${MAX_DELAY_MS} ms; progress streams notifications/progress over SSE.`,
    { tools: SLOW_TOOLS }),
  schemas: fixture('schemas', 'mcptest.io schemas fixture',
    'Tools with nested, enum, array and optional input fields and an outputSchema with structuredContent.',
    { tools: SCHEMA_TOOLS }),
});

export const FIXTURE_NAMES = Object.freeze(Object.keys(FIXTURE_SERVERS));
