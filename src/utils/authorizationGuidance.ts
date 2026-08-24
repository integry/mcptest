import type {
  CatalogAuthType,
  CatalogOAuthRegistrationEvidence,
  CatalogOAuthResponsibleParty,
  CatalogServer,
} from '../types/catalog';

export type AuthorizationGuidanceStatus =
  | 'no-registration-needed'
  | 'register-app-first'
  | 'operator-setup-required'
  | 'provider-approval-required'
  | 'alternative-credential'
  | 'unknown';

export interface AuthorizationGuidanceSetting {
  label: string;
  value: string;
  required: boolean;
}

export interface AuthorizationGuidanceViewModel {
  version: 1;
  trustedCatalogMatch: boolean;
  catalogId?: string;
  providerName: string;
  status: AuthorizationGuidanceStatus;
  statusLabel: string;
  summary: string;
  steps: string[];
  callbacks: string[];
  settings: AuthorizationGuidanceSetting[];
  documentationUrl?: string;
  registrationUrl?: string;
  reviewedAt?: string;
  alternativeAuthType?: CatalogAuthType;
  alternativeHeaderName?: string;
  alternativeHeaderTemplate?: string;
  clientIdRequired: boolean;
  clientSecretRequired: boolean;
  browserPublicClientSupported: boolean | 'unknown';
  browserClientFormAllowed: boolean;
  canAttemptHostedAuthorization: boolean;
  responsibleParty?: CatalogOAuthResponsibleParty;
  availability?: CatalogOAuthRegistrationEvidence['availability'];
}

const authLabel = (authType: CatalogAuthType | undefined): string => {
  if (authType === 'api-token') return 'API token';
  if (authType === 'api-key') return 'API key';
  if (authType === 'bearer-token') return 'bearer token';
  return 'alternative credential';
};

const authLabelWithArticle = (authType: CatalogAuthType | undefined): string => (
  authType === 'api-token' || authType === 'api-key'
    ? `an ${authLabel(authType)}`
    : `a ${authLabel(authType)}`
);

const unique = (values: Array<string | undefined>): string[] => (
  [...new Set(values.filter((value): value is string => Boolean(value)))]
);

const callbackUrls = (registration: CatalogOAuthRegistrationEvidence): string[] => unique([
  registration.hostedCallbackUrl,
  ...Object.values(registration.callback.redirectUrls ?? {}).flatMap((urls) => urls ?? []),
]);

const alternativeHeader = (
  server: CatalogServer,
  alternativeAuthType: CatalogAuthType | undefined
): { name: string; valueTemplate: string } | undefined => {
  if (!alternativeAuthType) return undefined;
  const header = server.requiredHeaders?.find(({ secret, valueTemplate }) => (
    secret === true && Boolean(valueTemplate)
  ));
  return header?.valueTemplate ? { name: header.name, valueTemplate: header.valueTemplate } : undefined;
};

const unknownGuidance = (providerName: string, trustedCatalogMatch = false): AuthorizationGuidanceViewModel => ({
  version: 1,
  trustedCatalogMatch,
  providerName,
  status: 'unknown',
  statusLabel: 'Registration requirements not verified',
  summary: 'The OAuth authorization and app-registration requirements for this exact endpoint have not been verified. A compatible client will request authorization, but follow the publisher documentation and do not guess client credentials or callbacks.',
  steps: [],
  callbacks: [],
  settings: [],
  clientIdRequired: false,
  clientSecretRequired: false,
  browserPublicClientSupported: 'unknown',
  browserClientFormAllowed: false,
  // Unknown catalog evidence must not change standards-based behavior for an
  // arbitrary target. It only prevents us from presenting guessed guidance.
  canAttemptHostedAuthorization: true,
});

