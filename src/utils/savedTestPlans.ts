import type { DeterministicCaseResult, DeterministicTestPlanV1 } from '../types/deterministicTests';
import { containsRedaction, redactArguments, redactHistoryText } from './callHistory';
import {
  inferToolSafety,
  redactDeterministicAssertion,
  runDeterministicPlan,
  validateDeterministicTestPlan,
  type DeterministicToolClient,
  type DiscoveredTool,
} from './deterministicTests';
import { endpointIdentity } from './endpointIdentity';

export const SAVED_TEST_PLANS_STORAGE_KEY = 'mcptestSavedTestPlansV1';
export const SAVED_TEST_PLANS_PER_SERVER = 10;
export const SAVED_TEST_PLANS_SERVER_LIMIT = 20;
export const SAVED_TEST_PLAN_CASE_LIMIT = 200;
/** Serialized size of one saved plan; larger plans can still be exported. */
export const SAVED_TEST_PLAN_BYTE_LIMIT = 100_000;
export const SAVED_TEST_PLAN_NAME_LIMIT = 120;

export type SavedPlanRunSource = 'playground' | 'report';

/** Counts only: this is all a report ever learns about a plan run. */
export interface SavedPlanRunCounts {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  cancelled: number;
  ranAt: string;
  source: SavedPlanRunSource;
}

export interface SavedTestPlanV1 {
  id: string;
  name: string;
  savedAt: string;
  updatedAt: string;
  plan: DeterministicTestPlanV1;
  lastRun?: SavedPlanRunCounts;
}

interface SavedTestPlanStore {
  version: 1;
  servers: Array<{ endpoint: string; plans: SavedTestPlanV1[] }>;
}

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const record = (value: unknown): Record<string, unknown> | undefined => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
);

const cleanName = (value: string, fallback: string): string => {
  const name = redactHistoryText(value).replace(/\s+/g, ' ').trim().slice(0, SAVED_TEST_PLAN_NAME_LIMIT);
  return name || fallback;
};

/**
 * Applies call-history argument redaction to every case. A case whose arguments
 * now hold a redaction placeholder is unselected so it is never run as is.
 */
export const redactTestPlanForStorage = (plan: DeterministicTestPlanV1): DeterministicTestPlanV1 => {
  validateDeterministicTestPlan(plan);
  const endpoint = endpointIdentity(plan.serverUrl);
  const redacted: DeterministicTestPlanV1 = {
    ...plan,
    name: cleanName(plan.name, 'Saved test plan'),
    serverUrl: endpoint,
    tools: plan.tools.map((tool) => ({
      ...tool,
      cases: tool.cases.map((testCase) => {
        const args = redactArguments(testCase.arguments);
        return {
          ...testCase,
          name: cleanName(testCase.name, testCase.id),
          arguments: args,
          assertions: testCase.assertions.map(redactDeterministicAssertion),
          selected: testCase.selected && !containsRedaction(args),
        };
      }),
    })),
  };
  validateDeterministicTestPlan(redacted);
  return redacted;
};

const caseCount = (plan: DeterministicTestPlanV1): number => plan.tools.reduce((total, tool) => total + tool.cases.length, 0);

const checkBounds = (plan: DeterministicTestPlanV1): void => {
  if (caseCount(plan) > SAVED_TEST_PLAN_CASE_LIMIT) {
    throw new Error(`Plans with more than ${SAVED_TEST_PLAN_CASE_LIMIT} cases cannot be saved in this browser; export the plan instead.`);
  }
  if (JSON.stringify(plan).length > SAVED_TEST_PLAN_BYTE_LIMIT) {
    throw new Error(`Plans larger than ${Math.round(SAVED_TEST_PLAN_BYTE_LIMIT / 1000)} KB cannot be saved in this browser; export the plan instead.`);
  }
};

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

const readRun = (value: unknown): SavedPlanRunCounts | undefined => {
  const run = record(value);
  if (!run || !isCount(run.total) || !isCount(run.passed) || !isCount(run.failed) || !isCount(run.blocked)
    || !isCount(run.cancelled) || typeof run.ranAt !== 'string' || (run.source !== 'playground' && run.source !== 'report')) {
    return undefined;
  }
  return {
    total: run.total,
    passed: run.passed,
    failed: run.failed,
    blocked: run.blocked,
    cancelled: run.cancelled,
    ranAt: run.ranAt,
    source: run.source,
  };
};

