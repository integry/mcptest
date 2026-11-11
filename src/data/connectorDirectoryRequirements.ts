/**
 * Submission requirements for the Claude Connectors Directory and the ChatGPT
 * Directory, transcribed from the vendors' own documentation. Only requirements
 * stated in official documentation appear here. Each item names the page it
 * comes from and the date that page was last read against this module, and
 * `connectorDirectoryRequirements.test.ts` enforces both.
 *
 * `automatic` items are evaluated by `src/utils/connectorDirectoryPreflight.ts`
 * from evidence a report already holds. `manual` items cannot be observed from
 * the MCP endpoint and are shown as a checklist with their source link, never
 * as passed or failed.
 */

export type ConnectorDirectoryId = 'claude' | 'chatgpt';

/** Date the sources below were last read and compared with this module. */
export const CONNECTOR_DIRECTORY_REQUIREMENTS_REVIEWED_ON = '2026-11-11';

export interface DirectoryRequirementSource {
  title: string;
  url: string;
  /** ISO date (YYYY-MM-DD) the page was last read for this requirement. */
  reviewedOn: string;
}

export interface ConnectorDirectory {
  id: ConnectorDirectoryId;
  name: string;
  vendor: string;
  /** The vendor's submission entry point for this directory. */
  submissionUrl: string;
}

export type ConnectorDirectoryRequirementId =
  | 'claude.remote-https'
  | 'claude.tool-title'
  | 'claude.tool-safety-hint'
  | 'claude.tool-name-length'
  | 'claude.separate-read-write'
  | 'claude.oauth-for-authenticated-services'
  | 'claude.oauth-discovery'
  | 'claude.pkce-s256'
  | 'claude.test-as-custom-connector'
  | 'claude.listing-materials'
  | 'claude.test-account'
  | 'claude.directory-terms'
  | 'claude.allowed-link-uris'
  | 'claude.mcp-app-screenshots'
  | 'chatgpt.remote-https'
  | 'chatgpt.tool-annotations'
  | 'chatgpt.tool-description'
  | 'chatgpt.tool-name-unique'
  | 'chatgpt.supported-authentication'
  | 'chatgpt.privacy-policy'
  | 'chatgpt.test-credentials'
  | 'chatgpt.domain-verification'
  | 'chatgpt.review-test-cases'
  | 'chatgpt.listing-metadata'
  | 'chatgpt.ui-frame-domains';

export interface ConnectorDirectoryRequirement {
  id: ConnectorDirectoryRequirementId;
  directory: ConnectorDirectoryId;
  check: 'automatic' | 'manual';
  title: string;
  /** The requirement as the source states it, condensed. */
  requirement: string;
  source: DirectoryRequirementSource;
}

export interface ConnectorDirectoryAdvisoryDefinition {
  id: 'directory.multiplexed-operations';
  title: string;
  explanation: string;
  /** Official statements the advisory is derived from; the detection itself is a heuristic. */
  sources: readonly DirectoryRequirementSource[];
}

const reviewedOn = CONNECTOR_DIRECTORY_REQUIREMENTS_REVIEWED_ON;

const CLAUDE_SUBMISSION: DirectoryRequirementSource = {
  title: 'Claude Docs: Submit a connector to the directory',
  url: 'https://claude.com/docs/connectors/building/submission',
  reviewedOn,
};
const CLAUDE_REVIEW_CRITERIA: DirectoryRequirementSource = {
  title: 'Claude Docs: Connector pre-submission checklist',
  url: 'https://claude.com/docs/connectors/building/review-criteria',
  reviewedOn,
};
const CLAUDE_AUTHENTICATION: DirectoryRequirementSource = {
  title: 'Claude Docs: Authentication for connectors',
  url: 'https://claude.com/docs/connectors/building/authentication',
  reviewedOn,
};
const OPENAI_GUIDELINES: DirectoryRequirementSource = {
  title: 'OpenAI Developers: Plugin guidelines',
  url: 'https://developers.openai.com/plugins/plugin-guidelines',
  reviewedOn,
};
const OPENAI_SUBMISSION: DirectoryRequirementSource = {
  title: 'OpenAI Developers: Upload and submit your plugin',
  url: 'https://developers.openai.com/plugins/deploy/submission',
  reviewedOn,
};

