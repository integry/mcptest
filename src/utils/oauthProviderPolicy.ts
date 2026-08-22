export type KnownOAuthProviderId = 'figma' | 'slack' | 'github';

export interface OAuthProviderPolicy {
  id: KnownOAuthProviderId;
  name: string;
  targetHosts: readonly string[];
  issuerHosts: readonly string[];
  documentationUrl: string;
  registrationUrl?: string;
  registrationMode: 'provider-approved' | 'operator-confidential';
  supportsBearerToken?: boolean;
  bearerTokenName?: string;
  /** Exact endpoint whose otherwise opaque rejection is covered by provider policy. */
  approvedRegistrationEndpoint?: string;
}

const PROVIDER_POLICIES: readonly OAuthProviderPolicy[] = [
  {
    id: 'figma',
    name: 'Figma',
    targetHosts: ['mcp.figma.com'],
    issuerHosts: ['api.figma.com'],
    documentationUrl: 'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/',
    registrationMode: 'provider-approved',
    approvedRegistrationEndpoint: 'https://api.figma.com/v1/oauth/mcp/register',
  },
  {
    id: 'slack',
    name: 'Slack',
    targetHosts: ['mcp.slack.com'],
    issuerHosts: ['slack.com'],
    documentationUrl: 'https://docs.slack.dev/ai/slack-mcp-server/',
    registrationUrl: 'https://api.slack.com/apps',
    registrationMode: 'operator-confidential',
  },
  {
    id: 'github',
    name: 'GitHub',
    targetHosts: ['api.githubcopilot.com'],
    issuerHosts: ['github.com'],
    documentationUrl: 'https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md',
    registrationUrl: 'https://github.com/settings/applications/new',
    registrationMode: 'operator-confidential',
    supportsBearerToken: true,
    bearerTokenName: 'GitHub personal access token',
  },
] as const;

const hostname = (value?: string): string | undefined => {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

const hostMatches = (actual: string | undefined, expected: string): boolean => (
  actual === expected || actual?.endsWith(`.${expected}`) === true
);

export const getOAuthProviderPolicy = (
  serverUrl: string,
  issuer?: string
): OAuthProviderPolicy | undefined => {
  const targetHost = hostname(serverUrl);
  const issuerHost = hostname(issuer);
  const targetPolicy = PROVIDER_POLICIES.find((policy) => (
    policy.targetHosts.some((host) => hostMatches(targetHost, host))
  ));

  // Discovery metadata is controlled by the target. It may confirm the
  // provider selected from a trusted target host, but it must never enable
  // provider-specific credentials for an otherwise unknown target.
  if (!targetPolicy || !issuerHost) return targetPolicy;
  return targetPolicy.issuerHosts.some((host) => hostMatches(issuerHost, host))
    ? targetPolicy
    : undefined;
};

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

  try {
    return new URL(registrationEndpoint).toString()
      === new URL(policy.approvedRegistrationEndpoint).toString();
  } catch {
    return false;
  }
};

export const providerForbidsDynamicRegistration = (
  serverUrl: string,
  issuer?: string
): boolean => getOAuthProviderPolicy(serverUrl, issuer)?.registrationMode === 'operator-confidential';
