import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RELEASE_GATE_POLICY, getReleaseGateThresholdReasons } from '../cli/releaseGate';
import {
  assessHostCompatibility,
  getClientHostProfile,
  HOST_PROFILE_LIST,
  observedFact,
  publicServerFixture,
  unknownFact,
  type CapabilityAvailability,
} from '../compatibility';
import { CLIENT_COMPATIBILITY } from '../data/clientCompatibility';
import { TOOL_ANNOTATION_FINDING_IDS } from '../types/toolSurfaceAnalysis';
import type { EvaluationReport } from './evaluation';
import { referencePathFor, toolSurfaceReferenceId } from './referenceLinks';
import { createCompatibilityMatrix, createObservedServerFacts, createReleaseDecision } from './releaseReadiness';
import { serializePublicReportMarkdown, createPublicReport } from './reportArtifact';
import { analyzeToolSurface } from './toolSurfaceAnalysis';

type Analysis = ReturnType<typeof analyzeToolSurface>;

const schema = { type: 'object', properties: {}, additionalProperties: false };

const finding = (analysis: Analysis, id: string) => (
  Object.values(analysis.findings).flat().find((item) => item.id === id)
);

const evidenceFor = (analysis: Analysis, id: string, tool: string) => (
  finding(analysis, id)?.evidence.filter((item) => item.tool === tool) || []
);

const fullyAnnotated = (name: string, hints: Record<string, boolean>, extra: Record<string, unknown> = {}) => ({
  name,
  title: name,
  description: `Performs the ${name} operation for the fixture.`,
  inputSchema: schema,
  annotations: { title: name, openWorldHint: false, ...hints },
  ...extra,
});

const mismatches = (tools: readonly unknown[]): string[] => (
  (finding(analyzeToolSurface(tools), 'annotations.hint-name-mismatch')?.evidence || [])
    .map((item) => `${item.tool} ${item.path}`)
);

