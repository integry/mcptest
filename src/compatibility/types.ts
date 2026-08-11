export const COMPATIBILITY_SCHEMA_VERSION = '1.0' as const;

export type CompatibilitySchemaVersion = typeof COMPATIBILITY_SCHEMA_VERSION;
export type Known<T> = T | 'unknown';

export type HostId = 'chatgpt' | 'claude' | 'cursor' | 'vscode-copilot' | 'generic-sdk';
export type CompatibilityStatus =
  | 'compatible'
  | 'compatible-with-caveats'
  | 'incompatible'
  | 'unknown';
export type CompatibilitySeverity = 'info' | 'warning' | 'error';
export type FindingOutcome = 'pass' | 'caveat' | 'fail' | 'unknown';
export type FindingScope = 'target-server' | 'authorization-server' | 'client-environment';

export interface CompatibilityEvidenceV1 {
  schemaVersion: CompatibilitySchemaVersion;
  source:
    | 'target-server'
    | 'authorization-server'
    | 'browser'
    | 'proxy'
    | 'configuration'
    | 'host-profile';
  description: string;
  location?: string;
}

export interface ObservedValueV1<T> {
  value: Known<T>;
  evidence: readonly CompatibilityEvidenceV1[];
}

export type TransportKind = 'streamable-http' | 'legacy-sse';
export type ProtocolEra = '2024' | '2025' | '2026';
export type SessionBehavior = 'stateful' | 'stateless';
export type AuthorizationRequirement = 'none' | 'optional' | 'required';
export type AuthorizationScheme = 'oauth' | 'bearer' | 'api-key';
export type OAuthRegistrationMode =
  | 'client-id-metadata-document'
  | 'dynamic-client-registration'
  | 'pre-registered'
  | 'manual-client-credentials';
export type RedirectPolicy = 'unrestricted' | 'https-only' | 'loopback-only' | 'exact-match';
export type CapabilityAvailability = 'present' | 'absent';
export type DirectAccess = 'reachable' | 'blocked';
export type ProxyRoute = 'not-used' | 'used' | 'failed';
export type CorsBehavior = 'allowed' | 'blocked';

export interface ObservedServerFactsV1 {
  schemaVersion: CompatibilitySchemaVersion;
  serverUrl?: string;
  transport: {
    kind: ObservedValueV1<TransportKind>;
  };
  protocol: {
    era: ObservedValueV1<ProtocolEra>;
    version: ObservedValueV1<string>;
    sessionBehavior: ObservedValueV1<SessionBehavior>;
  };
  authorization: {
    requirement: ObservedValueV1<AuthorizationRequirement>;
    schemes: ObservedValueV1<readonly AuthorizationScheme[]>;
    oauth: {
      protectedResourceMetadata: ObservedValueV1<boolean>;
      authorizationServerMetadata: ObservedValueV1<boolean>;
      registrationModes: ObservedValueV1<readonly OAuthRegistrationMode[]>;
      pkceS256: ObservedValueV1<boolean>;
      refreshTokens: ObservedValueV1<boolean>;
      redirectPolicy: ObservedValueV1<RedirectPolicy>;
      registeredRedirectUris: ObservedValueV1<readonly string[]>;
      dynamicRedirectRegistration: ObservedValueV1<boolean>;
    };
  };
  capabilities: {
    tools: ObservedValueV1<CapabilityAvailability>;
    resources: ObservedValueV1<CapabilityAvailability>;
    prompts: ObservedValueV1<CapabilityAvailability>;
    resourceSubscriptions: ObservedValueV1<CapabilityAvailability>;
    sampling: ObservedValueV1<CapabilityAvailability>;
    elicitation: ObservedValueV1<CapabilityAvailability>;
    tasks: ObservedValueV1<CapabilityAvailability>;
  };
  environment: {
    directAccess: ObservedValueV1<DirectAccess>;
    cors: ObservedValueV1<CorsBehavior>;
    proxyRoute: ObservedValueV1<ProxyRoute>;
  };
}

