/**
 * Tool annotation checks for the tool surface analysis: which safety hints and
 * titles are missing, which declared hints contradict the tool's own name or
 * description, and how clients are expected to treat each tool.
 *
 * Hint meanings and defaults follow the MCP schema (ToolAnnotations, revision
 * 2025-11-25, https://modelcontextprotocol.io/specification/2025-11-25/schema#toolannotations):
 * - readOnlyHint, default false: true means the tool does not modify its environment.
 * - destructiveHint, default true: the tool may perform destructive updates.
 *   Meaningful only when readOnlyHint is false.
 * - idempotentHint, default false: repeated calls with the same arguments have
 *   no additional effect. Meaningful only when readOnlyHint is false.
 * - openWorldHint, default true: the tool may interact with an open world of
 *   external entities.
 * - annotations.title, and Tool.title (BaseMetadata, since 2025-06-18):
 *   display names; clients prefer title, then annotations.title, then name.
 *
 * Client behaviour is stated only where a client's changelog says so; see
 * src/data/toolHintClientBehaviors.ts for the quoted sources.
 */
import {
  CLAUDE_CODE_RETRY_BEHAVIOR,
  CODEX_CLI_PARALLEL_BEHAVIOR,
} from '../data/toolHintClientBehaviors';
import type {
  ToolAnnotationFindingId,
  ToolAnnotationMetricsV1,
  ToolSurfaceEvidenceV1,
  ToolSurfaceFindingKind,
  ToolSurfaceSeverity,
} from '../types/toolSurfaceAnalysis';

const EVIDENCE_FIELD_CHARACTER_LIMIT = 2_000;
const GROUP_LABEL_TOOL_LIMIT = 12;

export interface AnnotationToolInput {
  displayName: string;
  name: string | null;
  description: string | null;
  raw: unknown;
}

export interface AnnotationFindingInput {
  id: ToolAnnotationFindingId;
  category: 'annotations';
  severity: ToolSurfaceSeverity;
  kind: ToolSurfaceFindingKind;
  title: string;
  summary: string;
  evidence: ToolSurfaceEvidenceV1[];
  remediation: string;
}

export interface ToolAnnotationAnalysis {
  metrics: ToolAnnotationMetricsV1;
  findings: AnnotationFindingInput[];
}

type HintName = 'readOnlyHint' | 'destructiveHint' | 'idempotentHint' | 'openWorldHint';

/** Spec defaults, applied when a hint is absent. */
export const SAFETY_HINT_DEFAULTS: Readonly<Record<HintName, boolean>> = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

const HINT_NAMES = Object.keys(SAFETY_HINT_DEFAULTS) as HintName[];

/*
 * Word lists for the hint/name mismatch check. They are deliberately
 * conservative: whole tokens only (`get_deleted_items` has the token
 * "deleted", not "delete"), and a token after a read verb (`list_delete_jobs`)
 * does not count unless it follows "and"/"or" (`get_or_create_user`).
 * "run" and "execute" are left out because read-only query tools often use them.
 */

/** Verbs that change state. */
export const HINT_WRITE_VERBS: ReadonlySet<string> = new Set([
  'add', 'append', 'approve', 'archive', 'assign', 'cancel', 'commit', 'create',
  'delete', 'deploy', 'destroy', 'disable', 'drop', 'edit', 'enqueue', 'erase',
  'grant', 'insert', 'install', 'invite', 'kill', 'merge', 'modify', 'move',
  'overwrite', 'patch', 'post', 'publish', 'purge', 'push', 'put', 'remove',
  'rename', 'replace', 'reply', 'reset', 'revoke', 'save', 'send', 'set',
  'submit', 'terminate', 'transfer', 'truncate', 'uninstall', 'update',
  'upload', 'upsert', 'wipe', 'write',
]);

/** Verbs whose effect is destructive or hard to reverse; a subset of the write verbs. */
export const HINT_DESTRUCTIVE_VERBS: ReadonlySet<string> = new Set([
  'delete', 'destroy', 'drop', 'erase', 'kill', 'overwrite', 'purge', 'remove',
  'reset', 'revoke', 'terminate', 'truncate', 'uninstall', 'wipe',
]);

