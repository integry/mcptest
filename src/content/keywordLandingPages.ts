/**
 * The keyword landing pages (/mcp-test-server, /mcp-inspector-online,
 * /mcp-playground): each one is the connect panel from the home page with its
 * own copy around it. KeywordLandingView renders this data in the app and
 * src/prerender/contentPages.tsx renders the same component at build time;
 * scripts/generate-seo-pages.js reads the metadata, sitemap and llms.txt
 * entries from here too.
 *
 * Copy may contain `[label](href)` links (see parseLandingText in
 * ./landingCopy.ts). Links render as links on the page and as their label in
 * the FAQPage JSON-LD. Keep runtime imports `.ts`-suffixed: the generator
 * loads this module with Node's own TypeScript support.
 */
import { landingPlainText } from './landingCopy.ts';
import {
  KEYWORD_LANDING_PATHS,
  MCP_INSPECTOR_ONLINE_PATH,
  MCP_PLAYGROUND_PATH,
  MCP_TEST_SERVER_PATH,
} from '../utils/appRoutes.ts';

export { KEYWORD_LANDING_PATHS, MCP_INSPECTOR_ONLINE_PATH, MCP_PLAYGROUND_PATH, MCP_TEST_SERVER_PATH };

import type { LandingPageKey } from '../utils/analytics.ts';

/** Also the `page` analytics parameter of landing_view and landing_connect. */
export type KeywordLandingKey = LandingPageKey;

export interface KeywordLandingItem {
  title: string;
  /** May contain `[label](href)` links. */
  description: string;
}

export interface KeywordLandingTable {
  caption: string;
  columns: readonly string[];
  /** The first cell of each row is its header. */
  rows: readonly (readonly string[])[];
}

export interface KeywordLandingSection {
  /** The section's anchor id, unique on the page. */
  id: string;
  title: string;
  /** Paragraphs before any list or table; may contain links. */
  paragraphs?: readonly string[];
  /** A numbered sequence of steps. */
  steps?: readonly KeywordLandingItem[];
  /** An unordered list of named points. */
  items?: readonly KeywordLandingItem[];
  table?: KeywordLandingTable;
  /** Paragraphs after the list or table. */
  after?: readonly string[];
}

export interface KeywordLandingFaqItem {
  question: string;
  /** May contain `[label](href)` links; the JSON-LD carries the plain text. */
  answer: string;
}

export interface KeywordLandingLink {
  label: string;
  href: string;
  description: string;
}

export interface KeywordLandingPage {
  key: KeywordLandingKey;
  path: string;
  /** The document title, with the site suffix. */
  title: string;
  /** Meta and social description. */
  description: string;
  /** The page-view title reported to analytics. */
  pageViewTitle: string;
  /** The Open Graph card's eyebrow. */
  eyebrow: string;
  h1: string;
  /** The lede under the H1, above the connect form; may contain links. */
  intro: string;
  sections: readonly KeywordLandingSection[];
  faq: readonly KeywordLandingFaqItem[];
  relatedTitle: string;
  related: readonly KeywordLandingLink[];
  /** One line for llms.txt. */
  llmsNote: string;
}

export const KEYWORD_LANDING_FAQ_TITLE = 'Questions';