describe('tool annotation findings', () => {
  it('uses the documented, stable finding ids', () => {
    const source = readFileSync(resolve('src/utils/toolAnnotationAnalysis.ts'), 'utf8');
    const emitted = [...source.matchAll(/id: '(annotations\.[a-z-]+)'/g)].map(([, id]) => id).sort();
    expect(emitted).toEqual([...TOOL_ANNOTATION_FINDING_IDS].sort());
    for (const id of TOOL_ANNOTATION_FINDING_IDS) {
      expect(referencePathFor(toolSurfaceReferenceId(id)), id)
        .toBe(`/learn/mcp-transport-diagnostics-reference#tool-${id.replace(/\./g, '-')}`);
    }
  });

  it('emits no annotation findings when there are no named tools', () => {
    const analysis = analyzeToolSurface({ tools: [] });
    expect(Object.values(analysis.findings).flat().filter((item) => item.category === 'annotations')).toEqual([]);
    expect(analysis.metrics.annotations?.analyzedToolCount).toBe(0);
  });

  describe('annotations.missing-safety-hints', () => {
    it('lists each absent hint with its spec default and a tool-specific reason', () => {
      const analysis = analyzeToolSurface([
        { name: 'search_docs', description: 'Search the documentation by query.', inputSchema: schema },
        { name: 'create_invoice', description: 'Creates a draft invoice.', inputSchema: schema, annotations: { readOnlyHint: false } },
        { name: 'delete_user', description: 'Deletes a user account.', inputSchema: schema },
      ]);
      const item = finding(analysis, 'annotations.missing-safety-hints');

      expect(item).toMatchObject({ severity: 'low', kind: 'quality-signal', category: 'annotations' });
      const [search] = evidenceFor(analysis, 'annotations.missing-safety-hints', 'search_docs');
      expect(search.path).toBe('$.annotations');
      expect(search.detail).toContain('readOnlyHint (default false');
      expect(search.detail).toContain('read verb "search"');
      expect(search.detail).toContain('openWorldHint (default true');
      expect(search.detail).toContain('destructiveHint (default true) and idempotentHint (default false), which only apply when readOnlyHint is false');

      const [create] = evidenceFor(analysis, 'annotations.missing-safety-hints', 'create_invoice');
      expect(create.detail).not.toContain('readOnlyHint (');
      expect(create.detail).toContain('destructiveHint (default true');
      expect(create.detail).toContain('suggests an additive update');
      expect(create.detail).toContain('idempotentHint (default false');

      const [remove] = evidenceFor(analysis, 'annotations.missing-safety-hints', 'delete_user');
      expect(remove.detail).toContain('which matches the name "delete_user" contains the token "delete"');
    });

    it('does not ask a read-only tool for destructiveHint or idempotentHint', () => {
      const analysis = analyzeToolSurface([
        { name: 'get_status', description: 'Returns the service status.', inputSchema: schema, annotations: { readOnlyHint: true } },
      ]);
      const [item] = evidenceFor(analysis, 'annotations.missing-safety-hints', 'get_status');

      expect(item.detail).toContain('openWorldHint');
      expect(item.detail).not.toContain('destructiveHint');
      expect(item.detail).not.toContain('idempotentHint');
    });

    it('is absent when every relevant hint is declared', () => {
      const analysis = analyzeToolSurface([
        fullyAnnotated('get_status', { readOnlyHint: true }),
        fullyAnnotated('update_profile', { readOnlyHint: false, destructiveHint: false, idempotentHint: true }),
      ]);

      expect(finding(analysis, 'annotations.missing-safety-hints')).toBeUndefined();
    });
  });

  describe('annotations.missing-title', () => {
    it('separates a missing annotations.title from a tool with no title at all', () => {
      const analysis = analyzeToolSurface([
        { name: 'list_files', description: 'Lists files in the workspace.', inputSchema: schema },
        { name: 'read_file', title: 'Read file', description: 'Reads one workspace file.', inputSchema: schema },
        { name: 'stat_file', description: 'Returns file metadata.', inputSchema: schema, annotations: { title: 'File details' } },
      ]);
      const item = finding(analysis, 'annotations.missing-title');

      expect(item).toMatchObject({ severity: 'low', kind: 'quality-signal' });
      expect(item?.summary).toBe('2 of 3 tools have no annotations.title; 1 of them also have no top-level title.');
      expect(evidenceFor(analysis, 'annotations.missing-title', 'list_files')[0]).toMatchObject({
        path: '$.annotations.title|$.title',
        detail: expect.stringContaining('display the raw name "list_files"'),
      });
      expect(evidenceFor(analysis, 'annotations.missing-title', 'read_file')[0]).toMatchObject({
        path: '$.annotations.title',
        detail: expect.stringContaining('top-level title "Read file" is set'),
      });
      expect(evidenceFor(analysis, 'annotations.missing-title', 'stat_file')).toEqual([]);
    });

    it('ignores blank titles as missing', () => {
      const analysis = analyzeToolSurface([
        { name: 'list_files', title: '  ', description: 'Lists files in the workspace.', inputSchema: schema, annotations: { title: '' } },
      ]);

      expect(evidenceFor(analysis, 'annotations.missing-title', 'list_files')[0].path).toBe('$.annotations.title|$.title');
    });
  });

  describe('annotations.hint-name-mismatch', () => {
    it('flags write names and descriptions marked read-only as a review signal with evidence', () => {
      const analysis = analyzeToolSurface([
        fullyAnnotated('delete_file', { readOnlyHint: true }),
        fullyAnnotated('fileTool', { readOnlyHint: true }, { description: 'Deletes the given file from the workspace.' }),
        fullyAnnotated('get_or_create_user', { readOnlyHint: true }),
        fullyAnnotated('slack_post_message', { readOnlyHint: true }),
      ]);
      const item = finding(analysis, 'annotations.hint-name-mismatch');

      expect(item).toMatchObject({ severity: 'medium', kind: 'review-signal', category: 'annotations' });
      expect(item?.evidence).toEqual(expect.arrayContaining([
        {
          tool: 'delete_file',
          path: '$.annotations.readOnlyHint',
          detail: 'readOnlyHint is true, but the name "delete_file" contains the token "delete", which indicates a write.',
        },
        {
          tool: 'fileTool',
          path: '$.annotations.readOnlyHint',
          detail: 'readOnlyHint is true, but the description begins with "Deletes", which indicates a write.',
        },
      ]));
      expect(mismatches([fullyAnnotated('get_or_create_user', { readOnlyHint: true })]))
        .toEqual(['get_or_create_user $.annotations.readOnlyHint']);
      expect(mismatches([fullyAnnotated('slack_post_message', { readOnlyHint: true })]))
        .toEqual(['slack_post_message $.annotations.readOnlyHint']);
      expect(analysis.metrics.annotations?.hintMismatchToolCount).toBe(4);
    });

    it('does not flag read tools whose names merely contain write words', () => {
      expect(mismatches([
        fullyAnnotated('get_deleted_items', { readOnlyHint: true }),
        fullyAnnotated('list_delete_jobs', { readOnlyHint: true }),
        fullyAnnotated('search_sent_messages', { readOnlyHint: true }),
        fullyAnnotated('blog_post_list', { readOnlyHint: true }),
        fullyAnnotated('list_posts', { readOnlyHint: true }),
        fullyAnnotated('run_query', { readOnlyHint: true }),
        fullyAnnotated('execute_sql', { readOnlyHint: true }),
        fullyAnnotated('recent_updates', { readOnlyHint: true }, { description: 'Updates from the release feed, newest first.' }),
        fullyAnnotated('get_file', { readOnlyHint: true }, { description: 'Deletes nothing; returns one file.' }),
        fullyAnnotated('describe_user', { readOnlyHint: true }, { description: 'Does not delete or modify the user.' }),
      ])).toEqual([]);
    });

    it('flags destructiveHint: false only on destructive verbs', () => {
      expect(mismatches([
        fullyAnnotated('remove_member', { readOnlyHint: false, destructiveHint: false, idempotentHint: true }),
        fullyAnnotated('create_project', { readOnlyHint: false, destructiveHint: false, idempotentHint: false }),
        fullyAnnotated('update_profile', { readOnlyHint: false, destructiveHint: false, idempotentHint: true }),
      ])).toEqual(['remove_member $.annotations.destructiveHint']);
    });

    it('flags idempotentHint: true on repeating verbs unless an idempotency key is declared', () => {
      const keyedSchema = {
        type: 'object',
        properties: { to: { type: 'string' }, idempotency_key: { type: 'string' } },
      };
      expect(mismatches([
        fullyAnnotated('send_email', { readOnlyHint: false, destructiveHint: false, idempotentHint: true }),
        fullyAnnotated('appendRow', { readOnlyHint: false, destructiveHint: false, idempotentHint: true }),
        fullyAnnotated('send_invoice', { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, { inputSchema: keyedSchema }),
        fullyAnnotated('set_status', { readOnlyHint: false, destructiveHint: false, idempotentHint: true }),
        fullyAnnotated('send_digest', { readOnlyHint: false, destructiveHint: false, idempotentHint: false }),
      ])).toEqual([
        'appendRow $.annotations.idempotentHint',
        'send_email $.annotations.idempotentHint',
      ]);
    });

    it('ignores destructiveHint on read-only tools, as the spec does', () => {
      const tools = [
        fullyAnnotated('get_report', { readOnlyHint: true, destructiveHint: true }),
        fullyAnnotated('get_deleted_report', { readOnlyHint: true, destructiveHint: false }),
      ];
      expect(mismatches(tools)).toEqual([]);
      expect(createReleaseDecisionFor(tools).priorities.filter(({ id }) => id.startsWith('tool.annotations.'))).toEqual([]);
    });

    it('reports only the readOnlyHint contradiction when a write tool is marked read-only', () => {
      expect(mismatches([fullyAnnotated('delete_file', { readOnlyHint: true, destructiveHint: false })]))
        .toEqual(['delete_file $.annotations.readOnlyHint']);
    });

    it('asks for review without blocking release or failing the default release gate', () => {
      // create_note also gets the existing medium write-capability signal, but
      // no high finding, so the mismatch alone decides nothing more than review.
      const flagged = createReleaseDecisionFor([fullyAnnotated('create_note', { readOnlyHint: true })]);
      expect(flagged.status).toBe('review');
      expect(flagged.priorities.filter(({ severity }) => severity === 'critical' || severity === 'high')).toEqual([]);
      expect(flagged.priorities).toContainEqual(expect.objectContaining({
        id: 'tool.annotations.hint-name-mismatch',
        severity: 'medium',
        source: 'Tool surface',
      }));
      expect(getReleaseGateThresholdReasons(flagged, DEFAULT_RELEASE_GATE_POLICY)).toEqual([]);
    });
  });

  describe('missing hints and titles stay out of the release decision', () => {
    it('adds no release priority for low and info annotation findings', () => {
      const bare = createReleaseDecisionFor([
        { name: 'search_docs', description: 'Search documentation by query.', inputSchema: schema },
      ]);
      const annotated = createReleaseDecisionFor([
        { ...fullyAnnotated('search_docs', { readOnlyHint: true }), description: 'Search documentation by query.' },
      ]);
      expect(bare.priorities.filter(({ id }) => id.startsWith('tool.annotations.'))).toEqual([]);
      expect(bare.status).toBe(annotated.status);
      expect(bare.priorities.map(({ id }) => id)).toEqual(annotated.priorities.map(({ id }) => id));
    });
  });

  describe('annotations.client-treatment', () => {
    it('groups tools by how clients treat them and cites the verified sources', () => {
      const analysis = analyzeToolSurface([
        fullyAnnotated('get_status', { readOnlyHint: true }),
        fullyAnnotated('list_jobs', { readOnlyHint: true }),
        fullyAnnotated('update_profile', { readOnlyHint: false, destructiveHint: false, idempotentHint: true }),
        { name: 'send_email', description: 'Sends one email message.', inputSchema: schema },
      ]);
      const item = finding(analysis, 'annotations.client-treatment');

      expect(item).toMatchObject({ severity: 'info', kind: 'measurement' });
      expect(item?.summary).toContain('3 of 4 tools may be retried after a dropped connection (Claude Code)');
      expect(item?.summary).toContain('2 of 4 may run in parallel with other read-only calls (Codex CLI)');
      expect(item?.summary).toContain('1 of 4 get neither');
      expect(item?.summary).toContain('https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md');
      expect(item?.summary).toContain('https://github.com/openai/codex/releases/tag/rust-v0.134.0');

      const byTool = Object.fromEntries(item?.evidence.map((entry) => [entry.tool, entry.detail]) || []);
      expect(byTool['get_status, list_jobs']).toMatch(/^May be retried after a dropped connection and may run in parallel with other read-only calls/);
      expect(byTool['get_status, list_jobs']).toContain('closed domain (openWorldHint false)');
      expect(byTool.update_profile).toMatch(/^May be retried after a dropped connection, but does not run in parallel/);
      expect(byTool.update_profile).toContain('additively only');
      expect(byTool.send_email).toMatch(/^Neither retried nor run in parallel/);
      expect(byTool.send_email).toContain('possibly destructively');
      expect(byTool.send_email).toContain('may reach external entities (openWorldHint true or absent)');
    });
  });

  describe('annotations.coverage', () => {
    it('counts each hint and title across tools', () => {
      const analysis = analyzeToolSurface([
        fullyAnnotated('get_status', { readOnlyHint: true }),
        { name: 'send_email', description: 'Sends one email message.', inputSchema: schema, annotations: { destructiveHint: false } },
        { name: 'list_jobs', title: 'Jobs', description: 'Lists background jobs.', inputSchema: schema },
      ]);

      expect(analysis.metrics.annotations).toEqual({
        analyzedToolCount: 3,
        annotatedToolCount: 2,
        readOnlyHintCount: 1,
        destructiveHintCount: 1,
        idempotentHintCount: 0,
        openWorldHintCount: 1,
        annotationTitleCount: 1,
        titleCount: 2,
        readOnlyToolCount: 1,
        retryHintDeclaredCount: 1,
        retryEligibleToolCount: 1,
        hintMismatchToolCount: 0,
      });
      expect(finding(analysis, 'annotations.coverage')).toMatchObject({
        severity: 'info',
        kind: 'measurement',
        summary: 'Of 3 tools: readOnlyHint 1, destructiveHint 1, idempotentHint 0, openWorldHint 1, annotations.title 1, title 2.',
      });
      expect(finding(analysis, 'annotations.coverage')?.evidence).toContainEqual({
        tool: '<surface>',
        path: '$.tools[*].annotations.readOnlyHint',
        detail: '1 of 3 tools declare readOnlyHint (spec default when absent: false).',
      });
    });

    it('bounds evidence for large surfaces', () => {
      const tools = Array.from({ length: 40 }, (_, index) => ({
        name: `lookup_record_${String(index).padStart(2, '0')}`,
        description: 'Looks up one record by id.',
        inputSchema: schema,
      }));
      const missing = finding(analyzeToolSurface(tools), 'annotations.missing-safety-hints');

      expect(missing?.evidence).toHaveLength(12);
      expect(missing?.omittedEvidenceCount).toBe(28);
    });
  });

  it('renders documented annotation findings with reference links and evidence in Markdown', () => {
    const report = evaluatedReport([fullyAnnotated('delete_file', { readOnlyHint: true })]);
    const markdown = serializePublicReportMarkdown(createPublicReport(report, {
      generatedAt: '2026-11-11T00:00:00.000Z',
      toolSurfaceAnalysis: report.toolSurfaceAnalysis,
    }));

    expect(markdown).toContain('- [medium] Declared hints contradict the tool name or description');
    expect(markdown).toContain('  - Reference: [tool.annotations.hint-name-mismatch](https://mcptest.io/learn/mcp-transport-diagnostics-reference#tool-annotations-hint-name-mismatch)');
    expect(markdown).toContain('  - Evidence: delete\\_file at $.annotations.readOnlyHint: readOnlyHint is true');
  });
});

describe('tool hint host compatibility rules', () => {
  const client = (id: string) => {
    const entry = CLIENT_COMPATIBILITY.clients.find((item) => item.id === id);
    if (!entry) throw new Error(`missing client ${id}`);
    const profile = getClientHostProfile(entry);
    if (!profile) throw new Error(`missing profile ${id}`);
    return profile;
  };
  const ruleFinding = (profileId: string, ruleId: string, tools: readonly unknown[] | null) => {
    const facts = tools ? createObservedServerFacts(evaluatedReport(tools)) : publicServerFixture;
    return assessHostCompatibility(facts, client(profileId)).findings.find((item) => item.ruleId === ruleId);
  };

  it('adds the retry rule to Claude Code and the parallel rule to Codex CLI only', () => {
    expect(client('claude-code').rules.map(({ id }) => id)).toContain('tools.retry-hints');
    expect(client('claude-code').rules.map(({ id }) => id)).not.toContain('tools.parallel-read-only');
    expect(client('codex-cli').rules.map(({ id }) => id)).toContain('tools.parallel-read-only');
    expect(client('codex-cli').rules.map(({ id }) => id)).not.toContain('tools.retry-hints');
    for (const profile of [...HOST_PROFILE_LIST, client('windsurf'), client('gemini-cli')]) {
      expect(profile.rules.filter(({ id }) => id.startsWith('tools.'))).toEqual([]);
    }
    expect(client('claude-code').assumptions).toContainEqual(expect.objectContaining({
      id: 'claude-code-tool-hints',
      url: 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md',
    }));
  });

  it('reports a caveat, never a failure, when tools omit the hints the client relies on', () => {
    const bare = [{ name: 'search_docs', description: 'Search documentation by query.', inputSchema: schema }];
    expect(ruleFinding('claude-code', 'tools.retry-hints', bare)).toMatchObject({
      outcome: 'caveat',
      severity: 'warning',
      evidence: expect.arrayContaining([
        expect.objectContaining({ description: expect.stringContaining('0 of 1 tools state their retry safety') }),
        expect.objectContaining({ source: 'host-profile', location: 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md' }),
      ]),
    });
    expect(ruleFinding('codex-cli', 'tools.parallel-read-only', bare)).toMatchObject({ outcome: 'caveat' });
  });

  it('passes when the hints are declared', () => {
    const annotated = [
      fullyAnnotated('search_docs', { readOnlyHint: true }),
      fullyAnnotated('send_email', { readOnlyHint: false, destructiveHint: false, idempotentHint: false }),
    ];
    expect(ruleFinding('claude-code', 'tools.retry-hints', annotated)?.outcome).toBe('pass');
    expect(ruleFinding('codex-cli', 'tools.parallel-read-only', annotated)?.outcome).toBe('pass');
  });

  it('treats idempotentHint: true without readOnlyHint as a declared retry hint', () => {
    const tools = [{ name: 'upsert_record', description: 'Creates or replaces one record by id.', inputSchema: schema, annotations: { idempotentHint: true } }];
    const annotations = analyzeToolSurface(tools).metrics.annotations;
    expect(annotations).toMatchObject({ retryHintDeclaredCount: 1, retryEligibleToolCount: 1 });
    expect(createObservedServerFacts(evaluatedReport(tools)).tools?.retryHintsDeclared).toMatchObject({ value: true });
    expect(ruleFinding('claude-code', 'tools.retry-hints', tools)).toMatchObject({
      outcome: 'pass',
      evidence: expect.arrayContaining([
        expect.objectContaining({ description: expect.stringContaining('1 of 1 tools state their retry safety') }),
      ]),
    });
  });

  it('still reports a caveat when a write tool declares idempotentHint: false without readOnlyHint', () => {
    const tools = [{ name: 'send_email', description: 'Sends one email message.', inputSchema: schema, annotations: { idempotentHint: false } }];
    expect(analyzeToolSurface(tools).metrics.annotations).toMatchObject({ retryHintDeclaredCount: 0, retryEligibleToolCount: 0 });
    expect(ruleFinding('claude-code', 'tools.retry-hints', tools)?.outcome).toBe('caveat');
  });

  it('does not change the assessment when no tool facts were observed', () => {
    expect(publicServerFixture.tools).toBeUndefined();
    expect(ruleFinding('claude-code', 'tools.retry-hints', null)?.outcome).toBe('pass');
    expect(ruleFinding('codex-cli', 'tools.parallel-read-only', null)?.outcome).toBe('pass');
  });

  it('stays neutral when tool discovery is unknown and no tool facts were observed', () => {
    const facts = {
      ...publicServerFixture,
      capabilities: {
        ...publicServerFixture.capabilities,
        tools: unknownFact<CapabilityAvailability>('Tool discovery did not complete.'),
      },
    };
    expect(facts.tools).toBeUndefined();
    for (const [profileId, ruleId] of [['claude-code', 'tools.retry-hints'], ['codex-cli', 'tools.parallel-read-only']]) {
      const profile = client(profileId);
      const assessment = assessHostCompatibility(facts, profile);
      const withoutRule = assessHostCompatibility(facts, {
        ...profile,
        rules: profile.rules.filter(({ id }) => id !== ruleId),
      });
      expect(assessment.findings.find((item) => item.ruleId === ruleId)).toMatchObject({ outcome: 'pass' });
      expect(assessment.findings.filter((item) => item.outcome === 'unknown').map((item) => item.ruleId)).not.toContain(ruleId);
      expect(assessment.status).toBe(withoutRule.status);
    }
  });

  it('applies the observed tool facts even when tool discovery is unknown', () => {
    const bare = [{ name: 'search_docs', description: 'Search documentation by query.', inputSchema: schema }];
    const observedFacts = createObservedServerFacts(evaluatedReport(bare));
    const facts = {
      ...observedFacts,
      capabilities: {
        ...observedFacts.capabilities,
        tools: unknownFact<CapabilityAvailability>('Tool discovery did not complete.'),
      },
    };
    expect(assessHostCompatibility(facts, client('claude-code')).findings.find((item) => item.ruleId === 'tools.retry-hints'))
      .toMatchObject({ outcome: 'caveat' });
    expect(assessHostCompatibility(facts, client('codex-cli')).findings.find((item) => item.ruleId === 'tools.parallel-read-only'))
      .toMatchObject({ outcome: 'caveat' });
  });

  it('stays neutral when the server does not advertise tools', () => {
    const bare = [{ name: 'search_docs', description: 'Search documentation by query.', inputSchema: schema }];
    const observedFacts = createObservedServerFacts(evaluatedReport(bare));
    const facts = {
      ...observedFacts,
      capabilities: {
        ...observedFacts.capabilities,
        tools: observedFact<CapabilityAvailability>('absent', 'tools/list was not advertised.'),
      },
    };
    expect(assessHostCompatibility(facts, client('claude-code')).findings
      .filter((item) => item.ruleId === 'tools.retry-hints' && item.outcome !== 'pass')).toEqual([]);
    expect(assessHostCompatibility(facts, client('codex-cli')).findings
      .filter((item) => item.ruleId === 'tools.parallel-read-only' && item.outcome !== 'pass')).toEqual([]);
  });

  it('leaves tool facts out when pagination was incomplete', () => {
    const report = evaluatedReport([], {
      toolSurfaceAnalysis: analyzeToolSurface({
        tools: [{ name: 'search_docs', description: 'Search documentation by query.', inputSchema: schema }],
        nextCursor: 'page-2',
      }),
    });
    expect(createObservedServerFacts(report).tools).toBeUndefined();
  });
});

function evaluatedReport(tools: readonly unknown[], overrides: Partial<EvaluationReport> = {}): EvaluationReport {
  return {
    serverUrl: 'https://annotations.example/mcp',
    outcome: 'scored',
    finalScore: 70,
    sections: {
      protocol: {
        name: 'Core protocol',
        description: 'Protocol negotiation',
        score: 15,
        maxScore: 15,
        details: [{
          text: '✓ Negotiated MCP',
          metadata: {
            protocolEra: 'modern',
            protocolVersion: '2026-07-28',
            transportType: 'streamable-http',
            route: 'direct',
            unauthenticatedTargetRequestSucceeded: true,
          },
        }],
      },
      capabilities: {
        name: 'Capabilities',
        description: 'Discovery methods',
        score: 10,
        maxScore: 10,
        details: [
          { text: `✓ tools/list succeeded (${tools.length} tools)`, metadata: { method: 'tools/list' } },
          { text: '✓ resources/list succeeded (0 resources)', metadata: { method: 'resources/list' } },
          { text: '✓ prompts/list succeeded (0 prompts)', metadata: { method: 'prompts/list' } },
        ],
      },
      transport: {
        name: 'Transport',
        description: 'Transport negotiation',
        score: 15,
        maxScore: 15,
        details: [{ text: '✓ Streamable HTTP', metadata: { transportType: 'streamable-http' } }],
      },
      cors: {
        name: 'Browser access',
        description: 'Direct browser access',
        score: 15,
        maxScore: 15,
        details: [{ text: '✓ Direct browser MCP negotiation succeeded' }],
      },
      performance: {
        name: 'Performance',
        description: 'Connection timing',
        score: 15,
        maxScore: 15,
        details: [{ text: '✓ excellent negotiation time: 100ms', metadata: { durationMs: 100 } }],
      },
    },
    toolSurfaceAnalysis: analyzeToolSurface({ tools, resources: [], prompts: [] }),
    ...overrides,
  };
}

function createReleaseDecisionFor(tools: readonly unknown[]) {
  const report = evaluatedReport(tools);
  return createReleaseDecision(report, createCompatibilityMatrix(report), report.toolSurfaceAnalysis);
}