/** Verbs whose repeated call usually repeats the effect. */
export const HINT_NON_IDEMPOTENT_VERBS: ReadonlySet<string> = new Set([
  'append', 'create', 'enqueue', 'insert', 'post', 'reply', 'send', 'submit',
]);

/**
 * Words that are as often nouns as verbs ("blog_post", "drop_zone"). They count
 * only as the first or second token of a name that has no read verb, or as the
 * imperative first word of a description.
 */
const NOUN_LIKE_VERBS: ReadonlySet<string> = new Set([
  'archive', 'commit', 'drop', 'merge', 'move', 'patch', 'post', 'push', 'put',
  'reply', 'reset', 'save', 'set', 'transfer', 'update',
]);

/** Read verbs; a write verb after one of these in a name is treated as its object. */
export const HINT_READ_VERBS: ReadonlySet<string> = new Set([
  'check', 'count', 'describe', 'diff', 'estimate', 'explain', 'fetch', 'find',
  'get', 'inspect', 'list', 'lookup', 'preview', 'query', 'read', 'search',
  'show', 'validate', 'view',
]);

/** Input names that make a creating or sending call safe to repeat, as words. */
const IDEMPOTENCY_KEY_WORDS: readonly (readonly string[])[] = [
  ['client', 'request', 'id'], ['client', 'token'], ['dedupe', 'key'], ['dedup', 'id'],
  ['deduplication', 'id'], ['deduplication', 'key'], ['idempotency', 'key'], ['request', 'id'],
];

const capitalize = (word: string): string => `${word[0].toUpperCase()}${word.slice(1)}`;

/** camelCase, PascalCase, snake_case, kebab-case and joined spellings of each name. */
const IDEMPOTENCY_KEY_PROPERTIES: readonly string[] = [...new Set(IDEMPOTENCY_KEY_WORDS.flatMap((words) => [
  words[0] + words.slice(1).map(capitalize).join(''),
  words.map(capitalize).join(''),
  words.join('_'),
  words.join('-'),
  words.join(''),
  capitalize(words.join('-')).replace(/-(\w)/g, (_, letter: string) => `-${letter.toUpperCase()}`),
]))];

/** Verbs that are often idempotent when repeated with the same arguments. */
const OFTEN_IDEMPOTENT_VERBS = new Set(['delete', 'put', 'remove', 'replace', 'set', 'update', 'upsert']);

const DESCRIPTION_LEAD_WORDS = new Set(['this', 'tool', 'will', 'it', 'the', 'endpoint', 'function']);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const boundedLabel = (value: string): string => (
  value.length <= EVIDENCE_FIELD_CHARACTER_LIMIT ? value : `${value.slice(0, EVIDENCE_FIELD_CHARACTER_LIMIT)}…`
);

const evidence = (tool: string, path: string, detail: string): ToolSurfaceEvidenceV1 => ({
  tool: boundedLabel(tool),
  path: boundedLabel(path),
  detail: boundedLabel(detail),
});

const wordTokens = (value: string): string[] => (
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
);

/** Base verb for a description's first word: "Deletes" → delete, "Modifies" → modify. */
const descriptionVerb = (token: string): string | null => {
  if (HINT_WRITE_VERBS.has(token) || HINT_READ_VERBS.has(token)) return token;
  const candidates = [
    token.endsWith('ies') ? `${token.slice(0, -3)}y` : null,
    token.endsWith('es') ? token.slice(0, -2) : null,
    token.endsWith('s') ? token.slice(0, -1) : null,
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    // "Posts", "Sets", "Updates for…" read as nouns as often as verbs.
    if (NOUN_LIKE_VERBS.has(candidate)) continue;
    if (HINT_WRITE_VERBS.has(candidate) || HINT_READ_VERBS.has(candidate)) return candidate;
  }
  return null;
};