const at = (source: DirectoryRequirementSource, anchor: string): DirectoryRequirementSource => ({
  ...source,
  url: `${source.url}#${anchor}`,
});

export const CONNECTOR_DIRECTORIES: Record<ConnectorDirectoryId, ConnectorDirectory> = {
  claude: {
    id: 'claude',
    name: 'Claude Connectors Directory',
    vendor: 'Anthropic',
    submissionUrl: CLAUDE_SUBMISSION.url,
  },
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT Directory',
    vendor: 'OpenAI',
    submissionUrl: OPENAI_SUBMISSION.url,
  },
};

export const CONNECTOR_DIRECTORY_REQUIREMENTS: readonly ConnectorDirectoryRequirement[] = [
  {
    id: 'claude.remote-https',
    directory: 'claude',
    check: 'automatic',
    title: 'Remote server reachable over HTTPS',
    requirement: 'The portal asks for an https:// URL of a remote server; a local server cannot be submitted as a connector.',
    source: at(CLAUDE_SUBMISSION, 'pre-submission-checklist-for-connectors'),
  },
  {
    id: 'claude.tool-title',
    directory: 'claude',
    check: 'automatic',
    title: 'Every tool has a title',
    requirement: 'Every tool includes a title; the portal flags tools that are missing one.',
    source: at(CLAUDE_REVIEW_CRITERIA, 'provide-tool-annotations'),
  },
  {
    id: 'claude.tool-safety-hint',
    directory: 'claude',
    check: 'automatic',
    title: 'Every tool sets readOnlyHint: true or destructiveHint: true',
    requirement: 'Every tool includes the applicable hint: readOnlyHint: true for read-only tools and destructiveHint: true for tools that modify or delete data.',
    source: at(CLAUDE_REVIEW_CRITERIA, 'provide-tool-annotations'),
  },
  {
    id: 'claude.tool-name-length',
    directory: 'claude',
    check: 'automatic',
    title: 'Tool names are 64 characters or fewer',
    requirement: 'Tool names must be 64 characters or fewer.',
    source: at(CLAUDE_REVIEW_CRITERIA, 'keep-tool-names-short'),
  },
  {
    id: 'claude.separate-read-write',
    directory: 'claude',
    check: 'automatic',
    title: 'No catch-all tool mixing safe and unsafe HTTP methods',
    requirement: 'A single tool that accepts both safe methods (GET, HEAD, OPTIONS) and unsafe methods (POST, PUT, PATCH, DELETE) is rejected; split it into read-only and write tools.',
    source: at(CLAUDE_REVIEW_CRITERIA, 'separate-read-and-write-tools'),
  },
  {
    id: 'claude.oauth-for-authenticated-services',
    directory: 'claude',
    check: 'automatic',
    title: 'OAuth 2.0 for authenticated services',
    requirement: 'Use OAuth 2.0 if tools act on a user’s account, or no authentication for public data.',
    source: at(CLAUDE_SUBMISSION, 'requirements-for-every-connector'),
  },
  {
    id: 'claude.oauth-discovery',
    directory: 'claude',
    check: 'automatic',
    title: 'OAuth discovery metadata Claude can read',
    requirement: 'Answer unauthenticated requests with 401 pointing at RFC 9728 protected resource metadata, and serve RFC 8414 or OpenID Connect authorization server metadata.',
    source: at(CLAUDE_AUTHENTICATION, 'serve-discovery-metadata'),
  },
  {
    id: 'claude.pkce-s256',
    directory: 'claude',
    check: 'automatic',
    title: 'Authorization server supports S256 PKCE',
    requirement: 'Claude sends code_challenge_method=S256 on every authorization request; the authorization server must support S256 PKCE.',
    source: at(CLAUDE_AUTHENTICATION, 'pkce-and-requested-scopes'),
  },
  {
    id: 'claude.test-as-custom-connector',
    directory: 'claude',
    check: 'manual',
    title: 'Test every tool in Claude as a custom connector',
    requirement: 'Add the server as a custom connector and call each tool from a conversation; the Test & launch step asks you to confirm this.',
    source: at(CLAUDE_SUBMISSION, 'pre-submission-checklist-for-connectors'),
  },
  {
    id: 'claude.listing-materials',
    directory: 'claude',
    check: 'manual',
    title: 'Documentation URL, privacy policy URL, support contact, and icon',
    requirement: 'The listing step asks for a documentation URL, privacy policy URL, support contact, icon, and listing text within the stated length limits.',
    source: at(CLAUDE_SUBMISSION, 'submit-through-the-developer-portal'),
  },
  {
    id: 'claude.test-account',
    directory: 'claude',
    check: 'manual',
    title: 'Test account for reviewers',
    requirement: 'Provide credentials for a fully populated account that only reviewers see.',
    source: at(CLAUDE_REVIEW_CRITERIA, 'gather-what-to-include-with-your-submission'),
  },
  {
    id: 'claude.directory-terms',
    directory: 'claude',
    check: 'manual',
    title: 'Directory terms, policy, and unsupported use cases',
    requirement: 'Comply with the Software Directory Terms and Policy; connectors that transfer money or generate images, video, or audio are not accepted.',
    source: at(CLAUDE_SUBMISSION, 'directory-terms'),
  },
  {
    id: 'claude.allowed-link-uris',
    directory: 'claude',
    check: 'manual',
    title: 'Allowed link URIs (optional, for ui/open-link)',
    requirement: 'If the connector opens external links, list the HTTPS origins and URI schemes you own so users are not prompted for each one.',
    source: at(CLAUDE_SUBMISSION, 'allowed-link-uris'),
  },
  {
    id: 'claude.mcp-app-screenshots',
    directory: 'claude',
    check: 'manual',
    title: 'Carousel screenshots (MCP Apps only)',
    requirement: 'MCP Apps include 3–5 PNG screenshots at least 1000px wide, cropped to the app response, with paired prompt text.',
    source: at(CLAUDE_SUBMISSION, 'carousel-screenshots-for-mcp-apps'),
  },
  {
    id: 'chatgpt.remote-https',
    directory: 'chatgpt',
    check: 'automatic',
    title: 'Stable, public HTTPS endpoint',
    requirement: 'Submit remote MCP servers using a stable, public HTTPS endpoint.',
    source: OPENAI_SUBMISSION,
  },
  {
    id: 'chatgpt.tool-annotations',
    directory: 'chatgpt',
    check: 'automatic',
    title: 'readOnlyHint, destructiveHint, and openWorldHint set on every tool',
    requirement: 'Set readOnlyHint, destructiveHint, and openWorldHint to explicit boolean values in each tool’s annotations object.',
    source: at(OPENAI_GUIDELINES, 'correct-annotation'),
  },
  {
    id: 'chatgpt.tool-description',
    directory: 'chatgpt',
    check: 'automatic',
    title: 'Every tool has a non-empty description',
    requirement: 'Each tool must have a nonempty description that accurately explains its purpose, when to use it, and its limitations or side effects.',
    source: at(OPENAI_GUIDELINES, 'descriptions-that-match-behavior'),
  },
  {
    id: 'chatgpt.tool-name-unique',
    directory: 'chatgpt',
    check: 'automatic',
    title: 'Tool names are unique',
    requirement: 'Tool names must be unique within your MCP server.',
    source: at(OPENAI_GUIDELINES, 'clear-and-accurate-tool-names'),
  },
  {
    id: 'chatgpt.supported-authentication',
    directory: 'chatgpt',
    check: 'automatic',
    title: 'No authentication, OAuth, or mixed access',
    requirement: 'The portal connection form supports no authentication, OAuth, and mixed unauthenticated/OAuth access; it has no API-key or bearer-token connection flow.',
    source: at(OPENAI_SUBMISSION, 'authentication-limitations'),
  },
  {
    id: 'chatgpt.privacy-policy',
    directory: 'chatgpt',
    check: 'manual',
    title: 'Published privacy policy',
    requirement: 'Include a clear, published privacy policy covering data categories collected, purposes, recipients, retention, and user controls.',
    source: at(OPENAI_GUIDELINES, 'privacy-policy'),
  },
  {
    id: 'chatgpt.test-credentials',
    directory: 'chatgpt',
    check: 'manual',
    title: 'Reviewer test account without MFA',
    requirement: 'For an authenticated server, provide a fully featured demo account with sample data that works without MFA, email or SMS codes, magic links, or private-network access.',
    source: at(OPENAI_SUBMISSION, 'complete-review-information'),
  },
  {
    id: 'chatgpt.domain-verification',
    directory: 'chatgpt',
    check: 'manual',
    title: 'Domain verification challenge',
    requirement: 'Host the exact challenge token as plain text at /.well-known/openai-apps-challenge on the MCP hostname or an eligible parent domain.',
    source: at(OPENAI_SUBMISSION, 'domain-verification-details'),
  },
  {
    id: 'chatgpt.review-test-cases',
    directory: 'chatgpt',
    check: 'manual',
    title: 'Five positive and three negative test cases, video, release notes',
    requirement: 'Review information includes five positive test cases, three negative test cases, a video walkthrough URL, and release notes.',
    source: at(OPENAI_SUBMISSION, 'complete-review-information'),
  },
  {
    id: 'chatgpt.listing-metadata',
    directory: 'chatgpt',
    check: 'manual',
    title: 'Plugin name, description, and example prompts',
    requirement: 'Names and descriptions are clear and accurate, do not append “MCP” or “Plugin” to a product name, and come with example prompts.',
    source: at(OPENAI_GUIDELINES, 'plugin-name-description-and-prompts'),
  },
  {
    id: 'chatgpt.ui-frame-domains',
    directory: 'chatgpt',
    check: 'manual',
    title: 'CSP frame domains (plugins with UI only)',
    requirement: 'Declare each required iframe origin in the resource CSP with _meta.ui.csp.frameDomains and justify each embedded page.',
    source: at(OPENAI_GUIDELINES, 'iframes-and-embedded-pages'),
  },
];