export type CompatibilityFactPath =
  | 'transport.kind'
  | 'protocol.era'
  | 'protocol.version'
  | 'protocol.sessionBehavior'
  | 'authorization.requirement'
  | 'authorization.schemes'
  | 'authorization.oauth.protectedResourceMetadata'
  | 'authorization.oauth.authorizationServerMetadata'
  | 'authorization.oauth.registrationModes'
  | 'authorization.oauth.pkceS256'
  | 'authorization.oauth.refreshTokens'
  | 'authorization.oauth.redirectPolicy'
  | 'authorization.oauth.registeredRedirectUris'
  | 'authorization.oauth.dynamicRedirectRegistration'
  | 'capabilities.tools'
  | 'capabilities.resources'
  | 'capabilities.prompts'
  | 'capabilities.resourceSubscriptions'
  | 'capabilities.sampling'
  | 'capabilities.elicitation'
  | 'capabilities.tasks'
  | 'environment.directAccess'
  | 'environment.cors'
  | 'environment.proxyRoute';

export type CompatibilityConditionV1 =
  | {
      fact: CompatibilityFactPath;
      operator: 'equals' | 'not-equals';
      value: string | boolean;
    }
  | {
      fact: CompatibilityFactPath;
      operator: 'one-of' | 'contains-any' | 'contains-all';
      value: readonly (string | boolean)[];
    }
  | { all: readonly CompatibilityConditionV1[] }
  | { any: readonly CompatibilityConditionV1[] }
  | { not: CompatibilityConditionV1 };

export interface CompatibilityRemediationV1 {
  schemaVersion: CompatibilitySchemaVersion;
  kind:
    | 'server-change'
    | 'authorization-server-change'
    | 'client-configuration'
    | 'observation-needed';
  action: string;
  documentationUrl?: string;
}

export interface RuleResultDefinitionV1 {
  outcome: FindingOutcome;
  severity: CompatibilitySeverity;
  summary: string;
  detail: string;
  remediation?: CompatibilityRemediationV1;
}

export interface CompatibilityRuleV1 {
  schemaVersion: CompatibilitySchemaVersion;
  id: string;
  scope: FindingScope;
  appliesWhen?: CompatibilityConditionV1;
  passWhen: CompatibilityConditionV1;
  onPass: RuleResultDefinitionV1;
  onFail: RuleResultDefinitionV1;
  onUnknown: RuleResultDefinitionV1;
  evidenceFacts: readonly CompatibilityFactPath[];
  assumptionSourceIds: readonly string[];
}

export interface HostAssumptionSourceV1 {
  id: string;
  title: string;
  url: string;
  accessedOn: string;
  notes: string;
}

export interface HostProfileV1 {
  schemaVersion: CompatibilitySchemaVersion;
  profileVersion: string;
  id: HostId;
  name: string;
  description: string;
  assumptions: readonly HostAssumptionSourceV1[];
  rules: readonly CompatibilityRuleV1[];
}

export interface CompatibilityFindingV1 {
  schemaVersion: CompatibilitySchemaVersion;
  ruleId: string;
  scope: FindingScope;
  outcome: FindingOutcome;
  severity: CompatibilitySeverity;
  summary: string;
  detail: string;
  evidence: readonly CompatibilityEvidenceV1[];
  remediation?: CompatibilityRemediationV1;
}

export interface HostCompatibilityAssessmentV1 {
  schemaVersion: CompatibilitySchemaVersion;
  profileId: HostId;
  profileVersion: string;
  status: CompatibilityStatus;
  findings: readonly CompatibilityFindingV1[];
}

export interface CompatibilityMatrixV1 {
  schemaVersion: CompatibilitySchemaVersion;
  assessments: Readonly<Record<HostId, HostCompatibilityAssessmentV1>>;
}
