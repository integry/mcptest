import { SESSION_RESILIENCE_IDS } from '../utils/sessionResilienceDefinitions';
/**
 * Transport-level diagnostics for remote MCP servers.
 *
 * Diagnostic ids are a stable public contract: reports, downloads and the
 * reference documentation key on them. Never rename or reuse an id.
 */
export const TRANSPORT_DIAGNOSTIC_IDS = [
  ...SESSION_RESILIENCE_IDS,
  'transport.accept-header-406',
  'transport.get-stream-405',
  'transport.unsupported-media-type-415',
  'transport.target-rate-limited-429',
  'transport.cors-expose-headers-missing',
  'transport.sse-content-type-mismatch',
] as const;

export type TransportDiagnosticId = typeof TRANSPORT_DIAGNOSTIC_IDS[number];

/** `error` blocks the connection, `warning` degrades it, `info` is context only. */
export type TransportDiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * `detected` means the observed responses establish the finding; active probes
 * additionally carry an explicit pass/fail `outcome`. `suspected` means
 * the responses are consistent with the problem but do not prove it, so it is
 * shown as a possibility and never blocks release. `not-checked` means mcptest
 * could not perform the check and says why; neither is a finding against the
 * server.
 */
export type TransportDiagnosticStatus = 'detected' | 'suspected' | 'not-checked';

export type TransportDiagnosticRoute = 'direct' | 'proxy';

export type TransportDiagnosticStack = 'TypeScript SDK' | 'Python SDK' | 'Cloudflare Workers';

export interface TransportDiagnosticCodeHint {
  stack: TransportDiagnosticStack;
  code: string;
}

export interface TransportDiagnosticRemediation {
  summary: string;
  hints: readonly TransportDiagnosticCodeHint[];
}

/** One observed request. Header values are retained only for non-credential headers. */
export interface TransportDiagnosticEvidence {
  route: TransportDiagnosticRoute;
  /** Target endpoint (never the proxy envelope URL). */
  endpoint: string;
  method: string;
  mcpMethod?: string;
  transportType?: 'streamable-http' | 'legacy-sse';
  status?: number;
  responseSource?: 'proxy' | 'target';
  /** Non-credential response headers as read by the browser. */
  headersSeen?: Record<string, string>;
  /** Non-credential request headers that were sent. */
  headersSent?: Record<string, string>;
  /** Plain-language note about what this request shows. */
  observation: string;
}

export interface TransportDiagnostic {
  id: TransportDiagnosticId;
  /** Explicit active-probe verdict; absent on passive diagnostics. */
  outcome?: 'pass' | 'fail' | 'warning';
  status: TransportDiagnosticStatus;
  severity: TransportDiagnosticSeverity;
  title: string;
  explanation: string;
  evidence: TransportDiagnosticEvidence[];
  remediation: TransportDiagnosticRemediation;
  /** Wait requested by the target, for rate-limit diagnostics. */
  retryAfterSeconds?: number;
  /**
   * Absolute time (ISO 8601) the target asked clients to wait until, derived
   * when its response arrived. Absent when the wait was already honored by a
   * successful automatic retry.
   */
  retryAt?: string;
  /**
   * Set when a wait is still outstanding but its deadline lies beyond the
   * Date range, so `retryAt` cannot carry it. Retry stays unavailable.
   */
  retryAtUnrepresentable?: true;
  /** What a `suspected` diagnostic could not confirm. */
  unconfirmedReason?: string;
  /** Why a `not-checked` diagnostic could not be evaluated. */
  notCheckedReason?: string;
}
