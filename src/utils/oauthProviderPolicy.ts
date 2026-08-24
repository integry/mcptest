export type KnownOAuthProviderId =
  | 'canva'
  | 'calendly'
  | 'figma'
  | 'slack'
  | 'github'
  | 'upwork'
  | 'intercom'
  | 'docusign-developer'
  | 'pagerduty';

export type OAuthClientEstablishmentStrategy =
  | 'standards-advertised'
  | 'dynamic-client-registration'
  | 'dynamic-client-registration-only'
  | 'operator-confidential';

export interface OAuthProviderPolicy {
  id: KnownOAuthProviderId;
  name: string;
  /** Exact catalog targets for which provider-specific behavior is trusted. */
  targetUrls: readonly string[];
  /** Exact issuers that may activate issuer-bound provider behavior. */
  issuerUrls: readonly string[];
  documentationUrl: string;
  registrationUrl?: string;
  registrationMode: 'browser-public' | 'provider-approved' | 'operator-confidential';
  clientEstablishmentStrategy: OAuthClientEstablishmentStrategy;
  supportsBearerToken?: boolean;
  bearerTokenName?: string;
  /** Safe public template used to construct the target Authorization header. */
  authorizationHeaderTemplate?: string;
  /** Exact endpoint that may activate provider-specific registration-response handling. */
  approvedRegistrationEndpoint?: string;
}

const PROVIDER_POLICIES: readonly OAuthProviderPolicy[] = [
  {
    id: 'canva',
    name: 'Canva',
    targetUrls: ['https://mcp.canva.com/mcp'],
    issuerUrls: ['https://mcp.canva.com'],
    documentationUrl: 'https://www.canva.dev/docs/mcp/',
    registrationMode: 'browser-public',
    // Live evidence, 2026-08-24:
    // https://mcp.canva.com/.well-known/oauth-authorization-server advertises
    // both CIMD and https://mcp.canva.com/register. The hosted CIMD client ID
    // was rejected before authorization, while this issuer-bound DCR endpoint
    // returned a public client (HTTP 201, token_endpoint_auth_method=none).
    clientEstablishmentStrategy: 'dynamic-client-registration',
  },
  {
    id: 'calendly',
    name: 'Calendly',
    targetUrls: ['https://mcp.calendly.com/'],
    issuerUrls: ['https://calendly.com/'],
    documentationUrl: 'https://developer.calendly.com/calendly-mcp-server',
    registrationMode: 'browser-public',
    // Calendly documents its MCP OAuth client establishment as DCR-only.
    // Static and manually pre-registered client IDs are not supported. This
    // policy activates only for the exact catalog target and discovered issuer.
    clientEstablishmentStrategy: 'dynamic-client-registration-only',
    approvedRegistrationEndpoint: 'https://calendly.com/oauth/register',
  },
  {
    id: 'figma',
    name: 'Figma',
    targetUrls: ['https://mcp.figma.com/mcp'],
    issuerUrls: ['https://api.figma.com'],
    documentationUrl: 'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/',
    registrationMode: 'provider-approved',
    clientEstablishmentStrategy: 'standards-advertised',
    approvedRegistrationEndpoint: 'https://api.figma.com/v1/oauth/mcp/register',
  },
  {
    id: 'slack',
    name: 'Slack',
    targetUrls: ['https://mcp.slack.com/mcp'],
    // Slack has published both values during the catalog lifetime. Each is an
    // exact binding for the one trusted target; subdomains and paths do not match.
    issuerUrls: ['https://mcp.slack.com', 'https://slack.com'],
    documentationUrl: 'https://docs.slack.dev/ai/slack-mcp-server/',
    registrationUrl: 'https://api.slack.com/apps',
    registrationMode: 'operator-confidential',
    clientEstablishmentStrategy: 'operator-confidential',
  },
  {
    id: 'github',
    name: 'GitHub',
    targetUrls: ['https://api.githubcopilot.com/mcp/'],
    issuerUrls: ['https://github.com/login/oauth'],
    documentationUrl: 'https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md',
    registrationUrl: 'https://github.com/settings/applications/new',
    registrationMode: 'operator-confidential',
    clientEstablishmentStrategy: 'operator-confidential',
    supportsBearerToken: true,
    bearerTokenName: 'GitHub personal access token',
  },
  {
    id: 'upwork',
    name: 'Upwork',
    targetUrls: ['https://mcp.upwork.com/mcp'],
    issuerUrls: ['https://mcp.upwork.com'],
    documentationUrl: 'https://www.upwork.com/ai/mcp',
    registrationMode: 'browser-public',
    clientEstablishmentStrategy: 'standards-advertised',
  },
  {
    id: 'intercom',
    name: 'Intercom',
    targetUrls: ['https://mcp.intercom.com/mcp'],
    issuerUrls: [],
    documentationUrl: 'https://developers.intercom.com/docs/guides/mcp',
    registrationMode: 'browser-public',
    clientEstablishmentStrategy: 'standards-advertised',
    supportsBearerToken: true,
    bearerTokenName: 'Intercom access token',
  },
  {
    id: 'docusign-developer',
    name: 'Docusign Developer',
    targetUrls: ['https://mcp-d.docusign.com/mcp'],
    issuerUrls: ['https://mcp-d.docusign.com'],
    documentationUrl: 'https://www.docusign.com/blog/developers/claude-docusign-mcp-connector-guide',
    registrationMode: 'browser-public',
    clientEstablishmentStrategy: 'standards-advertised',
  },
  {
    id: 'pagerduty',
    name: 'PagerDuty',
    targetUrls: ['https://mcp.pagerduty.com/mcp'],
    issuerUrls: ['https://mcp.pagerduty.com/'],
    documentationUrl: 'https://support.pagerduty.com/main/docs/pagerduty-mcp-server',
    registrationMode: 'browser-public',
    clientEstablishmentStrategy: 'standards-advertised',
    supportsBearerToken: true,
    bearerTokenName: 'PagerDuty API token',
    authorizationHeaderTemplate: 'Token token=<TOKEN>',
  },
] as const;

