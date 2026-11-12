/**
 * Connection progress, driven by the events the connection attempt actually
 * produces (requests settling, the OAuth challenge, the negotiated session,
 * each list request). Nothing here advances on a timer: a stage only moves
 * when the attempt reports something, so a slow or failing step stays visible.
 */
import type { DiscoveryState, DiscoveryStatus } from '../hooks/useToolsAndResources';

export type ConnectionStageId = 'reach' | 'negotiate' | 'authorize' | 'list';
export type ConnectionStageStatus = 'pending' | 'active' | 'done' | 'skipped' | 'waiting' | 'failed';

export interface ConnectionStage {
  id: ConnectionStageId;
  label: string;
  status: ConnectionStageStatus;
  detail?: string;
}

type HandshakeStageId = Exclude<ConnectionStageId, 'list'>;
type HandshakeStage = { status: ConnectionStageStatus; detail?: string };

export interface ConnectionProgress {
  phase: 'idle' | 'connecting' | 'waiting' | 'connected' | 'failed';
  /** Credentials were sent with the attempt (a saved OAuth token or an entered key). */
  credentialed: boolean;
  stages: Record<HandshakeStageId, HandshakeStage>;
}

export type ConnectionProgressEvent =
  | { type: 'start'; credentialed?: boolean }
  /** One HTTP request settled: a readable status, or a fetch failure without one. */
  | { type: 'response'; status?: number; ok?: boolean; mcpMethod?: string; route?: 'direct' | 'proxy' }
  | { type: 'proxy-fallback' }
  | { type: 'auth-challenge'; status: number }
  /** Authorization needs the user (provider redirect, client registration, sign-in). */
  | { type: 'auth-waiting'; detail: string }
  | { type: 'auth-complete' }
  | { type: 'connected'; protocolVersion?: string | null; transport?: string | null }
  | { type: 'failed'; detail?: string }
  | { type: 'aborted' }
  | { type: 'reset' };

export const STAGE_LABELS: Record<ConnectionStageId, string> = {
  reach: 'Reach the endpoint',
  negotiate: 'Negotiate the protocol version',
  authorize: 'Authorize, if the server asks',
  list: 'List tools, resources and prompts',
};

const pending = (): ConnectionProgress['stages'] => ({
  reach: { status: 'pending' },
  negotiate: { status: 'pending' },
  authorize: { status: 'pending' },
});

export const IDLE_CONNECTION_PROGRESS: ConnectionProgress = {
  phase: 'idle',
  credentialed: false,
  stages: pending(),
};

const set = (
  state: ConnectionProgress,
  id: HandshakeStageId,
  stage: HandshakeStage,
  phase: ConnectionProgress['phase'] = state.phase
): ConnectionProgress => ({ ...state, phase, stages: { ...state.stages, [id]: stage } });

const NEGOTIATION_METHODS = new Set(['initialize', 'server/discover']);

/** The handshake stage a failure belongs to: the one still in progress. */
const currentStage = (state: ConnectionProgress): HandshakeStageId => {
  if (state.stages.authorize.status === 'active' || state.stages.authorize.status === 'waiting') return 'authorize';
  if (state.stages.reach.status !== 'done') return 'reach';
  return 'negotiate';
};