const readPlan = (value: unknown): SavedTestPlanV1 | undefined => {
  const saved = record(value);
  if (!saved || typeof saved.id !== 'string' || typeof saved.name !== 'string'
    || typeof saved.savedAt !== 'string' || typeof saved.updatedAt !== 'string') return undefined;
  try {
    // Re-redact on read so plans written by older builds stay scrubbed.
    const plan = redactTestPlanForStorage(saved.plan as DeterministicTestPlanV1);
    const lastRun = readRun(saved.lastRun);
    return {
      id: saved.id,
      name: cleanName(saved.name, plan.name),
      savedAt: saved.savedAt,
      updatedAt: saved.updatedAt,
      plan,
      ...(lastRun ? { lastRun } : {}),
    };
  } catch {
    return undefined;
  }
};

const readStore = (storage: ReadStorage): SavedTestPlanStore => {
  try {
    const parsed = record(JSON.parse(storage.getItem(SAVED_TEST_PLANS_STORAGE_KEY) || 'null'));
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.servers)) return { version: 1, servers: [] };
    return {
      version: 1,
      servers: parsed.servers.slice(0, SAVED_TEST_PLANS_SERVER_LIMIT).flatMap((server) => {
        const value = record(server);
        if (typeof value?.endpoint !== 'string' || !Array.isArray(value.plans)) return [];
        const plans = value.plans.slice(0, SAVED_TEST_PLANS_PER_SERVER).flatMap((plan) => readPlan(plan) ?? []);
        return [{ endpoint: value.endpoint, plans }];
      }),
    };
  } catch {
    return { version: 1, servers: [] };
  }
};

const writeStore = (store: SavedTestPlanStore, storage: WriteStorage): void => {
  const servers = store.servers.filter((server) => server.plans.length > 0).slice(0, SAVED_TEST_PLANS_SERVER_LIMIT);
  try {
    if (servers.length === 0) storage.removeItem(SAVED_TEST_PLANS_STORAGE_KEY);
    else storage.setItem(SAVED_TEST_PLANS_STORAGE_KEY, JSON.stringify({ version: 1, servers }));
  } catch {
    throw new Error('The plan could not be saved. Browser storage may be full or unavailable.');
  }
};

const byUpdatedDesc = (a: SavedTestPlanV1, b: SavedTestPlanV1): number => b.updatedAt.localeCompare(a.updatedAt);

const updateServer = (
  serverUrl: string,
  storage: WriteStorage,
  change: (plans: SavedTestPlanV1[]) => SavedTestPlanV1[],
): SavedTestPlanV1[] => {
  const identity = endpointIdentity(serverUrl);
  const store = readStore(storage);
  const existing = store.servers.find((server) => server.endpoint === identity)?.plans ?? [];
  const plans = change(existing).sort(byUpdatedDesc).slice(0, SAVED_TEST_PLANS_PER_SERVER);
  writeStore({
    version: 1,
    servers: [
      { endpoint: identity, plans },
      ...store.servers.filter((server) => server.endpoint !== identity),
    ],
  }, storage);
  return plans;
};

/** Most recently updated first. */
export const loadSavedTestPlans = (serverUrl: string, storage?: ReadStorage): SavedTestPlanV1[] => {
  try {
    const source = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (!source) return [];
    const identity = endpointIdentity(serverUrl);
    return [...(readStore(source).servers.find((server) => server.endpoint === identity)?.plans ?? [])].sort(byUpdatedDesc);
  } catch {
    return [];
  }
};

const planId = (now: string): string => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `plan-${crypto.randomUUID()}`
    : `plan-${Date.parse(now)}-${Math.random().toString(36).slice(2)}`
);

/**
 * Saves a redacted copy of `plan` for its endpoint, replacing the saved plan
 * with the same id. The oldest plan beyond the per-endpoint limit is dropped.
 */
export const saveTestPlan = (
  serverUrl: string,
  plan: DeterministicTestPlanV1,
  options: { id?: string; name?: string; now?: string } = {},
  storage: WriteStorage = localStorage,
): SavedTestPlanV1 => {
  const redacted = redactTestPlanForStorage(plan);
  checkBounds(redacted);
  const now = options.now ?? new Date().toISOString();
  let saved: SavedTestPlanV1 | undefined;
  updateServer(serverUrl, storage, (plans) => {
    const previous = options.id ? plans.find((item) => item.id === options.id) : undefined;
    const name = cleanName(options.name ?? previous?.name ?? redacted.name, redacted.name);
    saved = {
      id: previous?.id ?? planId(now),
      name,
      savedAt: previous?.savedAt ?? now,
      updatedAt: now,
      // A changed plan has no run yet; its old counts described other cases.
      plan: { ...redacted, name },
    };
    return [saved, ...plans.filter((item) => item.id !== saved!.id)];
  });
  return saved!;
};