const TEST_SERVER_PAGE: KeywordLandingPage = {
  key: 'test-server',
  path: MCP_TEST_SERVER_PATH,
  title: 'Test MCP Server Online: Free Browser Tool, No Install | mcptest.io',
  description: 'Test your MCP server online. Paste a remote endpoint to check the handshake, transport, OAuth, CORS, tools, resources and prompts in your browser, free.',
  pageViewTitle: 'Test MCP server online',
  eyebrow: 'Free tool',
  h1: 'Test your MCP server online',
  intro: 'Point mcptest.io at the endpoint you are building and it acts as the MCP client: it negotiates a protocol '
    + 'version, picks a transport, follows the authorization challenge and lists every capability, with each '
    + 'JSON-RPC message on screen. Use it before you add the server to Claude, ChatGPT or Cursor, and again after each deploy.',
  sections: [
    {
      id: 'how-to-test',
      title: 'How to test your server',
      steps: [
        {
          title: 'Give the server an HTTPS URL',
          description: 'Deploy a preview or put a tunnel in front of your local process so the endpoint, usually ending in /mcp, '
            + 'is reachable from the internet. Platform-specific notes are in the [deployment guide](/learn/deploy-remote-mcp-server).',
        },
        {
          title: 'Connect with the URL alone first',
          description: 'Paste the endpoint above and press Connect without any headers. That shows what a client with no '
            + 'configuration sees, including whether the server sends a proper 401 challenge.',
        },
        {
          title: 'Add credentials only if challenged',
          description: 'An OAuth server starts the sign-in flow on its own. For a static bearer token, API key or custom '
            + 'header, open Advanced options and connect again.',
        },
        {
          title: 'Call every tool once',
          description: 'Run each tool with realistic arguments and read the result next to its output schema. Then open each '
            + 'resource and render each prompt.',
        },
        {
          title: 'Keep the evidence',
          description: 'Open the [report](/report) for a scored summary, and attach its link to the pull request or issue '
            + 'so a reviewer sees the same results.',
        },
      ],
    },
    {
      id: 'what-gets-tested',
      title: 'What gets tested',
      items: [
        {
          title: 'Handshake and version negotiation',
          description: 'The 2026 server/discover exchange or the 2025 initialize handshake, the version both sides agree on, '
            + 'the declared capabilities and server info, checked against the official SDK schemas.',
        },
        {
          title: 'Transports',
          description: 'Streamable HTTP in the stateless 2026-07-28 revision, Streamable HTTP with Mcp-Session-Id sessions '
            + '(2025-11-25, 2025-06-18, 2025-03-26), and the legacy HTTP+SSE transport from 2024-11-05. '
            + '[Protocol versions explained](/learn/mcp-protocol-versions-explained) covers the differences.',
        },
        {
          title: 'Authorization',
          description: 'OAuth 2.1 with PKCE, from the WWW-Authenticate challenge through protected resource metadata, '
            + 'authorization server discovery and client registration; static bearer tokens; API keys in any header. '
            + 'The [OAuth checker](/tools/oauth-check) shows each discovery step in detail.',
        },
        {
          title: 'CORS',
          description: 'mcptest.io tries a direct connection from the page first, so a rejected preflight or an unexposed '
            + 'Mcp-Session-Id header shows up as it would in a web client. It then retries through its proxy and records that it had to.',
        },
        {
          title: 'Tools, resources and prompts',
          description: 'Every list is followed through pagination. Tool forms come from each input schema, and results show '
            + 'text, images and structured content, checked against the declared output schema.',
        },
        {
          title: 'Raw JSON-RPC log',
          description: 'Each request, response and notification exactly as exchanged, ready to copy into a bug report.',
        },
      ],
    },
    {
      id: 'local-and-stdio',
      title: 'Local, stdio and CI testing',
      paragraphs: [
        'A browser tab cannot start a process, so a server that only speaks stdio has to be served over Streamable HTTP '
          + 'before mcptest.io can reach it. [Converting a local stdio server to remote](/learn/convert-local-stdio-mcp-server-to-remote) '
          + 'walks through the change for the TypeScript and Python SDKs. Until then, the official MCP Inspector can launch '
          + 'the stdio command on your machine.',
        'The checks behind the report also run headless. The [GitHub Action](/ci) tests a deployed preview on every pull request, '
          + 'and [testing a remote MCP server in CI](/learn/test-remote-mcp-server-in-ci) explains secrets, baselines and '
          + 'when a change should fail the build.',
      ],
    },
  ],
  faq: [
    {
      question: 'My server works in Claude Desktop. Why does it fail here?',
      answer: 'Claude Desktop often launches a local server over stdio, while mcptest.io always connects over HTTP from a '
        + 'browser. The usual causes are a missing CORS header, a Host check that rejects the public hostname, or an '
        + 'endpoint path that differs from the one you pasted. The [troubleshooting guide](/docs/troubleshooting) lists each error.',
    },
    {
      question: 'Does a passing test mean every client will work?',
      answer: 'No. It shows that the server follows the protocol and answers a browser-based client. Clients differ in '
        + 'transports, OAuth support and headers; the [client support matrix](/learn/mcp-client-support-matrix) shows what each one needs.',
    },
    {
      question: 'Where do my URLs, tokens and results go?',
      answer: 'They stay in your browser\'s local storage. Requests go straight from the page to your server unless the '
        + 'CORS proxy is needed, in which case they pass through it on the way. Use a test account or a short-lived token for anything sensitive.',
    },
    {
      question: 'How do I run the same test again after a deploy?',
      answer: 'Your endpoint appears under Recent on your next visit. To repeat it from anywhere, copy the connection link '
        + 'from the playground or the report link, and open it after the deploy.',
    },
  ],
  relatedTitle: 'Related',
  related: [
    { label: 'MCP Inspector online', href: MCP_INSPECTOR_ONLINE_PATH, description: 'How this compares with the official Inspector.' },
    { label: 'MCP playground', href: MCP_PLAYGROUND_PATH, description: 'Try public servers before you build your own.' },
    { label: 'Test an MCP server before you deploy it', href: '/learn/test-mcp-server-before-deploying', description: 'The connect sequence and how the report scores it.' },
    { label: 'Testing guide', href: '/docs/testing-guide', description: 'A full test pass, from discovery to tool calls.' },
  ],
  llmsNote: 'Test a remote MCP server in the browser: handshake, transports, OAuth, CORS, capabilities and raw JSON-RPC.',
};

