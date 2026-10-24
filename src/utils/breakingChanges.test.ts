import { describe, expect, it } from 'vitest';
import {
  BREAKING_CHANGES_GUIDE_PATH,
  BREAKING_CHANGE_RULES,
  classifyBreakingChanges,
  descriptionSimilarity,
  explanationPathForRule,
  parseToolsListPayload,
  toolSurfaceFromInterfaceSnapshot,
  type BreakingChangeRule,
  type BreakingChangeSeverity,
  type ToolSurfaceSnapshot,
} from './breakingChanges';
import { createInterfaceSnapshot } from './interfaceSnapshot';

type Tool = Record<string, any>;

const baseTools = (): Tool[] => [
  {
    name: 'search',
    title: 'Search',
    description: 'Search the knowledge base for documents matching a query',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer' },
        sort: { type: 'string', enum: ['relevance', 'date'] },
        filter: { type: 'object', properties: { kind: { type: 'string' } } },
      },
      required: ['query'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        hits: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, score: { type: 'number' } }, required: ['id'] } },
        total: { type: 'integer' },
        status: { type: 'string', enum: ['ok', 'partial'] },
      },
      required: ['hits', 'total'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'fetch_document',
    description: 'Fetch one document by id',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, format: { type: 'string' } } },
  },
];

const surface = (mutate: (tools: Tool[], extra: Record<string, any>) => void = () => {}): ToolSurfaceSnapshot => {
  const tools = baseTools();
  const extra: Record<string, any> = {
    prompts: [{ name: 'summarize', arguments: [{ name: 'topic', required: true }, { name: 'tone' }] }],
    resources: [{ uri: 'docs://readme', name: 'readme' }],
    resourceTemplates: [{ uriTemplate: 'docs://{id}', name: 'doc' }],
  };
  mutate(tools, extra);
  const parsed = parseToolsListPayload({ tools, ...extra });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.snapshot;
};

const tool = (tools: Tool[], name: string) => tools.find((candidate) => candidate.name === name)!;

const classify = (mutate: (tools: Tool[], extra: Record<string, any>) => void) => (
  classifyBreakingChanges(surface(), surface(mutate))
);

interface RuleCase {
  name: string;
  mutate: (tools: Tool[], extra: Record<string, any>) => void;
  rule: BreakingChangeRule;
  severity: BreakingChangeSeverity;
  subject?: string;
}