export const reduceConnectionProgress = (
  state: ConnectionProgress,
  event: ConnectionProgressEvent
): ConnectionProgress => {
  switch (event.type) {
    case 'reset':
      return IDLE_CONNECTION_PROGRESS;
    case 'start':
      return {
        phase: 'connecting',
        credentialed: Boolean(event.credentialed),
        stages: {
          ...pending(),
          reach: { status: 'active', detail: 'Sending the first request' },
        },
      };
    case 'response': {
      if (state.phase !== 'connecting') return state;
      // A fetch that failed without a status proves nothing yet; another
      // candidate or the proxy may still get through.
      if (event.status === undefined) return state;
      let next = state;
      if (state.stages.reach.status !== 'done') {
        next = set(next, 'reach', {
          status: 'done',
          detail: `HTTP ${event.status}${event.route === 'proxy' ? ' through the mcptest proxy' : ''}`,
        });
      }
      if (next.stages.negotiate.status === 'pending') {
        next = set(next, 'negotiate', { status: 'active', detail: 'Waiting for the handshake to finish' });
      }
      if (event.ok && event.mcpMethod && NEGOTIATION_METHODS.has(event.mcpMethod)) {
        next = set(next, 'negotiate', { status: 'active', detail: `${event.mcpMethod} answered` });
      }
      return next;
    }
    case 'proxy-fallback':
      if (state.phase !== 'connecting') return state;
      return set(state, 'reach', {
        status: state.stages.reach.status === 'done' ? 'done' : 'active',
        detail: 'The browser could not read the response; retrying through the mcptest proxy',
      });
    case 'auth-challenge': {
      const reached = set(state, 'reach', { status: 'done', detail: `HTTP ${event.status} challenge` });
      return set(
        set(reached, 'negotiate', { status: 'pending' }),
        'authorize',
        { status: 'active', detail: 'Discovering the OAuth configuration' },
        'connecting'
      );
    }
    case 'auth-waiting':
      return set(state, 'authorize', { status: 'waiting', detail: event.detail }, 'waiting');
    case 'auth-complete':
      return set(
        set(state, 'authorize', { status: 'done', detail: 'Access token received' }, 'connecting'),
        'negotiate',
        { status: 'active', detail: 'Retrying the handshake with the token' }
      );
    case 'connected': {
      const version = event.protocolVersion ? `MCP ${event.protocolVersion}` : 'Session established';
      const transport = event.transport === 'streamable-http'
        ? ' over Streamable HTTP'
        : event.transport === 'legacy-sse' ? ' over legacy SSE' : '';
      const authorize = state.stages.authorize.status === 'done'
        ? state.stages.authorize
        : state.credentialed
          ? { status: 'done' as const, detail: 'Credentials accepted' }
          : { status: 'skipped' as const, detail: 'Not required' };
      return {
        phase: 'connected',
        credentialed: state.credentialed,
        stages: {
          reach: state.stages.reach.status === 'done' ? state.stages.reach : { status: 'done', detail: 'Reached' },
          negotiate: { status: 'done', detail: `${version}${transport}` },
          authorize,
        },
      };
    }
    case 'failed': {
      if (state.phase === 'idle') return state;
      const id = currentStage(state);
      return set(state, id, {
        status: 'failed',
        detail: event.detail || (id === 'reach' ? 'No readable response' : undefined),
      }, 'failed');
    }
    case 'aborted': {
      if (state.phase === 'idle') return state;
      const id = currentStage(state);
      return set(state, id, { status: 'failed', detail: 'Cancelled' }, 'failed');
    }
    default:
      return state;
  }
};

const LIST_SECTIONS = ['tools', 'resources', 'resourceTemplates', 'prompts'] as const;

export type CapabilitySection = 'tools' | 'resources' | 'prompts';
/**
 * What the list requests established about one capability. Only `complete`
 * (or a capability the server never advertised) supports "the server lists
 * none"; `failed` and `partial` say nothing about what the server offers.
 */
export type ListOutcome = 'pending' | 'complete' | 'partial' | 'failed' | 'not-offered';

const SECTION_REQUESTS: Record<CapabilitySection, readonly (keyof DiscoveryStatus)[]> = {
  tools: ['tools'],
  resources: ['resources', 'resourceTemplates'],
  prompts: ['prompts'],
};

