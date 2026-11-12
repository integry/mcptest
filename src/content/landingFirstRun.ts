/**
 * First-run strings and the static sample result for the root page's landing
 * (issue #559). LandingHero and LandingPreview render them in the app, and
 * scripts/generate-seo-pages.js renders the same values into the static first
 * frame inside dist/index.html, so this module has no runtime imports.
 *
 * The hero headline, lede, audience paths and coverage list live in
 * ./landingCopy.ts; this module only adds what the first-run form and the
 * preview need.
 */

/** Visible label above the endpoint field (e2e tests find the field by it). */
export const LANDING_FIELD_LABEL = 'MCP endpoint URL';
export const LANDING_FIELD_PLACEHOLDER = 'https://example.com/mcp';
export const LANDING_FIELD_HELP =
  'Paste the HTTP address of a remote MCP server. mcptest.io connects from this browser tab, '
  + 'lists its tools, resources and prompts, and shows every JSON-RPC message. Nothing is installed.';
export const LANDING_CONNECT_LABEL = 'Connect';

/** Labels the presets as the alternative to pasting a URL. */
export const LANDING_ALTERNATIVES_LABEL = 'No server yet? Try one of these';
export const LANDING_SAMPLE_LABEL = 'Run a sample test';
/** Followed by the sample server's name, e.g. `Connects to Context7, a public server with no sign-in`. */
export const LANDING_SAMPLE_NOTE_PREFIX = 'Connects to';
export const LANDING_SAMPLE_NOTE_SUFFIX = ', a public server with no sign-in';

export const LANDING_ADVANCED_LABEL = 'Advanced options';
export const LANDING_ADVANCED_HINT = 'when a server needs custom headers, an API key or a CORS proxy';

/** Explains the playground's "+ New" tab control. */
export const NEW_TAB_LABEL = 'New connection tab';
export const NEW_TAB_TOOLTIP = 'Open another connection tab to test a second server side by side';

/**
 * Inline validation for the endpoint field. Returns a specific message for a
 * malformed value, or null when the value can be connected to. A bare host
 * (`example.com/mcp`) is accepted: the playground adds https:// to it.
 */
export const getEndpointInputError = (value: string): string | null => {
  const input = value.trim();
  if (!input) return 'Enter the URL of an MCP server, for example https://example.com/mcp.';
  if (/\s/.test(input)) return 'A URL cannot contain spaces. Check the address you pasted.';
  const scheme = input.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  const hasHttpScheme = /^https?:\/\//i.test(input);
  if (scheme && !hasHttpScheme && !/^\d+$/.test(input.slice(scheme.length + 1).split(/[/?#]/)[0] || '')) {
    return `mcptest.io connects to remote servers over HTTP. Use an http:// or https:// URL, not ${scheme}:.`;
  }
  let url: URL;
  try {
    url = new URL(hasHttpScheme ? input : `https://${input}`);
  } catch {
    return 'This is not a valid URL. Enter a full address such as https://example.com/mcp.';
  }
  const host = url.hostname;
  const isLocal = host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');
  if (!host || (!isLocal && !host.includes('.'))) {
    return 'The address needs a host name with a domain, such as example.com.';
  }
  if (url.username || url.password) {
    return 'Remove the user name and password from the URL. Add credentials under Advanced options instead.';
  }
  return null;
};

/**
 * The example result next to the connect form: a static, clearly labelled
 * sample of what a connection shows. Shaped like the e2e mock server, not a
 * real catalog server, so it never makes claims about a third party.
 */
export const LANDING_PREVIEW_SAMPLE = {
  caption: 'Example result',
  title: 'What a connection shows',
  endpoint: 'https://weather.example.com/mcp',
  serverName: 'weather-demo',
  serverVersion: '1.4.0',
  checks: [
    { label: 'MCP 2026-07-28 · stateless', status: 'success' },
    { label: 'Auth: none required', status: 'success' },
    { label: 'CORS: browser allowed', status: 'success' },
  ],
  counts: '3 tools · 1 resource · 1 prompt',
  tools: [
    { name: 'get_forecast', description: 'Forecast for a city' },
    { name: 'list_alerts', description: 'Active weather alerts' },
    { name: 'search_stations', description: 'Find stations near a place' },
  ],
  exchangeTitle: 'JSON-RPC',
  exchange: [
    {
      direction: 'request',
      label: 'tools/call',
      body: '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_forecast","arguments":{"city":"Oslo"}}}',
    },
    {
      direction: 'response',
      label: 'result',
      body: '{"jsonrpc":"2.0","id":4,"result":{"structuredContent":{"city":"Oslo","conditions":"Light rain","high_c":9}}}',
    },
  ],
} as const;