export const createAuthorizationGuidance = (
  server: CatalogServer
): AuthorizationGuidanceViewModel => {
  const base = {
    version: 1 as const,
    trustedCatalogMatch: true,
    catalogId: server.id,
    providerName: server.name,
  };

  if (server.authType === 'none') {
    return {
      ...base,
      status: 'no-registration-needed',
      statusLabel: 'No app registration needed',
      summary: 'This catalog entry does not require authorization or provider app registration.',
      steps: [], callbacks: [], settings: [],
      clientIdRequired: false, clientSecretRequired: false,
      browserPublicClientSupported: true,
      browserClientFormAllowed: false,
      canAttemptHostedAuthorization: true,
    };
  }

  if (server.authType !== 'oauth') {
    const header = alternativeHeader(server, server.authType);
    return {
      ...base,
      status: 'alternative-credential',
      statusLabel: `${authLabel(server.authType)} required`,
      summary: `Use the publisher-documented ${authLabel(server.authType)} route. Keep the credential in protected client storage and replace only the named placeholder at connection time.`,
      steps: [], callbacks: [], settings: [],
      documentationUrl: server.listingSource?.url || server.homepageUrl,
      alternativeAuthType: server.authType,
      alternativeHeaderName: header?.name,
      alternativeHeaderTemplate: header?.valueTemplate,
      clientIdRequired: false, clientSecretRequired: false,
      browserPublicClientSupported: false,
      browserClientFormAllowed: false,
      canAttemptHostedAuthorization: false,
    };
  }

  const registration = server.oauthRegistration;
  if (!registration) return { ...unknownGuidance(server.name, true), ...base };

  const header = alternativeHeader(server, registration.alternativeAuthType);
  const common = {
    ...base,
    steps: registration.setupSteps ?? [],
    callbacks: callbackUrls(registration),
    settings: registration.settings ?? [],
    documentationUrl: registration.evidenceUrl,
    registrationUrl: registration.registrationUrl || registration.approvalUrl,
    reviewedAt: registration.reviewedAt,
    alternativeAuthType: registration.alternativeAuthType,
    alternativeHeaderName: header?.name,
    alternativeHeaderTemplate: header?.valueTemplate,
    responsibleParty: registration.responsibleParty,
    clientIdRequired: registration.clientId.required,
    clientSecretRequired: registration.clientSecret.required,
    browserPublicClientSupported: registration.browserPublicClientSupported ?? 'unknown' as const,
    browserClientFormAllowed: registration.clientId.required
      && !registration.clientSecret.required
      && registration.browserPublicClientSupported === true,
    availability: registration.availability,
  };

  if (registration.mode === 'automatic') {
    return {
      ...common,
      status: 'no-registration-needed',
      statusLabel: 'No app registration needed',
      summary: 'The publisher supports automatic registration for compatible public clients. No additional provider app setup is required.',
      canAttemptHostedAuthorization: registration.availability !== 'unsupported',
    };
  }
  if (registration.mode === 'pre-registered-required') {
    if (registration.availability === 'operator-configuration-missing') {
      return {
        ...common,
        status: 'operator-setup-required',
        statusLabel: 'Hosted mcptest operator setup required',
        summary: `A user-created ${server.name} app and secret work with documented supported clients that can protect the secret. Hosted mcptest cannot accept the secret in the browser or use that app automatically; Retry remains unavailable until the mcptest operator configures a confidential binding server-side.`,
        canAttemptHostedAuthorization: false,
      };
    }
    return {
      ...common,
      status: 'register-app-first',
      statusLabel: 'Register an app first',
      summary: registration.clientSecret.required
        ? `Create a ${server.name} provider app before authorizing. Both a client ID and client secret are required; mcptest never accepts or stores the secret in the browser.`
        : `Create a ${server.name} provider app before authorizing and register the documented callback.`,
      canAttemptHostedAuthorization: registration.availability === 'ready',
    };
  }
  if (registration.mode === 'operator-confidential') {
    return {
      ...common,
      status: 'operator-setup-required',
      statusLabel: 'mcptest operator setup required',
      summary: `This provider requires a confidential application managed by the mcptest operator. Its client secret and token exchange stay server-side and must never be pasted into a browser.`,
      canAttemptHostedAuthorization: registration.availability === 'ready',
    };
  }
  if (registration.mode === 'provider-approval') {
    return {
      ...common,
      status: 'provider-approval-required',
      statusLabel: 'Provider approval required',
      summary: `The provider only accepts reviewed or allowlisted clients. Authenticated testing remains unavailable until mcptest is approved; an arbitrary client ID or client impersonation will not bypass this requirement.`,
      canAttemptHostedAuthorization: registration.availability === 'ready',
    };
  }
  if (registration.mode === 'unknown') {
    return {
      ...unknownGuidance(server.name, true),
      ...base,
      documentationUrl: registration.evidenceUrl,
      reviewedAt: registration.reviewedAt,
      availability: registration.availability,
    };
  }

  return {
    ...common,
    status: 'alternative-credential',
    statusLabel: `Use ${authLabelWithArticle(registration.alternativeAuthType)}`,
    summary: `For hosted mcptest, automatic OAuth client registration is unavailable. Use the publisher-documented ${authLabel(registration.alternativeAuthType)} route and keep the credential in protected client storage.`,
    canAttemptHostedAuthorization: false,
  };
};

export const createUnknownAuthorizationGuidance = unknownGuidance;