export const listOutcome = (
  discovery: DiscoveryStatus | undefined,
  section: CapabilitySection,
  offered?: boolean,
): ListOutcome => {
  // Older callers without discovery state treat a connected panel's lists as loaded.
  if (!discovery) return 'complete';
  const states = SECTION_REQUESTS[section].map((request) => discovery[request]);
  if (states.some((state) => state === 'idle' || state === 'loading')) return 'pending';
  // A capability the server never advertised is absent whatever its list request did.
  if (offered === false) return 'not-offered';
  if (states.includes('failed')) return 'failed';
  if (states.includes('partial')) return 'partial';
  return 'complete';
};

const SECTION_NOUNS: Record<CapabilitySection, string> = { tools: 'tools', resources: 'resources', prompts: 'prompts' };

/** The list stage from the real list requests; `undefined` until connected. */
export const listStageFromDiscovery = (
  discovery: DiscoveryStatus,
  counts?: { tools: number; resources: number; prompts: number },
  offered?: Partial<Record<CapabilitySection, boolean>>,
): Pick<ConnectionStage, 'status' | 'detail'> => {
  const states: DiscoveryState[] = LIST_SECTIONS.map((section) => discovery[section]);
  const loading = states.filter((state) => state === 'idle' || state === 'loading').length;
  if (loading > 0) {
    return { status: 'active', detail: `${LIST_SECTIONS.length - loading} of ${LIST_SECTIONS.length} lists received` };
  }
  const summary = counts
    ? `${counts.tools} ${counts.tools === 1 ? 'tool' : 'tools'}, ${counts.resources} ${counts.resources === 1 ? 'resource' : 'resources'}, ${counts.prompts} ${counts.prompts === 1 ? 'prompt' : 'prompts'}`
    : 'Lists received';
  const sections = Object.keys(SECTION_REQUESTS) as CapabilitySection[];
  const failed = sections.filter((section) => listOutcome(discovery, section, offered?.[section]) === 'failed');
  const partial = sections.filter((section) => listOutcome(discovery, section, offered?.[section]) === 'partial');
  const qualifiers = [
    ...(failed.length ? [`${failed.map((section) => SECTION_NOUNS[section]).join(' and ')} list failed`] : []),
    ...(partial.length ? [`${partial.map((section) => SECTION_NOUNS[section]).join(' and ')} list incomplete`] : []),
  ];
  return { status: 'done', detail: qualifiers.length ? `${summary} (${qualifiers.join('; ')})` : summary };
};

/** All four stages for display. The list stage starts once a session exists. */
export const connectionStages = (
  progress: ConnectionProgress,
  list?: Pick<ConnectionStage, 'status' | 'detail'>
): ConnectionStage[] => [
  ...(['reach', 'negotiate', 'authorize'] as const).map((id) => ({
    id,
    label: STAGE_LABELS[id],
    ...progress.stages[id],
  })),
  {
    id: 'list',
    label: STAGE_LABELS.list,
    ...(progress.phase === 'connected' && list ? list : { status: 'pending' as const }),
  },
];

const STATUS_WORDS: Record<ConnectionStageStatus, string> = {
  pending: 'not started',
  active: 'in progress',
  done: 'done',
  skipped: 'not needed',
  waiting: 'needs your action',
  failed: 'failed',
};

export const stageStatusWord = (status: ConnectionStageStatus): string => STATUS_WORDS[status];

/**
 * One sentence for assistive technology: the stage that changed last. Done
 * and failed stages are announced; pending ones are not.
 */
export const describeConnectionProgress = (stages: readonly ConnectionStage[]): string => {
  const failed = stages.find(({ status }) => status === 'failed');
  if (failed) return `${failed.label} failed${failed.detail ? `: ${failed.detail}` : ''}.`;
  const waiting = stages.find(({ status }) => status === 'waiting');
  if (waiting) return `${waiting.label}: ${waiting.detail || 'needs your action'}.`;
  const active = stages.find(({ status }) => status === 'active');
  if (active) return `${active.label}${active.detail ? `: ${active.detail}` : ''}.`;
  if (stages.every(({ status }) => status === 'done' || status === 'skipped')) {
    return 'Connected. Tools, resources and prompts are listed.';
  }
  return '';
};