interface VerbSignal {
  verb: string;
  source: 'name' | 'description';
  /** The word as written, for evidence. */
  word: string;
}

/** Write verbs in a tokenized name, with the conservative position rules above. */
const nameVerbs = (name: string): VerbSignal[] => {
  const tokens = wordTokens(name);
  const hasReadVerb = tokens.some((token) => HINT_READ_VERBS.has(token));
  const signals: VerbSignal[] = [];
  let readBefore = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (HINT_READ_VERBS.has(token)) readBefore = true;
    if (!HINT_WRITE_VERBS.has(token)) continue;
    const afterConjunction = tokens[index - 1] === 'and' || tokens[index - 1] === 'or';
    if (readBefore && !afterConjunction) continue;
    if (NOUN_LIKE_VERBS.has(token) && !afterConjunction && (hasReadVerb || index > 1)) continue;
    signals.push({ verb: token, source: 'name', word: token });
  }
  return signals;
};

/** The leading verb of a description ("Deletes a file…"), skipping "This tool…". */
const descriptionLeadVerb = (description: string): VerbSignal | null => {
  const tokens = wordTokens(description);
  let index = 0;
  while (index < tokens.length && index < 3 && DESCRIPTION_LEAD_WORDS.has(tokens[index])) index += 1;
  const token = tokens[index];
  if (!token) return null;
  const verb = descriptionVerb(token);
  if (!verb || !HINT_WRITE_VERBS.has(verb)) return null;
  const word = description.match(new RegExp(`\\b${token}\\b`, 'i'))?.[0] || token;
  return { verb, source: 'description', word };
};

interface AnnotatedTool {
  input: AnnotationToolInput;
  name: string;
  annotations: Record<string, unknown> | null;
  hints: Record<HintName, boolean | null>;
  annotationTitle: string | null;
  title: string | null;
  writeVerbs: VerbSignal[];
  readLike: string | null;
}

/**
 * True when the input declares an idempotency key under a known spelling.
 * Exact lookups keep the result independent of property order and size.
 */
const declaresIdempotencyKey = (raw: Record<string, unknown>): boolean => {
  const schema = raw.inputSchema;
  if (!isRecord(schema) || !isRecord(schema.properties)) return false;
  const properties = schema.properties;
  return IDEMPOTENCY_KEY_PROPERTIES.some((name) => Object.prototype.hasOwnProperty.call(properties, name));
};

const nonEmptyString = (value: unknown): string | null => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);

const annotate = (input: AnnotationToolInput): AnnotatedTool | null => {
  if (!input.name || !isRecord(input.raw)) return null;
  const annotations = isRecord(input.raw.annotations) ? input.raw.annotations : null;
  const hints = Object.fromEntries(HINT_NAMES.map((hint) => [
    hint,
    typeof annotations?.[hint] === 'boolean' ? annotations[hint] as boolean : null,
  ])) as Record<HintName, boolean | null>;
  const fromName = nameVerbs(input.name);
  const nameTokens = wordTokens(input.name);
  const nameRead = nameTokens.find((token) => HINT_READ_VERBS.has(token)) || null;
  // A description only adds a signal when the name has no read verb of its own.
  const fromDescription = !nameRead && input.description ? descriptionLeadVerb(input.description) : null;
  const writeVerbs = [...fromName];
  if (fromDescription && !writeVerbs.some((signal) => signal.verb === fromDescription.verb)) {
    writeVerbs.push(fromDescription);
  }
  return {
    input,
    name: input.name,
    annotations,
    hints,
    annotationTitle: nonEmptyString(annotations?.title),
    title: nonEmptyString(input.raw.title),
    writeVerbs,
    readLike: fromName.length === 0 && nameRead ? nameRead : null,
  };
};

const quoted = (value: string): string => JSON.stringify(value);

const verbEvidence = (signal: VerbSignal, tool: AnnotatedTool): string => (
  signal.source === 'name'
    ? `the name ${quoted(tool.name)} contains the token "${signal.word}"`
    : `the description begins with "${signal.word}"`
);

