import { describe, expect, it } from 'vitest';
import { getCatalogServerById } from './catalogUtils';
import { createAuthorizationGuidance } from './authorizationGuidance';
import { getAuthorizationGuidanceForEndpoint } from './authorizationGuidanceLookup';

describe('authorization guidance classifications', () => {
  it.each([
    ['asana', 'operator-setup-required', true, true],
    ['figma', 'provider-approval-required', false, false],
    ['vercel', 'provider-approval-required', false, false],
    ['github', 'operator-setup-required', true, true],
    ['slack', 'operator-setup-required', true, true],
    ['pagerduty', 'alternative-credential', false, false],
    ['linear', 'no-registration-needed', false, false],
    ['notion', 'no-registration-needed', false, false],
    ['atlassian', 'no-registration-needed', false, false],
    ['stripe', 'no-registration-needed', false, false],
  ] as const)('classifies %s', (id, status, clientIdRequired, clientSecretRequired) => {
    const server = getCatalogServerById(id);
    expect(server).toBeDefined();
    const guidance = createAuthorizationGuidance(server!);
    expect(guidance).toMatchObject({ status, clientIdRequired, clientSecretRequired });
  });

  it('retains Asana publisher settings and the hosted callback without allowing a browser form', () => {
    const guidance = getAuthorizationGuidanceForEndpoint('https://mcp.asana.com/v2/mcp');
    expect(guidance.callbacks).toContain('https://mcptest.io/oauth/callback');
    expect(guidance.settings).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'App type', value: 'MCP app' }),
      expect.objectContaining({ label: 'Distribution' }),
    ]));
    expect(guidance.browserClientFormAllowed).toBe(false);
    expect(guidance.canAttemptHostedAuthorization).toBe(false);
    expect(guidance).toMatchObject({
      status: 'operator-setup-required',
      responsibleParty: 'mcptest-operator',
    });
    expect(guidance.summary).toContain('user-created Asana app and secret work with documented supported clients');
    expect(guidance.summary).toContain('Retry remains unavailable until the mcptest operator configures a confidential binding server-side');
  });

  it('classifies Stripe publisher metadata as automatic, public, secretless, and ready', () => {
    const stripe = getCatalogServerById('stripe');
    expect(stripe?.oauthRegistration).toMatchObject({
      mode: 'automatic',
      responsibleParty: 'automatic',
      clientId: { required: false },
      clientSecret: { required: false },
      browserPublicClientSupported: true,
      availability: 'ready',
      evidenceUrl: 'https://access.stripe.com/.well-known/oauth-authorization-server/mcp',
    });

    const guidance = getAuthorizationGuidanceForEndpoint('https://mcp.stripe.com');
    expect(guidance).toMatchObject({
      status: 'no-registration-needed',
      responsibleParty: 'automatic',
      browserPublicClientSupported: true,
      canAttemptHostedAuthorization: true,
    });
    expect(guidance.summary).toContain('No additional provider app setup is required');
  });

  it('presents the PagerDuty placeholder but no credential value', () => {
    const guidance = getAuthorizationGuidanceForEndpoint('https://mcp.pagerduty.com/mcp');
    expect(guidance.alternativeHeaderTemplate).toBe('Token token=<PAGERDUTY_API_TOKEN>');
    expect(JSON.stringify(guidance)).not.toMatch(/Token token=(?!<PAGERDUTY_API_TOKEN>)/);
  });
});

describe('trusted endpoint matching', () => {
  it.each([
    'https://mcp.figma.com/mcp/',
    'https://mcp.figma.com/mcp?target=https://mcp.figma.com/mcp',
    'https://mcp.figma.com/mcp#https://mcp.figma.com/mcp',
    'https://mcp.figma.com/%6dcp',
    'https://mcp.figma.com.evil.example/mcp',
    'https://evil.example/mcp?issuer=https://api.figma.com',
    'https://user:password@mcp.figma.com/mcp',
    'https://sub.mcp.figma.com/mcp',
  ])('does not trust manipulated endpoint %s', (endpoint) => {
    expect(getAuthorizationGuidanceForEndpoint(endpoint)).toMatchObject({
      trustedCatalogMatch: false,
      status: 'unknown',
    });
  });

  it('trusts only the exact canonical endpoint', () => {
    expect(getAuthorizationGuidanceForEndpoint('https://mcp.figma.com/mcp')).toMatchObject({
      trustedCatalogMatch: true,
      catalogId: 'figma',
      status: 'provider-approval-required',
    });
  });
});