const exactUrlMatches = (actual: string | undefined, expected: string): boolean => {
  if (!actual) return false;
  try {
    return new URL(actual).toString() === new URL(expected).toString();
  } catch {
    return false;
  }
};

export const getOAuthProviderPolicy = (
  serverUrl: string,
  issuer?: string
): OAuthProviderPolicy | undefined => {
  const targetPolicy = PROVIDER_POLICIES.find((policy) => (
    policy.targetUrls.some((target) => exactUrlMatches(serverUrl, target))
  ));

  // Target-only lookup is for display/discovery guidance. Issuer-bound client
  // establishment always supplies issuer and must match this exact allow-list.
  if (!targetPolicy || !issuer) return targetPolicy;
  return targetPolicy.issuerUrls.some((trustedIssuer) => exactUrlMatches(issuer, trustedIssuer))
    ? targetPolicy
    : undefined;
};

export const getOAuthClientEstablishmentStrategy = (
  serverUrl: string,
  issuer: string | undefined
): OAuthClientEstablishmentStrategy => (
  issuer
    ? getOAuthProviderPolicy(serverUrl, issuer)?.clientEstablishmentStrategy
      || 'standards-advertised'
    : 'standards-advertised'
);

export const isPolicyRegistrationApprovalRejection = (
  policy: OAuthProviderPolicy | undefined,
  registrationEndpoint: string | undefined,
  status: number,
  responseIsOpaque: boolean
): boolean => {
  if (
    policy?.registrationMode !== 'provider-approved'
    || !policy.approvedRegistrationEndpoint
    || !registrationEndpoint
    || status !== 403
    || !responseIsOpaque
  ) return false;

  return exactUrlMatches(registrationEndpoint, policy.approvedRegistrationEndpoint);
};

export const providerForbidsDynamicRegistration = (
  serverUrl: string,
  issuer?: string
): boolean => getOAuthClientEstablishmentStrategy(serverUrl, issuer) === 'operator-confidential';

export const providerRequiresDynamicRegistration = (
  serverUrl: string,
  issuer?: string
): boolean => getOAuthClientEstablishmentStrategy(serverUrl, issuer)
  === 'dynamic-client-registration-only';