export const MULTIPLEXED_OPERATIONS_ADVISORY: ConnectorDirectoryAdvisoryDefinition = {
  id: 'directory.multiplexed-operations',
  title: 'Tool may multiplex several operations behind one argument',
  explanation: 'Both directories ask for one tool per operation. Anthropic rejects a tool that accepts both safe and unsafe HTTP methods and asks for read and write operations in separate tools; OpenAI asks that each model-callable operation be exposed as a separate tool with its own description, schema, and annotations, without operation selection through a generic executor. A single tool whose action or operation argument selects unrelated reads and writes cannot carry one accurate readOnlyHint or destructiveHint, so a reviewer may flag it. This advisory comes from a naming heuristic and may be wrong; check whether the operations are genuinely one capability.',
  sources: [
    at(CLAUDE_REVIEW_CRITERIA, 'separate-read-and-write-tools'),
    at(OPENAI_GUIDELINES, 'tool-independence-and-exposure'),
  ],
};

export const getConnectorDirectoryRequirement = (
  id: ConnectorDirectoryRequirementId
): ConnectorDirectoryRequirement => {
  const requirement = CONNECTOR_DIRECTORY_REQUIREMENTS.find((item) => item.id === id);
  if (!requirement) throw new Error(`Unknown connector directory requirement ${id}.`);
  return requirement;
};