const RULE_CASES: RuleCase[] = [
  // Breaking
  { name: 'tool removed', rule: 'tool-removed', severity: 'breaking', subject: 'fetch_document',
    mutate: (tools) => { tools.splice(1, 1); } },
  { name: 'tool renamed', rule: 'tool-renamed', severity: 'breaking', subject: 'fetch_document',
    mutate: (tools) => { tool(tools, 'fetch_document').name = 'get_document'; } },
  { name: 'new required input', rule: 'required-input-added', severity: 'breaking',
    mutate: (tools) => {
      const schema = tool(tools, 'search').inputSchema;
      schema.properties.tenant = { type: 'string' };
      schema.required.push('tenant');
    } },
  { name: 'existing input became required', rule: 'required-input-added', severity: 'breaking',
    mutate: (tools) => { tool(tools, 'search').inputSchema.required.push('limit'); } },
  { name: 'input removed while additionalProperties is false', rule: 'input-removed', severity: 'breaking',
    mutate: (tools) => { delete tool(tools, 'search').inputSchema.properties.limit; } },
  { name: 'input type narrowed', rule: 'input-type-narrowed', severity: 'breaking',
    mutate: (tools) => { tool(tools, 'search').inputSchema.properties.query.type = 'integer'; } },
  { name: 'input type changed on another tool', rule: 'input-type-narrowed', severity: 'breaking', subject: 'fetch_document',
    mutate: (tools) => {
      tool(tools, 'fetch_document').inputSchema.properties.id.type = 'integer';
    } },
  { name: 'enum value removed', rule: 'enum-value-removed', severity: 'breaking',
    mutate: (tools) => { tool(tools, 'search').inputSchema.properties.sort.enum = ['relevance']; } },
  { name: 'enum introduced on a free input', rule: 'enum-restricted', severity: 'breaking', subject: 'fetch_document',
    mutate: (tools) => { tool(tools, 'fetch_document').inputSchema.properties.format.enum = ['md', 'html']; } },
  { name: 'additionalProperties false added', rule: 'extra-inputs-rejected', severity: 'breaking', subject: 'fetch_document',
    mutate: (tools) => { tool(tools, 'fetch_document').inputSchema.additionalProperties = false; } },
  { name: 'outputSchema added to a tool that had none', rule: 'output-schema-added', severity: 'breaking', subject: 'fetch_document',
    mutate: (tools) => { tool(tools, 'fetch_document').outputSchema = { type: 'object', properties: { body: { type: 'string' } } }; } },
  { name: 'outputSchema removed', rule: 'output-schema-removed', severity: 'breaking',
    mutate: (tools) => { delete tool(tools, 'search').outputSchema; } },
  { name: 'output property removed', rule: 'output-property-removed', severity: 'breaking',
    mutate: (tools) => { delete tool(tools, 'search').outputSchema.properties.total; } },
  { name: 'nested output property removed', rule: 'output-property-removed', severity: 'breaking',
    mutate: (tools) => { delete tool(tools, 'search').outputSchema.properties.hits.items.properties.score; } },
  { name: 'output property retyped', rule: 'output-property-retyped', severity: 'breaking',
    mutate: (tools) => { tool(tools, 'search').outputSchema.properties.total.type = 'string'; } },
  { name: 'output property no longer required', rule: 'output-property-optional', severity: 'breaking',
    mutate: (tools) => { tool(tools, 'search').outputSchema.required = ['hits']; } },
  { name: 'prompt removed', rule: 'prompt-removed', severity: 'breaking', subject: 'summarize',
    mutate: (_tools, extra) => { extra.prompts = []; } },
  { name: 'prompt argument became required', rule: 'prompt-argument-required', severity: 'breaking', subject: 'summarize',
    mutate: (_tools, extra) => { extra.prompts[0].arguments[1].required = true; } },
  { name: 'resource removed', rule: 'resource-removed', severity: 'breaking', subject: 'docs://readme',
    mutate: (_tools, extra) => { extra.resources = []; } },
  { name: 'resource template removed', rule: 'resource-removed', severity: 'breaking', subject: 'docs://{id}',
    mutate: (_tools, extra) => { extra.resourceTemplates = []; } },

  // Risky
  { name: 'description changed significantly', rule: 'description-changed', severity: 'risky',
    mutate: (tools) => { tool(tools, 'search').description = 'Run an arbitrary SQL statement against the warehouse'; } },
  { name: 'description removed', rule: 'description-changed', severity: 'risky',
    mutate: (tools) => { delete tool(tools, 'search').description; } },
  { name: 'readOnlyHint true to false', rule: 'annotation-risk', severity: 'risky',
    mutate: (tools) => { tool(tools, 'search').annotations.readOnlyHint = false; } },
  { name: 'readOnlyHint dropped (defaults to false)', rule: 'annotation-risk', severity: 'risky',
    mutate: (tools) => { delete tool(tools, 'search').annotations.readOnlyHint; } },
  { name: 'destructiveHint added', rule: 'annotation-risk', severity: 'risky', subject: 'fetch_document',
    mutate: (tools) => { tool(tools, 'fetch_document').annotations = { destructiveHint: true, readOnlyHint: false }; } },
  { name: 'openWorldHint false to true', rule: 'annotation-risk', severity: 'risky',
    mutate: (tools) => { tool(tools, 'search').annotations.openWorldHint = true; } },
  { name: 'input removed while extra inputs are allowed', rule: 'input-removed-ignored', severity: 'risky', subject: 'fetch_document',
    mutate: (tools) => { delete tool(tools, 'fetch_document').inputSchema.properties.format; } },
  { name: 'input default changed', rule: 'input-default-changed', severity: 'risky',
    mutate: (tools) => { tool(tools, 'search').inputSchema.properties.limit.default = 50; } },
  { name: 'output enum value added', rule: 'output-enum-value-added', severity: 'risky',
    mutate: (tools) => { tool(tools, 'search').outputSchema.properties.status.enum.push('failed'); } },
  { name: 'prompt argument removed', rule: 'prompt-argument-removed', severity: 'risky', subject: 'summarize',
    mutate: (_tools, extra) => { extra.prompts[0].arguments.pop(); } },
  { name: 'unclassifiable input keyword', rule: 'schema-unclassified', severity: 'risky',
    mutate: (tools) => { tool(tools, 'search').inputSchema.properties.query.maxLength = 10; } },

  // Safe
  { name: 'new optional property', rule: 'optional-input-added', severity: 'safe',
    mutate: (tools) => { tool(tools, 'search').inputSchema.properties.offset = { type: 'integer' }; } },
  { name: 'new tool', rule: 'tool-added', severity: 'safe', subject: 'list_collections',
    mutate: (tools) => { tools.push({ name: 'list_collections', description: 'List every collection', inputSchema: { type: 'object' } }); } },
  { name: 'enum value added', rule: 'enum-value-added', severity: 'safe',
    mutate: (tools) => { tool(tools, 'search').inputSchema.properties.sort.enum.push('title'); } },
  { name: 'loosened type', rule: 'input-type-loosened', severity: 'safe',
    mutate: (tools) => { tool(tools, 'search').inputSchema.properties.limit.type = ['integer', 'string']; } },
  { name: 'integer widened to number', rule: 'input-type-loosened', severity: 'safe',
    mutate: (tools) => { tool(tools, 'search').inputSchema.properties.limit.type = 'number'; } },
  { name: 'enum restriction lifted', rule: 'enum-relaxed', severity: 'safe',
    mutate: (tools) => { delete tool(tools, 'search').inputSchema.properties.sort.enum; } },
  { name: 'required input made optional', rule: 'input-now-optional', severity: 'safe',
    mutate: (tools) => { tool(tools, 'search').inputSchema.required = []; } },
  { name: 'additionalProperties false dropped', rule: 'extra-inputs-accepted', severity: 'safe',
    mutate: (tools) => { delete tool(tools, 'search').inputSchema.additionalProperties; } },
  { name: 'input description changed', rule: 'input-guidance-changed', severity: 'safe',
    mutate: (tools) => { tool(tools, 'search').inputSchema.properties.query.description = 'Free-text query'; } },
  { name: 'output property added', rule: 'output-property-added', severity: 'safe',
    mutate: (tools) => { tool(tools, 'search').outputSchema.properties.cursor = { type: 'string' }; } },
  { name: 'output type narrowed', rule: 'output-type-narrowed', severity: 'safe',
    mutate: (tools) => { tool(tools, 'search').outputSchema.properties.hits.items.properties.score.type = 'integer'; } },
  { name: 'output enum value removed', rule: 'output-enum-value-removed', severity: 'safe',
    mutate: (tools) => { tool(tools, 'search').outputSchema.properties.status.enum = ['ok']; } },
  { name: 'description reworded slightly', rule: 'description-reworded', severity: 'safe',
    mutate: (tools) => { tool(tools, 'search').description = 'Search the knowledge base for all documents matching a query'; } },
  { name: 'title changed', rule: 'title-changed', severity: 'safe',
    mutate: (tools) => { tool(tools, 'search').title = 'Knowledge search'; } },
  { name: 'readOnlyHint false to true', rule: 'annotation-changed', severity: 'safe', subject: 'fetch_document',
    mutate: (tools) => { tool(tools, 'fetch_document').annotations = { readOnlyHint: true }; } },
  { name: 'prompt added', rule: 'prompt-added', severity: 'safe', subject: 'translate',
    mutate: (_tools, extra) => { extra.prompts.push({ name: 'translate' }); } },
  { name: 'optional prompt argument added', rule: 'prompt-argument-added', severity: 'safe', subject: 'summarize',
    mutate: (_tools, extra) => { extra.prompts[0].arguments.push({ name: 'length' }); } },
  { name: 'resource added', rule: 'resource-added', severity: 'safe', subject: 'docs://changelog',
    mutate: (_tools, extra) => { extra.resources.push({ uri: 'docs://changelog' }); } },
];