const INSPECTOR_ONLINE_PAGE: KeywordLandingPage = {
  key: 'inspector-online',
  path: MCP_INSPECTOR_ONLINE_PATH,
  title: 'MCP Inspector Online: No npx, No Node, No Install | mcptest.io',
  description: 'An MCP inspector in a browser tab: no npx, Node or local proxy. Inspect a remote server\'s tools and raw JSON-RPC, and compare it with the official Inspector.',
  pageViewTitle: 'MCP Inspector online',
  eyebrow: 'Inspector',
  h1: 'MCP Inspector online',
  intro: 'The official MCP Inspector is a Node package you start with npx. mcptest.io is an inspector for remote MCP '
    + 'servers that you open in a tab instead: paste an endpoint, connect, and browse what the server exposes.',
  sections: [
    {
      id: 'nothing-to-install',
      title: 'Nothing to install',
      paragraphs: [
        'There is no npx command, no Node.js version to match and no local proxy port to keep open. That matters on a work '
          + 'laptop where installing packages needs approval, on a Chromebook or tablet, or when you want a colleague to look '
          + 'at a server without setting anything up.',
        'Connections, history and saved calls live in your browser. Signing in is optional and only syncs that workspace '
          + 'between devices and raises the rate limit of the CORS proxy.',
      ],
    },
    {
      id: 'what-you-can-inspect',
      title: 'What you can inspect',
      items: [
        { title: 'Tools', description: 'Arguments are filled in through a form built from the input schema, and each call is kept in a history you can replay.' },
        { title: 'Resources and templates', description: 'Read resources by URI and fill in template parameters.' },
        { title: 'Prompts', description: 'Render prompts with their arguments and see the messages the server returns.' },
        { title: 'Messages', description: 'The JSON-RPC log shows every request, response and notification exactly as exchanged, with timestamps.' },
        { title: 'Authorization', description: 'Progress through each OAuth step, the errors a provider returns, and the account the token belongs to.' },
      ],
    },
    {
      id: 'compared-with-the-official-inspector',
      title: 'mcptest.io and the official MCP Inspector',
      paragraphs: [
        'Both are free and open source, and they are built for different situations. In short:',
      ],
      table: {
        caption: 'mcptest.io compared with the official @modelcontextprotocol/inspector',
        columns: ['', 'mcptest.io', 'MCP Inspector'],
        rows: [
          ['How you start it', 'Open the page', 'npx @modelcontextprotocol/inspector, with a recent Node.js'],
          ['Where connections come from', 'Your browser, with a proxy fallback', 'A local Node backend'],
          ['Local stdio servers', 'Not supported', 'Supported'],
          ['Browser CORS evidence', 'Recorded', 'Not observable'],
          ['Sharing results', 'Report and result links, badges', 'Exported logs'],
          ['CI', 'GitHub Action and headless CLI', 'CLI with JSON output'],
        ],
      },
      after: [
        'Use the official Inspector for stdio servers and for protocol features mcptest.io does not cover yet. Use mcptest.io '
          + 'when the question is whether a remote server works from a browser, or when you need a link to send to someone. '
          + 'The full comparison, including MCPJam, Glama and Postman, is in '
          + '[mcptest.io vs MCP Inspector](/learn/mcptest-vs-mcp-inspector).',
      ],
    },
    {
      id: 'switching-from-npx',
      title: 'Coming from npx',
      steps: [
        { title: 'Copy the server URL', description: 'Take the URL you would type into the Inspector with the Streamable HTTP or SSE transport selected.' },
        { title: 'Move headers over', description: 'Paste any Authorization or API key header under Advanced options. OAuth servers need nothing: the flow starts on connect.' },
        { title: 'Compare the logs', description: 'If the two tools disagree, the difference is usually where the request came from: a CORS rule passes a Node backend but blocks a page.' },
      ],
    },
  ],
  faq: [
    {
      question: 'Is this the official MCP Inspector?',
      answer: 'No. The official Inspector is maintained by the Model Context Protocol project and published on npm as '
        + '@modelcontextprotocol/inspector. mcptest.io is an independent, MIT-licensed project with its '
        + '[source on GitHub](https://github.com/integry/mcptest).',
    },
    {
      question: 'Why does a server connect in the Inspector but not here?',
      answer: 'The Inspector connects from Node on your machine, where CORS does not apply. A page has to pass the browser\'s '
        + 'preflight. When that fails, mcptest.io retries through its proxy and the log shows which header was missing; '
        + 'see [CORS headers for browser clients](/learn/mcp-cors-headers-for-browser-clients).',
    },
    {
      question: 'Can I inspect a stdio server in the browser?',
      answer: 'Not directly. Serve it over Streamable HTTP first, or keep using the Inspector for it. '
        + '[Test your MCP server online](/mcp-test-server) explains the options.',
    },
    {
      question: 'Does it support the 2026 protocol revision?',
      answer: 'Yes. It negotiates the stateless 2026-07-28 revision first and falls back to 2025 sessions or legacy '
        + 'HTTP+SSE, and shows which one the server accepted.',
    },
  ],
  relatedTitle: 'Related',
  related: [
    { label: 'Test your MCP server online', href: MCP_TEST_SERVER_PATH, description: 'Everything a test run checks, step by step.' },
    { label: 'MCP playground', href: MCP_PLAYGROUND_PATH, description: 'Public servers you can inspect right now.' },
    { label: 'MCP transport diagnostics', href: '/learn/mcp-transport-diagnostics-reference', description: 'What each transport finding in the log means.' },
    { label: 'Best remote MCP testing tools', href: '/learn/best-remote-mcp-testing-tools', description: 'Choosing a tool for the job.' },
  ],
  llmsNote: 'A browser-based MCP inspector for remote servers, with no npx or Node install, and how it compares with the official Inspector.',
};