const missingHintReason = (tool: AnnotatedTool, hint: HintName): string => {
  const destructive = tool.writeVerbs.find((signal) => HINT_DESTRUCTIVE_VERBS.has(signal.verb));
  const additive = tool.writeVerbs.find((signal) => !HINT_DESTRUCTIVE_VERBS.has(signal.verb));
  switch (hint) {
    case 'readOnlyHint':
      if (tool.readLike) {
        return `readOnlyHint (default false: clients treat the tool as able to modify its environment; the name starts with the read verb "${tool.readLike}", so if it only reads, the default is wrong)`;
      }
      if (tool.writeVerbs.length > 0) {
        return `readOnlyHint (default false: clients treat the tool as able to modify its environment, which matches ${verbEvidence(tool.writeVerbs[0], tool)}; declare it explicitly)`;
      }
      return 'readOnlyHint (default false: clients treat the tool as able to modify its environment, which is wrong if it only reads)';
    case 'destructiveHint':
      if (destructive) {
        return `destructiveHint (default true: clients assume updates may be destructive, which matches ${verbEvidence(destructive, tool)}; declare it explicitly)`;
      }
      if (additive) {
        return `destructiveHint (default true: clients assume updates may be destructive; ${verbEvidence(additive, tool)}, which suggests an additive update, so the default may be wrong)`;
      }
      return 'destructiveHint (default true: clients assume updates may be destructive, which is wrong if the tool only adds data)';
    case 'idempotentHint': {
      const repeatable = tool.writeVerbs.find((signal) => OFTEN_IDEMPOTENT_VERBS.has(signal.verb));
      if (repeatable) {
        return `idempotentHint (default false: clients assume a repeated call has additional effects; ${verbEvidence(repeatable, tool)}, and such operations are often idempotent, so the default may be wrong)`;
      }
      return 'idempotentHint (default false: clients assume a repeated call has additional effects, which is wrong if repeating it with the same arguments changes nothing)';
    }
    case 'openWorldHint':
      return 'openWorldHint (default true: clients assume the tool reaches external entities such as the web or third-party services, which is wrong if it only touches a closed domain such as its own data store)';
  }
};

const groupLabel = (names: readonly string[]): string => {
  const retained = names.slice(0, GROUP_LABEL_TOOL_LIMIT).join(', ');
  return names.length <= GROUP_LABEL_TOOL_LIMIT
    ? retained
    : `${retained}, … (${names.length - GROUP_LABEL_TOOL_LIMIT} more)`;
};

type Treatment = 'read-only' | 'idempotent' | 'neither';

const treatmentOf = (tool: AnnotatedTool): Treatment => {
  if (tool.hints.readOnlyHint === true) return 'read-only';
  if (tool.hints.idempotentHint === true) return 'idempotent';
  return 'neither';
};

/*
 * Client lines quote only what the changelogs establish:
 * - Claude Code 2.1.307: only read-only or idempotent HTTP MCP tool calls are
 *   retried when the connection closes mid-call (CLAUDE_CODE_RETRY_BEHAVIOR).
 * - Codex CLI 0.134.0: read-only MCP tools that advertise readOnlyHint run
 *   concurrently (CODEX_CLI_PARALLEL_BEHAVIOR).
 * Everything else is the specification's meaning of the hints.
 */