describe('classifyBreakingChanges rules', () => {
  it.each(RULE_CASES)('$name -> $severity ($rule)', ({ mutate, rule, severity, subject = 'search' }) => {
    const report = classify(mutate);
    const matching = report.findings.filter((item) => item.rule === rule);
    expect(matching, JSON.stringify(report.findings, null, 2)).toHaveLength(1);
    expect(matching[0].severity).toBe(severity);
    expect(matching[0].subject).toBe(subject);
    // One plain-English sentence.
    expect(matching[0].reason).toMatch(/^[A-Z"].*[.]$/);
    expect(matching[0].reason.split(/\.\s+[A-Z]/)).toHaveLength(1);
    expect(report.counts[severity]).toBeGreaterThanOrEqual(1);
  });

  it('covers every rule in the table or a dedicated test', () => {
    const covered = new Set<BreakingChangeRule>(RULE_CASES.map((item) => item.rule));
    // Exercised by the dedicated tests below.
    covered.add('input-constrained');
    covered.add('schema-unclassified');
    expect(BREAKING_CHANGE_RULES.filter((rule) => !covered.has(rule))).toEqual([]);
  });
});

describe('classifyBreakingChanges report', () => {
  it('reports no changes for identical listings', () => {
    const report = classifyBreakingChanges(surface(), surface());
    expect(report.findings).toEqual([]);
    expect(report.summary).toBe('No changes');
    expect(report.hasBreakingChanges).toBe(false);
  });

  it('summarizes counts and groups findings by tool, worst first', () => {
    const report = classify((tools) => {
      tools.splice(1, 1);
      tools.push({ name: 'list_collections', inputSchema: { type: 'object' } });
      const search = tool(tools, 'search');
      search.inputSchema.properties.offset = { type: 'integer' };
      search.annotations.readOnlyHint = false;
    });
    expect(report.summary).toBe('1 breaking, 1 risky, 2 safe');
    expect(report.hasBreakingChanges).toBe(true);
    expect(report.groups.map((group) => [group.subject, group.severity])).toEqual([
      ['fetch_document', 'breaking'],
      ['search', 'risky'],
      ['list_collections', 'safe'],
    ]);
    expect(report.groups[1].findings.map((item) => item.severity)).toEqual(['risky', 'safe']);
  });

  it('links each finding to its section of the guide', () => {
    expect(explanationPathForRule('tool-removed')).toBe(`${BREAKING_CHANGES_GUIDE_PATH}#removing-or-renaming-a-tool`);
    expect(explanationPathForRule('required-input-added')).toBe(`${BREAKING_CHANGES_GUIDE_PATH}#adding-a-required-input`);
  });

  it('does not treat an unrelated removed and added tool as a rename', () => {
    const report = classify((tools) => {
      tools.splice(1, 1);
      tools.push({ name: 'delete_document', description: 'Permanently delete a document', inputSchema: { type: 'object', properties: { key: { type: 'number' } } } });
    });
    expect(report.findings.map((item) => item.rule).sort()).toEqual(['tool-added', 'tool-removed']);
  });

  it('classifies a declared schema replacing an open additionalProperties schema as constrained', () => {
    const before = surface((tools) => {
      tool(tools, 'fetch_document').inputSchema.additionalProperties = { type: ['string', 'integer'] };
    });
    const after = surface((tools) => {
      const schema = tool(tools, 'fetch_document').inputSchema;
      schema.additionalProperties = { type: ['string', 'integer'] };
      schema.properties.page = { type: 'integer' };
    });
    expect(classifyBreakingChanges(before, after).findings.map((item) => item.rule)).toEqual(['input-constrained']);
  });

  it('skips output, annotation and title comparisons the baseline did not record', () => {
    const before = { ...surface(), outputSchemasObserved: false, annotationsObserved: false, titlesObserved: false };
    const after = surface((tools) => {
      delete tool(tools, 'search').outputSchema;
      tool(tools, 'search').annotations.readOnlyHint = false;
      tool(tools, 'search').title = 'Other';
    });
    const report = classifyBreakingChanges(before, after);
    expect(report.findings).toEqual([]);
    expect(report.limitations).toHaveLength(2);
  });

  it('does not compare prompts or resources that only one snapshot listed', () => {
    const before = surface();
    const after = surface((_tools, extra) => {
      delete extra.prompts;
      delete extra.resources;
      delete extra.resourceTemplates;
    });
    expect(classifyBreakingChanges(before, after).findings).toEqual([]);
  });

  it('flags a fingerprint-only schema difference as risky rather than guessing', () => {
    const before: ToolSurfaceSnapshot = { ...surface(), tools: [{ name: 'a', inputSchemaFingerprint: 'fnv1a-32:1:1' }] };
    const after: ToolSurfaceSnapshot = { ...surface(), tools: [{ name: 'a', inputSchemaFingerprint: 'fnv1a-32:2:1' }] };
    expect(classifyBreakingChanges(before, after).findings.map((item) => [item.rule, item.severity])).toEqual([
      ['schema-unclassified', 'risky'],
    ]);
  });

  it('compares stored playground snapshots without false enum drift from redaction', () => {
    const live = (tools: Tool[]) => createInterfaceSnapshot({ tools, resources: [], resourceTemplates: [], prompts: [] });
    const before = toolSurfaceFromInterfaceSnapshot(live(baseTools()))!;
    const unchanged = toolSurfaceFromInterfaceSnapshot(live(baseTools()))!;
    expect(classifyBreakingChanges(before, unchanged).findings).toEqual([]);
    const changedTools = baseTools();
    delete tool(changedTools, 'search').inputSchema.properties.limit;
    const changed = toolSurfaceFromInterfaceSnapshot(live(changedTools))!;
    expect(classifyBreakingChanges(before, changed).findings.map((item) => item.rule)).toEqual(['input-removed']);
  });
});

describe('parseToolsListPayload', () => {
  const tools = [{ name: 'a', inputSchema: { type: 'object' } }];

  it.each([
    ['a tools/list result', { tools }],
    ['a JSON-RPC response', { jsonrpc: '2.0', id: 1, result: { tools } }],
    ['a bare array', tools],
    ['a batch of responses', [{ jsonrpc: '2.0', id: 1, result: { tools } }, { jsonrpc: '2.0', id: 2, result: { prompts: [] } }]],
  ])('accepts %s', (_label, payload) => {
    const parsed = parseToolsListPayload(JSON.stringify(payload));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.snapshot.tools.map((item) => item.name)).toEqual(['a']);
  });

  it('records prompts only when they were listed', () => {
    const parsed = parseToolsListPayload([{ jsonrpc: '2.0', id: 1, result: { tools } }, { jsonrpc: '2.0', id: 2, result: { prompts: [] } }]);
    expect(parsed.ok && parsed.snapshot.prompts).toEqual([]);
    const toolsOnly = parseToolsListPayload({ tools });
    expect(toolsOnly.ok && toolsOnly.snapshot.prompts).toBeUndefined();
  });

  it.each([
    ['empty input', '', /Paste/],
    ['invalid JSON', '{tools', /not valid JSON/],
    ['no tools array', '{"prompts": []}', /No "tools" array/],
    ['a JSON-RPC error', '{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"nope"}}', /error response/],
  ])('rejects %s', (_label, input, message) => {
    const parsed = parseToolsListPayload(input);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(message);
  });
});

describe('descriptionSimilarity', () => {
  it('scores identical wording 1 and disjoint wording 0', () => {
    expect(descriptionSimilarity('Search documents', 'search   documents')).toBe(1);
    expect(descriptionSimilarity('Search documents', 'Delete rows')).toBe(0);
  });
});