const PLAYGROUND_PAGE: KeywordLandingPage = {
  key: 'playground',
  path: MCP_PLAYGROUND_PATH,
  title: 'MCP Playground: Try Public Remote MCP Servers | mcptest.io',
  description: 'An MCP playground in your browser. Connect to public remote MCP servers from the catalog, call their tools with your own arguments, and share the result.',
  pageViewTitle: 'MCP playground',
  eyebrow: 'Playground',
  h1: 'MCP playground',
  intro: 'The quickest way to understand an MCP server is to call it. Pick one of the public servers below, or paste '
    + 'any endpoint, and try its tools with your own arguments. Nothing to install, and no account for servers that do not need one.',
  sections: [
    {
      id: 'start-with-a-public-server',
      title: 'Start with a public server',
      paragraphs: [
        'These servers need no sign-in, so they connect with one click:',
      ],
      items: [
        { title: 'Context7', description: 'Current documentation and code examples for open-source libraries. Ask it to resolve a library name, then fetch its docs. [Server details](/servers/context7/).' },
        { title: 'DeepWiki', description: 'Questions answered from the wiki it generates for public GitHub repositories. [Server details](/servers/deepwiki/).' },
        { title: 'CoinGecko', description: 'Prices, market data and metadata for crypto assets, a good test of tools that take several arguments. [Server details](/servers/coingecko/).' },
      ],
      after: [
        'Servers from Notion, Linear, GitHub and others in the [catalog](/catalog) use OAuth, so you sign in with your own '
          + 'account at the provider. Their tools then act on your data, so read each tool\'s description before you run it.',
      ],
    },
    {
      id: 'call-tools-interactively',
      title: 'Call tools interactively',
      paragraphs: [
        'After you connect, the playground lists the server\'s tools, resources and prompts. Choosing a tool turns its input '
          + 'schema into a form with the required fields marked. Results appear with their text, images and '
          + 'structured content, and each call stays in the history so you can change one argument and run it again.',
        'Everything the server sent is in the message log, which helps when a tool answers in an unexpected shape. If you are '
          + 'new to the vocabulary, [what can you do with MCP](/learn/what-can-you-do-with-mcp) has examples by use case.',
      ],
    },
    {
      id: 'share-what-you-found',
      title: 'Share what you found',
      items: [
        { title: 'Result links', description: 'Share a tool call: the link carries the server, the tool and its arguments, and the recipient runs the same call.' },
        { title: 'Connection links', description: 'Send a link that opens the playground already connecting to the same endpoint.' },
        { title: 'Reports', description: 'A [report](/report) scores the server and can be shared as a link or a README badge.' },
        { title: 'Dashboards', description: 'Save calls as cards on a dashboard and re-run them together to watch a server over time.' },
      ],
    },
    {
      id: 'more-servers',
      title: 'Find more servers',
      paragraphs: [
        'The catalog is grouped by category, from [developer tools](/catalog/developer-tools) to [finance](/catalog/finance), '
          + 'and each entry shows its transport, authentication and latest validation. If you run a public server, '
          + '[submit it](/submit) to the catalog.',
      ],
    },
  ],
  faq: [
    {
      question: 'Do I need an API key to use the playground?',
      answer: 'Not for the playground itself, and not for servers marked as open in the catalog. Servers that use OAuth ask '
        + 'you to sign in with the provider, and a few expect an API key you get from them.',
    },
    {
      question: 'Is it safe to call tools on someone else\'s server?',
      answer: 'Treat it like any third-party API. Read-only tools are low risk; tools that write, send or delete act with your '
        + 'credentials. The [server trust checklist](/learn/mcp-server-trust-checklist) covers what to check first.',
    },
    {
      question: 'Does a shared result link contain my credentials?',
      answer: 'No. It contains the server URL, the tool name and the arguments, so leave secrets out of the arguments. '
        + 'The recipient connects with their own access.',
    },
    {
      question: 'Can I use the playground with my own server?',
      answer: 'Yes. Paste its URL into the field above. To check it thoroughly rather than try it, see '
        + '[test your MCP server online](/mcp-test-server).',
    },
  ],
  relatedTitle: 'Related',
  related: [
    { label: 'Test your MCP server online', href: MCP_TEST_SERVER_PATH, description: 'A full check of your own endpoint.' },
    { label: 'MCP Inspector online', href: MCP_INSPECTOR_ONLINE_PATH, description: 'The playground compared with the official Inspector.' },
    { label: 'Connect a remote MCP server', href: '/learn/connect-remote-mcp-server', description: 'Adding a server you tried here to your AI client.' },
    { label: 'Server catalog', href: '/catalog', description: 'Every public remote server, with live validation.' },
  ],
  llmsNote: 'Try public remote MCP servers from the catalog, call their tools interactively and share result links.',
};

export const KEYWORD_LANDING_PAGES: readonly KeywordLandingPage[] = [
  TEST_SERVER_PAGE,
  INSPECTOR_ONLINE_PAGE,
  PLAYGROUND_PAGE,
];

/** The landing page at exactly `pathname`, or undefined. */
export const getKeywordLandingPage = (pathname: string): KeywordLandingPage | undefined =>
  KEYWORD_LANDING_PAGES.find(page => page.path === pathname);

/** FAQPage JSON-LD for exactly the page's visible FAQ; the prerender and the app emit the same object. */
export function getKeywordLandingFaqStructuredData(page: KeywordLandingPage): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: page.faq.map(item => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: landingPlainText(item.answer) },
    })),
  };
}