export const renameSavedTestPlan = (
  serverUrl: string,
  id: string,
  name: string,
  storage: WriteStorage = localStorage,
): SavedTestPlanV1[] => updateServer(serverUrl, storage, (plans) => plans.map((item) => (
  item.id === id ? { ...item, name: cleanName(name, item.name), plan: { ...item.plan, name: cleanName(name, item.plan.name) } } : item
)));

export const deleteSavedTestPlan = (
  serverUrl: string,
  id: string,
  storage: WriteStorage = localStorage,
): SavedTestPlanV1[] => updateServer(serverUrl, storage, (plans) => plans.filter((item) => item.id !== id));

export const countPlanResults = (
  results: readonly Pick<DeterministicCaseResult, 'status'>[],
  source: SavedPlanRunSource,
  ranAt = new Date().toISOString(),
): SavedPlanRunCounts => ({
  total: results.length,
  passed: results.filter((result) => result.status === 'passed').length,
  failed: results.filter((result) => result.status === 'failed').length,
  blocked: results.filter((result) => result.status === 'blocked').length,
  cancelled: results.filter((result) => result.status === 'cancelled').length,
  ranAt,
  source,
});

export const formatRunCounts = (run: SavedPlanRunCounts): string => [
  `${run.passed} passed`,
  `${run.failed} failed`,
  ...(run.blocked > 0 ? [`${run.blocked} blocked`] : []),
  ...(run.cancelled > 0 ? [`${run.cancelled} cancelled`] : []),
].join(' · ');

/** Stores run counts on the saved plan; a missing plan or full storage only drops the counts. */
export const recordSavedPlanRun = (
  serverUrl: string,
  id: string,
  counts: SavedPlanRunCounts,
  storage: WriteStorage = localStorage,
): SavedTestPlanV1[] => {
  try {
    return updateServer(serverUrl, storage, (plans) => plans.map((item) => (
      item.id === id ? { ...item, lastRun: counts } : item
    )));
  } catch {
    return loadSavedTestPlans(serverUrl, storage);
  }
};

/** The newest run of any saved plan for the endpoint. */
export const latestSavedPlanRun = (serverUrl: string, storage?: ReadStorage): SavedPlanRunCounts | undefined => (
  loadSavedTestPlans(serverUrl, storage)
    .flatMap((item) => item.lastRun ?? [])
    .sort((a, b) => b.ranAt.localeCompare(a.ranAt))[0]
);

/** Tools in the plan that need explicit confirmation before their cases run. */
export const unsafePlanToolNames = (plan: DeterministicTestPlanV1, tools: readonly DiscoveredTool[] = []): string[] => {
  const runnable = new Set(runnableCaseIds(plan));
  return plan.tools.filter((tool) => tool.cases.some((testCase) => runnable.has(testCase.id))).filter((tool) => {
    const live = tools.find((item) => item.name === tool.toolName);
    const liveSafety = live ? inferToolSafety(live) : undefined;
    return tool.safety.writeCapable || tool.safety.destructive || liveSafety?.writeCapable || liveSafety?.destructive;
  }).map((tool) => tool.toolName);
};

/** Selected cases whose arguments hold no redaction placeholder. */
export const runnableCaseIds = (plan: DeterministicTestPlanV1): string[] => plan.tools.flatMap((tool) => (
  tool.cases.filter((testCase) => testCase.selected && !containsRedaction(testCase.arguments)).map((testCase) => testCase.id)
));

/**
 * Runs the runnable cases of a saved plan and records the counts. Write-capable
 * or destructive tools are blocked unless explicitly confirmed, as in the playground.
 */
export const runSavedTestPlan = async (
  client: DeterministicToolClient,
  serverUrl: string,
  saved: Pick<SavedTestPlanV1, 'id' | 'plan'>,
  tools: readonly DiscoveredTool[],
  options: {
    source: SavedPlanRunSource;
    /** Tools the person explicitly allowed to write; every other unsafe tool is blocked. */
    confirmedUnsafeToolNames?: readonly string[];
    signal?: AbortSignal;
    storage?: WriteStorage;
  },
): Promise<SavedPlanRunCounts> => {
  const results = await runDeterministicPlan(client, saved.plan, {
    caseIds: runnableCaseIds(saved.plan),
    confirmedUnsafeToolNames: options.confirmedUnsafeToolNames ?? [],
    unsafeToolNames: tools.filter((tool) => {
      const safety = inferToolSafety(tool);
      return safety.writeCapable || safety.destructive;
    }).map((tool) => tool.name),
    toolDefinitions: tools,
    signal: options.signal,
  });
  const counts = countPlanResults(results, options.source);
  const storage = options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  if (storage) recordSavedPlanRun(serverUrl, saved.id, counts, storage);
  return counts;
};
