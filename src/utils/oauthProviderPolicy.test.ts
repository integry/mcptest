import { describe, expect, it } from 'vitest';
import {
  getOAuthClientEstablishmentStrategy,
  getOAuthProviderPolicy,
  providerRequiresDynamicRegistration,
} from './oauthProviderPolicy';

describe('Calendly OAuth provider policy', () => {
  const target = 'https://mcp.calendly.com/';
  const issuer = 'https://calendly.com/';

  it('requires DCR only for the exact target and issuer binding', () => {
    expect(getOAuthProviderPolicy(target, issuer)).toMatchObject({
      id: 'calendly',
      targetUrls: [target],
      issuerUrls: [issuer],
      clientEstablishmentStrategy: 'dynamic-client-registration-only',
      approvedRegistrationEndpoint: 'https://calendly.com/oauth/register',
    });
    expect(getOAuthClientEstablishmentStrategy(target, issuer))
      .toBe('dynamic-client-registration-only');
    expect(providerRequiresDynamicRegistration(target, issuer)).toBe(true);
  });

  it.each([
    ['lookalike target', 'https://mcp.calendly.com.example/', issuer],
    ['lookalike issuer', target, 'https://calendly.com.example/'],
    ['issuer subdomain', target, 'https://auth.calendly.com/'],
    ['issuer path', target, 'https://calendly.com/oauth/'],
  ])('does not apply the policy to a %s', (_label, candidateTarget, candidateIssuer) => {
    expect(getOAuthProviderPolicy(candidateTarget, candidateIssuer)).toBeUndefined();
    expect(getOAuthClientEstablishmentStrategy(candidateTarget, candidateIssuer))
      .toBe('standards-advertised');
    expect(providerRequiresDynamicRegistration(candidateTarget, candidateIssuer)).toBe(false);
  });
});