const treatmentDetail = (treatment: Treatment, destructive: boolean, openWorld: boolean): string => {
  const claude = `${CLAUDE_CODE_RETRY_BEHAVIOR.clientName} ${CLAUDE_CODE_RETRY_BEHAVIOR.sinceVersion}+`;
  const codex = `${CODEX_CLI_PARALLEL_BEHAVIOR.clientName} ${CODEX_CLI_PARALLEL_BEHAVIOR.sinceVersion}+`;
  const world = openWorld
    ? 'it may reach external entities (openWorldHint true or absent)'
    : 'it works in a closed domain (openWorldHint false)';
  switch (treatment) {
    case 'read-only':
      return `May be retried after a dropped connection and may run in parallel with other read-only calls: readOnlyHint is true, so ${claude} can retry the call if the HTTP connection closes mid-call, and ${codex} can run it concurrently with other read-only tools. Spec: it does not modify its environment; ${world}.`;
    case 'idempotent':
      return `May be retried after a dropped connection, but does not run in parallel: idempotentHint is true, so ${claude} can retry the call if the HTTP connection closes mid-call; it is not read-only, so ${codex} does not run it concurrently. Spec: it may modify its environment${destructive ? ', possibly destructively' : ', additively only'}; repeating it with the same arguments has no additional effect; ${world}.`;
    case 'neither':
      return `Neither retried nor run in parallel: with neither readOnlyHint nor idempotentHint set to true, ${claude} does not retry the call after a dropped connection, and ${codex} does not run it concurrently. Spec: it may modify its environment${destructive ? ', possibly destructively' : ', additively only'}; repeated calls may have additional effects; ${world}.`;
  }
};

/** Runs every annotation check over the analyzed tools. */
export const analyzeToolAnnotations = (inputs: readonly AnnotationToolInput[]): ToolAnnotationAnalysis => {
  const tools = inputs
    .map(annotate)
    .filter((tool): tool is AnnotatedTool => tool !== null);
  const findings: AnnotationFindingInput[] = [];
  const count = (predicate: (tool: AnnotatedTool) => boolean): number => tools.filter(predicate).length;

  const missingHintEvidence: ToolSurfaceEvidenceV1[] = [];
  let missingHintTotal = 0;
  const missingTitleEvidence: ToolSurfaceEvidenceV1[] = [];
  const mismatchEvidence: ToolSurfaceEvidenceV1[] = [];
  const mismatchTools = new Set<string>();

  for (const tool of tools) {
    // destructiveHint and idempotentHint are meaningful only when readOnlyHint is false.
    const relevantHints = tool.hints.readOnlyHint === true
      ? (['openWorldHint'] as HintName[])
      : HINT_NAMES;
    const missing = relevantHints.filter((hint) => tool.hints[hint] === null);
    if (missing.length > 0) {
      missingHintTotal += missing.length;
      // A tool that reads like a lookup needs readOnlyHint: true, after which
      // destructiveHint and idempotentHint no longer apply.
      const collapse = Boolean(tool.readLike) && tool.hints.readOnlyHint === null;
      const reasons = missing
        .filter((hint) => !collapse || (hint !== 'destructiveHint' && hint !== 'idempotentHint'))
        .map((hint) => missingHintReason(tool, hint));
      const collapsed = missing.filter((hint) => collapse && (hint === 'destructiveHint' || hint === 'idempotentHint'));
      if (collapsed.length > 0) {
        reasons.push(`${collapsed.map((hint) => `${hint} (default ${SAFETY_HINT_DEFAULTS[hint]})`).join(' and ')}, which only apply when readOnlyHint is false, so are not needed once readOnlyHint: true is declared`);
      }
      missingHintEvidence.push(evidence(
        tool.input.displayName,
        '$.annotations',
        `Missing ${reasons.join('; ')}.`
      ));
    }

    if (!tool.annotationTitle) {
      missingTitleEvidence.push(evidence(
        tool.input.displayName,
        tool.title ? '$.annotations.title' : '$.annotations.title|$.title',
        tool.title
          ? `annotations.title is missing; the top-level title ${quoted(tool.title)} is set, so clients that follow the spec display it, but listings that read annotations.title fall back to the name.`
          : `Neither annotations.title nor title is set, so clients display the raw name ${quoted(tool.name)}.`
      ));
    }

    const recordMismatch = (path: string, detail: string): void => {
      mismatchTools.add(tool.name);
      mismatchEvidence.push(evidence(tool.input.displayName, path, detail));
    };
    if (tool.hints.readOnlyHint === true) {
      const write = tool.writeVerbs[0];
      if (write) {
        recordMismatch(
          '$.annotations.readOnlyHint',
          `readOnlyHint is true, but ${verbEvidence(write, tool)}, which indicates a write.`
        );
      }
    }
    // destructiveHint is meaningful only when readOnlyHint is false, so its
    // value on a read-only tool never contradicts anything.
    if (tool.hints.destructiveHint === false && tool.hints.readOnlyHint !== true) {
      const destructive = tool.writeVerbs.find((signal) => HINT_DESTRUCTIVE_VERBS.has(signal.verb));
      if (destructive) {
        recordMismatch(
          '$.annotations.destructiveHint',
          `destructiveHint is false, but ${verbEvidence(destructive, tool)}, which indicates a destructive update.`
        );
      }
    }
    if (tool.hints.idempotentHint === true && tool.hints.readOnlyHint !== true) {
      const repeated = tool.writeVerbs.find((signal) => HINT_NON_IDEMPOTENT_VERBS.has(signal.verb));
      if (repeated && !declaresIdempotencyKey(tool.input.raw as Record<string, unknown>)) {
        recordMismatch(
          '$.annotations.idempotentHint',
          `idempotentHint is true, but ${verbEvidence(repeated, tool)}, which usually repeats its effect on every call, and the input declares no idempotency key.`
        );
      }
    }
  }

  const metrics: ToolAnnotationMetricsV1 = {
    analyzedToolCount: tools.length,
    annotatedToolCount: count((tool) => tool.annotations !== null),
    readOnlyHintCount: count((tool) => tool.hints.readOnlyHint !== null),
    destructiveHintCount: count((tool) => tool.hints.destructiveHint !== null),
    idempotentHintCount: count((tool) => tool.hints.idempotentHint !== null),
    openWorldHintCount: count((tool) => tool.hints.openWorldHint !== null),
    annotationTitleCount: count((tool) => tool.annotationTitle !== null),
    titleCount: count((tool) => tool.title !== null),
    readOnlyToolCount: count((tool) => tool.hints.readOnlyHint === true),
    retryHintDeclaredCount: count((tool) => (
      tool.hints.readOnlyHint === true
      || tool.hints.idempotentHint === true
      || (tool.hints.readOnlyHint !== null && tool.hints.idempotentHint !== null)
    )),
    retryEligibleToolCount: count((tool) => tool.hints.readOnlyHint === true || tool.hints.idempotentHint === true),
    hintMismatchToolCount: mismatchTools.size,
  };

  if (tools.length === 0) return { metrics, findings };
  const total = tools.length;
  const of = (value: number): string => `${value} of ${total}`;

  findings.push({
    id: 'annotations.coverage',
    category: 'annotations',
    severity: 'info',
    kind: 'measurement',
    title: 'Tool annotation coverage',
    summary: `Of ${total} tools: readOnlyHint ${metrics.readOnlyHintCount}, destructiveHint ${metrics.destructiveHintCount}, idempotentHint ${metrics.idempotentHintCount}, openWorldHint ${metrics.openWorldHintCount}, annotations.title ${metrics.annotationTitleCount}, title ${metrics.titleCount}.`,
    evidence: [
      ...HINT_NAMES.map((hint) => evidence(
        '<surface>',
        `$.tools[*].annotations.${hint}`,
        `${of(count((tool) => tool.hints[hint] !== null))} tools declare ${hint} (spec default when absent: ${SAFETY_HINT_DEFAULTS[hint]}).`
      )),
      evidence('<surface>', '$.tools[*].annotations.title', `${of(metrics.annotationTitleCount)} tools declare annotations.title.`),
      evidence('<surface>', '$.tools[*].title', `${of(metrics.titleCount)} tools declare title.`),
    ],
    remediation: 'Declare every safety hint and a human-readable title on each tool, so clients and connector directories do not fall back to the spec defaults.',
  });

  if (missingHintEvidence.length > 0) {
    findings.push({
      id: 'annotations.missing-safety-hints',
      category: 'annotations',
      severity: 'low',
      kind: 'quality-signal',
      title: 'Tools leave safety hints to the spec defaults',
      summary: `${missingHintEvidence.length} of ${total} tools omit ${missingHintTotal} safety hints in total, so clients apply the spec defaults: not read-only, possibly destructive, not idempotent, open world.`,
      evidence: missingHintEvidence,
      remediation: 'Set readOnlyHint on every tool, and destructiveHint and idempotentHint on every tool that is not read-only, plus openWorldHint. The defaults are the most cautious reading, so a read-only lookup without readOnlyHint: true is treated as a write.',
    });
  }

  if (missingTitleEvidence.length > 0) {
    findings.push({
      id: 'annotations.missing-title',
      category: 'annotations',
      severity: 'low',
      kind: 'quality-signal',
      title: 'Tools have no display title',
      summary: `${missingTitleEvidence.length} of ${total} tools have no annotations.title; ${count((tool) => !tool.annotationTitle && !tool.title)} of them also have no top-level title.`,
      evidence: missingTitleEvidence,
      remediation: 'Give each tool a short human-readable title in annotations.title, and in the top-level title field defined since the 2025-06-18 revision.',
    });
  }

  if (mismatchEvidence.length > 0) {
    findings.push({
      id: 'annotations.hint-name-mismatch',
      category: 'annotations',
      severity: 'medium',
      kind: 'review-signal',
      title: 'Declared hints contradict the tool name or description',
      summary: `${mismatchTools.size} tools declare a hint that their own name or description contradicts. This is a review signal from a fixed word list, not proof that the hint is wrong.`,
      evidence: mismatchEvidence,
      remediation: 'Check what each listed tool really does. Correct the hint if it is wrong; if the hint is right, rename the tool or reword the description so it no longer reads like the opposite.',
    });
  }

  const groups = new Map<string, { treatment: Treatment; destructive: boolean; openWorld: boolean; names: string[] }>();
  for (const tool of tools) {
    const treatment = treatmentOf(tool);
    const destructive = treatment !== 'read-only' && (tool.hints.destructiveHint ?? SAFETY_HINT_DEFAULTS.destructiveHint);
    const openWorld = tool.hints.openWorldHint ?? SAFETY_HINT_DEFAULTS.openWorldHint;
    const key = `${treatment}:${destructive}:${openWorld}`;
    const group = groups.get(key) || { treatment, destructive, openWorld, names: [] };
    group.names.push(tool.input.displayName);
    groups.set(key, group);
  }
  const order: Record<Treatment, number> = { 'read-only': 0, idempotent: 1, neither: 2 };
  const groupEvidence = [...groups.entries()]
    .sort(([leftKey, left], [rightKey, right]) => (
      order[left.treatment] - order[right.treatment] || (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0)
    ))
    .map(([, group]) => evidence(
      groupLabel([...group.names].sort()),
      '$.annotations',
      treatmentDetail(group.treatment, group.destructive, group.openWorld)
    ));
  const readOnly = metrics.readOnlyToolCount;
  findings.push({
    id: 'annotations.client-treatment',
    category: 'annotations',
    severity: 'info',
    kind: 'measurement',
    title: 'How clients treat each tool, given its hints',
    summary: `${of(metrics.retryEligibleToolCount)} tools may be retried after a dropped connection (${CLAUDE_CODE_RETRY_BEHAVIOR.clientName}), ${of(readOnly)} may run in parallel with other read-only calls (${CODEX_CLI_PARALLEL_BEHAVIOR.clientName}), and ${of(total - metrics.retryEligibleToolCount)} get neither. Sources: ${CLAUDE_CODE_RETRY_BEHAVIOR.sourceUrl} (${CLAUDE_CODE_RETRY_BEHAVIOR.sinceVersion}) and ${CODEX_CLI_PARALLEL_BEHAVIOR.sourceUrl}.`,
    evidence: groupEvidence,
    remediation: 'Declare readOnlyHint: true on tools that only read, and idempotentHint: true on writes that are safe to repeat, so clients can retry and parallelize them. Hints are advisory: clients must not rely on them from untrusted servers.',
  });

  return { metrics, findings };
};
