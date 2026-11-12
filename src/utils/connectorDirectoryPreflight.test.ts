import { describe, expect, it } from 'vitest';
import type { CatalogSubmissionEvidence } from './catalogSubmission';
import {
  createConnectorDirectoryPreflight,
  directoryPreflightObservationsFromReport,
  directoryPreflightObservationsFromSubmissionEvidence,
  evaluateConnectorDirectoryPreflight,
  serializeConnectorDirectoryPreflightMarkdown,
  summarizeConnectorDirectoryPreflight,
  type ConnectorDirectoryPreflightV1,
  type DirectoryPreflightObservations,
} from './connectorDirectoryPreflight';
import type { EvaluationReport } from './evaluation';
import { analyzeToolSurface } from './toolSurfaceAnalysis';
import type { ConnectorDirectoryRequirementId } from '../data/connectorDirectoryRequirements';

const ENDPOINT = 'https://mcp.acme-tools.dev/mcp';

const fullyAnnotated = (name: string, overrides: Record<string, unknown> = {}) => ({
  name,
  title: `${name} title`,
  description: `Runs ${name} against the Acme workspace.`,
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  ...overrides,
});

const toolsFrom = (tools: unknown[]) => {
  const analysis = analyzeToolSurface({ tools, resources: [], prompts: [] });
  return { annotations: analysis.toolAnnotations, definitions: analysis.toolDefinitions };
};

const observations = (overrides: Partial<DirectoryPreflightObservations> = {}): DirectoryPreflightObservations => ({
  endpointUrl: ENDPOINT,
  reachable: true,
  authorization: {
    requirement: 'none',
    schemes: [],
    protectedResourceMetadata: 'unknown',
    authorizationServerMetadata: 'unknown',
    pkceS256: 'unknown',
  },
  tools: toolsFrom([fullyAnnotated('search_docs'), fullyAnnotated('get_doc')]),
  ...overrides,
});

const oauthObservations = (
  oauth: Partial<DirectoryPreflightObservations['authorization']> = {}
): DirectoryPreflightObservations => observations({
  authorization: {
    requirement: 'required',
    schemes: ['oauth'],
    protectedResourceMetadata: true,
    authorizationServerMetadata: true,
    pkceS256: true,
    ...oauth,
  },
});

const item = (preflight: ConnectorDirectoryPreflightV1, id: ConnectorDirectoryRequirementId) => {
  const found = preflight.directories.flatMap((directory) => directory.items).find((entry) => entry.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};

const statusOf = (input: DirectoryPreflightObservations, id: ConnectorDirectoryRequirementId) => (
  item(evaluateConnectorDirectoryPreflight(input), id).status
);

describe('connector directory preflight', () => {
  it('passes every automatic item for a public, fully annotated server', () => {
    const preflight = evaluateConnectorDirectoryPreflight(observations());
    for (const directory of preflight.directories) {
      for (const entry of directory.items.filter((candidate) => candidate.check === 'automatic')) {
        expect([entry.id, entry.status]).toEqual([entry.id, expect.stringMatching(/^(pass|not-applicable)$/)]);
      }
      expect(directory.counts.fail).toBe(0);
    }
    expect(preflight.advisories).toEqual([]);
  });

  it('never marks manual items as passed or failed and links each to its source', () => {
    const preflight = evaluateConnectorDirectoryPreflight(observations());
    const manual = preflight.directories.flatMap((directory) => directory.items).filter((entry) => entry.check === 'manual');
    expect(manual.length).toBeGreaterThan(0);
    for (const entry of manual) {
      expect(entry.status).toBe('manual');
      expect(entry.source.url).toMatch(/^https:\/\//);
    }
  });

  describe('remote HTTPS', () => {
    it.each([
      ['http://mcp.acme-tools.dev/mcp', 'fail'],
      ['https://localhost:3000/mcp', 'fail'],
      ['https://10.0.0.4/mcp', 'fail'],
      ['not a url', 'fail'],
      [ENDPOINT, 'pass'],
    ] as const)('%s is %s', (endpointUrl, status) => {
      expect(statusOf(observations({ endpointUrl }), 'claude.remote-https')).toBe(status);
      expect(statusOf(observations({ endpointUrl }), 'chatgpt.remote-https')).toBe(status);
    });

    it('fails an unreachable endpoint and stays unknown when reachability is unknown', () => {
      expect(statusOf(observations({ reachable: false }), 'claude.remote-https')).toBe('fail');
      expect(statusOf(observations({ reachable: 'unknown' }), 'claude.remote-https')).toBe('unknown');
    });
  });

  describe('tool metadata', () => {
    it('fails tools without a title and accepts annotations.title', () => {
      const input = observations({
        tools: toolsFrom([
          fullyAnnotated('untitled', { title: undefined }),
          fullyAnnotated('annotation_title', { title: undefined, annotations: { title: 'Annotated', readOnlyHint: true, destructiveHint: false, openWorldHint: false } }),
        ]),
      });
      const result = item(evaluateConnectorDirectoryPreflight(input), 'claude.tool-title');
      expect(result.status).toBe('fail');
      expect(result.evidence).toEqual(['untitled']);
    });

    it('requires readOnlyHint or destructiveHint for Claude', () => {
      const input = observations({
        tools: toolsFrom([
          fullyAnnotated('no_hints', { annotations: { openWorldHint: true } }),
          fullyAnnotated('destructive_only', { annotations: { destructiveHint: true } }),
        ]),
      });
      const result = item(evaluateConnectorDirectoryPreflight(input), 'claude.tool-safety-hint');
      expect(result.status).toBe('fail');
      expect(result.evidence).toEqual(['no_hints']);
    });

    it('does not accept a hint set to false as the Claude safety hint', () => {
      const input = observations({
        tools: toolsFrom([
          fullyAnnotated('lone_false', { annotations: { readOnlyHint: false } }),
          fullyAnnotated('both_false', { annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } }),
          fullyAnnotated('read_only'),
          fullyAnnotated('destructive', { annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false } }),
        ]),
      });
      const result = item(evaluateConnectorDirectoryPreflight(input), 'claude.tool-safety-hint');
      expect(result.status).toBe('fail');
      expect(result.evidence).toEqual(['both_false', 'lone_false']);
      // Both false is still a complete set of explicit booleans for ChatGPT.
      expect(statusOf(observations({ tools: toolsFrom([fullyAnnotated('both_false', {
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      })]) }), 'chatgpt.tool-annotations')).toBe('pass');
    });

    it('keeps the Claude safety hint unknown for a partial record without a failing tool', () => {
      const annotations = toolsFrom([fullyAnnotated('read_only')]).annotations;
      const input = observations({ tools: { annotations: annotations && { ...annotations, status: 'partial' } } });
      expect(statusOf(input, 'claude.tool-safety-hint')).toBe('unknown');
    });

    it('requires all three explicit hints for ChatGPT', () => {
      const input = observations({
        tools: toolsFrom([
          fullyAnnotated('missing_open_world', { annotations: { readOnlyHint: true, destructiveHint: false } }),
          fullyAnnotated('string_hint', { annotations: { readOnlyHint: 'true', destructiveHint: false, openWorldHint: false } }),
          fullyAnnotated('complete'),
        ]),
      });
      const result = item(evaluateConnectorDirectoryPreflight(input), 'chatgpt.tool-annotations');
      expect(result.status).toBe('fail');
      expect(result.evidence).toEqual(['missing_open_world', 'string_hint']);
    });

    it('fails tool names longer than 64 characters', () => {
      const long = `t${'x'.repeat(64)}`;
      expect(statusOf(observations({ tools: toolsFrom([fullyAnnotated(long)]) }), 'claude.tool-name-length')).toBe('fail');
      expect(statusOf(observations({ tools: toolsFrom([fullyAnnotated('x'.repeat(64))]) }), 'claude.tool-name-length')).toBe('pass');
    });

    it('fails tools with an empty description for ChatGPT', () => {
      const input = observations({ tools: toolsFrom([fullyAnnotated('blank', { description: '   ' })]) });
      expect(statusOf(input, 'chatgpt.tool-description')).toBe('fail');
    });

    it('fails duplicate tool names', () => {
      const input = observations({ tools: toolsFrom([fullyAnnotated('same'), fullyAnnotated('same')]) });
      const result = item(evaluateConnectorDirectoryPreflight(input), 'chatgpt.tool-name-unique');
      expect(result.status).toBe('fail');
      expect(result.evidence).toEqual(['same']);
    });

    it('stays unknown when the tool list was not observed or not recorded', () => {
      expect(statusOf(observations({ tools: undefined }), 'claude.tool-title')).toBe('unknown');
      expect(statusOf(observations({ tools: { definitions: toolsFrom([]).definitions } }), 'claude.tool-title')).toBe('unknown');
      expect(statusOf(observations({ tools: undefined }), 'claude.separate-read-write')).toBe('unknown');
      expect(statusOf(observations({ tools: undefined }), 'chatgpt.tool-name-unique')).toBe('unknown');
    });

    it('does not pass a partial record but still reports a recorded failure', () => {
      const partial = (tools: ReturnType<typeof toolsFrom>['annotations']) => observations({
        tools: { annotations: tools && { ...tools, status: 'partial' } },
      });
      expect(statusOf(partial(toolsFrom([fullyAnnotated('ok')]).annotations), 'claude.tool-title')).toBe('unknown');
      expect(statusOf(partial(toolsFrom([fullyAnnotated('bad', { title: undefined })]).annotations), 'claude.tool-title')).toBe('fail');
    });

    it('marks tool checks not applicable for a server without tools', () => {
      expect(statusOf(observations({ tools: toolsFrom([]) }), 'claude.tool-title')).toBe('not-applicable');
    });
  });

  describe('separate read and write tools', () => {
    it('fails a catch-all tool whose method mixes safe and unsafe HTTP methods', () => {
      const input = observations({
        tools: toolsFrom([fullyAnnotated('api_request', {
          inputSchema: { type: 'object', properties: { method: { enum: ['GET', 'POST'] }, path: { type: 'string' } } },
        })]),
      });
      const result = item(evaluateConnectorDirectoryPreflight(input), 'claude.separate-read-write');
      expect(result.status).toBe('fail');
      expect(result.evidence).toEqual(['api_request (method: GET, POST)']);
    });

    it('passes a plain method argument limited to safe methods', () => {
      const input = observations({
        tools: toolsFrom([fullyAnnotated('fetch_url', {
          inputSchema: { type: 'object', properties: { method: { type: 'string', enum: ['GET', 'HEAD'] } } },
        })]),
      });
      expect(statusOf(input, 'claude.separate-read-write')).toBe('pass');
    });
  });

  describe('method schemas the check does not decide', () => {
    const withSchema = (inputSchema: Record<string, unknown>) => observations({
      tools: toolsFrom([fullyAnnotated('api_request', { inputSchema: { type: 'object', ...inputSchema } })]),
    });
    const review = (input: DirectoryPreflightObservations) => {
      const result = item(evaluateConnectorDirectoryPreflight(input), 'claude.separate-read-write');
      expect(result.status).toBe('manual');
      expect(result.check).toBe('automatic');
      expect(result.detail).toMatch(/^Manual review needed: /);
      return result;
    };

    it('leaves a free-text method argument for manual review, not failed or passed', () => {
      const result = review(withSchema({
        properties: { method: { type: 'string', description: 'Only GET is supported; POST and DELETE are rejected.' } },
      }));
      expect(result.evidence).toEqual(['api_request (/properties/method)']);
    });

    it('F12: leaves a patternProperties schema for manual review without compiling the pattern', () => {
      const started = Date.now();
      review(withSchema({
        properties: { method: { enum: ['GET', 'POST'] } },
        patternProperties: { '(?:){1000000000}': { const: 'GET' } },
      }));
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it('F14: leaves a pattern-keyed schema with no visible method argument for manual review, not passed', () => {
      const result = review(withSchema({ patternProperties: { '^method$': { type: 'string' } }, additionalProperties: false }));
      expect(result.evidence).toEqual(['api_request (/patternProperties)']);
      expect(result.detail).toContain('patternProperties or an external $ref');
    });

    it('F14: leaves an unresolved external $ref for manual review, not passed', () => {
      const input = observations({
        tools: toolsFrom([fullyAnnotated('api_request', { inputSchema: { $ref: 'https://example.com/schemas/request.json' } })]),
      });
      expect(review(input).evidence).toEqual(['api_request (/$ref)']);
    });

    it('F13: leaves a method enum under maxProperties for manual review, not failed', () => {
      review(withSchema({
        required: ['query'],
        maxProperties: 1,
        properties: { query: { type: 'string' }, method: { enum: ['GET', 'POST'] } },
      }));
    });

    it('leaves composition for manual review', () => {
      review(withSchema({
        properties: { method: { enum: ['GET', 'POST'] } },
        allOf: [{ properties: { method: { const: 'GET' } } }],
      }));
      const result = review(withSchema({ oneOf: [{ properties: { method: { enum: ['GET', 'POST'] } } }] }));
      expect(result.evidence).toEqual(['api_request (/oneOf/0/properties/method)']);
    });

    it('still fails a tool when another tool needs manual review', () => {
      const input = observations({
        tools: toolsFrom([
          fullyAnnotated('api_request', { inputSchema: { type: 'object', properties: { method: { enum: ['GET', 'POST'] } } } }),
          fullyAnnotated('other', { inputSchema: { type: 'object', properties: { method: { type: 'string' } } } }),
        ]),
      });
      expect(statusOf(input, 'claude.separate-read-write')).toBe('fail');
    });
  });

  describe('authentication', () => {
    it('passes confirmed OAuth with discovery and PKCE', () => {
      const input = oauthObservations();
      for (const id of ['claude.oauth-for-authenticated-services', 'claude.oauth-discovery', 'claude.pkce-s256', 'chatgpt.supported-authentication'] as const) {
        expect(statusOf(input, id), id).toBe('pass');
      }
    });

    it('fails a server that requires only a bearer token or API key', () => {
      for (const scheme of ['bearer', 'api-key'] as const) {
        const input = observations({
          authorization: {
            requirement: 'required',
            schemes: [scheme],
            protectedResourceMetadata: 'unknown',
            authorizationServerMetadata: 'unknown',
            pkceS256: 'unknown',
          },
        });
        expect(statusOf(input, 'claude.oauth-for-authenticated-services')).toBe('fail');
        expect(statusOf(input, 'chatgpt.supported-authentication')).toBe('fail');
        expect(statusOf(input, 'claude.oauth-discovery')).toBe('not-applicable');
      }
    });

    it('fails a bare Bearer challenge once discovery found no OAuth metadata', () => {
      const input = oauthObservations({
        schemes: ['bearer', 'oauth'],
        protectedResourceMetadata: false,
        authorizationServerMetadata: false,
      });
      expect(statusOf(input, 'claude.oauth-for-authenticated-services')).toBe('fail');
    });

    it('keeps an unconfirmed Bearer-or-OAuth challenge unknown', () => {
      const input = oauthObservations({
        schemes: ['bearer', 'oauth'],
        protectedResourceMetadata: 'unknown',
        authorizationServerMetadata: 'unknown',
      });
      expect(statusOf(input, 'claude.oauth-for-authenticated-services')).toBe('unknown');
      expect(statusOf(input, 'claude.oauth-discovery')).toBe('unknown');
    });

    it('fails missing discovery metadata and missing S256 PKCE', () => {
      expect(statusOf(oauthObservations({ protectedResourceMetadata: false }), 'claude.oauth-discovery')).toBe('fail');
      expect(statusOf(oauthObservations({ authorizationServerMetadata: false }), 'claude.oauth-discovery')).toBe('fail');
      expect(statusOf(oauthObservations({ pkceS256: false }), 'claude.pkce-s256')).toBe('fail');
      expect(statusOf(oauthObservations({ pkceS256: 'unknown' }), 'claude.pkce-s256')).toBe('unknown');
    });

    it('treats a public server as acceptable and OAuth details as not applicable', () => {
      const input = observations();
      expect(statusOf(input, 'claude.oauth-for-authenticated-services')).toBe('pass');
      expect(statusOf(input, 'chatgpt.supported-authentication')).toBe('pass');
      expect(statusOf(input, 'claude.oauth-discovery')).toBe('not-applicable');
      expect(statusOf(input, 'claude.pkce-s256')).toBe('not-applicable');
    });

    it('stays unknown when authorization was not established', () => {
      const input = observations({
        authorization: {
          requirement: 'unknown',
          schemes: 'unknown',
          protectedResourceMetadata: 'unknown',
          authorizationServerMetadata: 'unknown',
          pkceS256: 'unknown',
        },
      });
      for (const id of ['claude.oauth-for-authenticated-services', 'claude.oauth-discovery', 'claude.pkce-s256', 'chatgpt.supported-authentication'] as const) {
        expect(statusOf(input, id), id).toBe('unknown');
      }
    });
  });

  it('adds the multiplexing advisory without failing any check', () => {
    const preflight = evaluateConnectorDirectoryPreflight(observations({
      tools: toolsFrom([fullyAnnotated('manage', {
        inputSchema: { type: 'object', properties: { action: { enum: ['list', 'create', 'delete'] } } },
      })]),
    }));
    expect(preflight.advisories).toHaveLength(1);
    expect(preflight.advisories[0]).toMatchObject({ severity: 'advisory', matches: [{ tool: 'manage', argument: 'action' }] });
    expect(preflight.directories.every((directory) => directory.counts.fail === 0)).toBe(true);
  });

  describe('report adapter', () => {
    const report = (overrides: Partial<EvaluationReport> = {}): EvaluationReport => ({
      serverUrl: ENDPOINT,
      outcome: 'scored',
      finalScore: 50,
      sections: {
        protocol: {
          name: 'Core protocol',
          description: 'Protocol negotiation',
          score: 15,
          maxScore: 15,
          details: [{
            text: '✓ Negotiated MCP',
            metadata: { protocolVersion: '2025-11-25', transportType: 'streamable-http', route: 'direct', unauthenticatedTargetRequestSucceeded: true },
          }],
        },
      },
      toolSurfaceAnalysis: analyzeToolSurface({
        tools: [fullyAnnotated('search_docs'), fullyAnnotated('untitled', { title: undefined })],
        resources: [],
        prompts: [],
      }),
      ...overrides,
    });

    it('reuses the report facts and the tool-surface analysis', () => {
      const observed = directoryPreflightObservationsFromReport(report());
      expect(observed.reachable).toBe(true);
      expect(observed.authorization.requirement).toBe('none');
      expect(observed.tools?.annotations?.tools.map((tool) => tool.name)).toEqual(['search_docs', 'untitled']);
      const preflight = createConnectorDirectoryPreflight(report());
      expect(item(preflight, 'claude.tool-title').evidence).toEqual(['untitled']);
    });

    it('marks a failed evaluation unreachable and leaves tools unknown without an analysis', () => {
      const preflight = createConnectorDirectoryPreflight(report({ outcome: 'failed', toolSurfaceAnalysis: undefined }));
      expect(item(preflight, 'claude.remote-https').status).toBe('fail');
      expect(item(preflight, 'claude.tool-title').status).toBe('unknown');
    });

    it('keeps tool checks unknown for reports recorded before annotations were kept', () => {
      const legacy = report();
      delete legacy.toolSurfaceAnalysis!.toolAnnotations;
      expect(item(createConnectorDirectoryPreflight(legacy), 'claude.tool-title').status).toBe('unknown');
    });
  });

  describe('submission probe adapter', () => {
    const evidence = (overrides: Partial<CatalogSubmissionEvidence>): CatalogSubmissionEvidence => ({
      checkedAt: '2026-11-11T00:00:00.000Z',
      endpointUrl: ENDPOINT,
      outcome: 'mcp',
      authChallenge: 'none',
      browserAccess: 'direct',
      detail: 'ok',
      ...overrides,
    });

    it('maps an open MCP endpoint to a public server', () => {
      const preflight = evaluateConnectorDirectoryPreflight(directoryPreflightObservationsFromSubmissionEvidence(evidence({})));
      expect(item(preflight, 'claude.remote-https').status).toBe('pass');
      expect(item(preflight, 'chatgpt.supported-authentication').status).toBe('pass');
      expect(item(preflight, 'claude.tool-title').status).toBe('unknown');
    });

    it('maps OAuth and bearer challenges', () => {
      const oauth = evaluateConnectorDirectoryPreflight(directoryPreflightObservationsFromSubmissionEvidence(
        evidence({ outcome: 'auth-challenge', authChallenge: 'oauth', authStatus: 401 })
      ));
      expect(item(oauth, 'claude.oauth-for-authenticated-services').status).toBe('pass');
      expect(item(oauth, 'claude.pkce-s256').status).toBe('unknown');
      const bearer = evaluateConnectorDirectoryPreflight(directoryPreflightObservationsFromSubmissionEvidence(
        evidence({ outcome: 'auth-challenge', authChallenge: 'bearer', authStatus: 401 })
      ));
      expect(item(bearer, 'chatgpt.supported-authentication').status).toBe('fail');
    });

    it('maps an unreachable endpoint', () => {
      const preflight = evaluateConnectorDirectoryPreflight(directoryPreflightObservationsFromSubmissionEvidence(
        evidence({ outcome: 'unreachable' })
      ));
      expect(item(preflight, 'claude.remote-https').status).toBe('fail');
    });
  });

  describe('serializers', () => {
    it('summarizes each directory and lists advisories for the CLI', () => {
      const lines = summarizeConnectorDirectoryPreflight(evaluateConnectorDirectoryPreflight(observations({
        tools: toolsFrom([fullyAnnotated('manage', {
          title: undefined,
          inputSchema: { type: 'object', properties: { action: { enum: ['get', 'update'] } } },
        })]),
      })));
      expect(lines[0]).toMatch(/^Claude Connectors Directory: \d+ pass, 1 fail, 0 unknown, \d+ manual review$/);
      expect(lines[1]).toMatch(/^ChatGPT Directory: /);
      expect(lines[2]).toBe('advisory: Tool may multiplex several operations behind one argument (manage)');
    });

    it('writes the method check outcome with its detail in Markdown and counts it in the CLI summary', () => {
      const preflight = evaluateConnectorDirectoryPreflight(observations({
        tools: toolsFrom([fullyAnnotated('api_request', {
          inputSchema: { type: 'object', maxProperties: 1, properties: { method: { enum: ['GET', 'POST'] } } },
        })]),
      }));
      const markdown = serializeConnectorDirectoryPreflightMarkdown(preflight);
      expect(markdown).toContain('- [Manual review] No catch-all tool mixing safe and unsafe HTTP methods');
      expect(markdown).toContain('  - Manual review needed: 1 tool could not be checked automatically');
      expect(markdown).toContain('  - api\\_request (/properties/method)');
      const claude = preflight.directories.find((entry) => entry.directory.id === 'claude')!;
      expect(summarizeConnectorDirectoryPreflight(preflight)[0])
        .toBe(`Claude Connectors Directory: ${claude.counts.pass} pass, 0 fail, ${claude.counts.unknown} unknown, ${claude.counts.manual} manual review`);
    });

    it('writes a Markdown section with source links and redacted observations', () => {
      const markdown = serializeConnectorDirectoryPreflightMarkdown(
        evaluateConnectorDirectoryPreflight(observations({ tools: toolsFrom([fullyAnnotated('secret_tool', { title: undefined })]) })),
        (value) => value.replace('secret_tool', '[redacted]')
      );
      expect(markdown).toContain('## Connector directory preflight');
      expect(markdown).toContain('### Claude Connectors Directory');
      expect(markdown).toContain('([source](https://claude.com/docs/connectors/building/review-criteria#provide-tool-annotations))');
      expect(markdown).toContain('- [Manual review] Published privacy policy');
      expect(markdown).not.toContain('secret_tool');
    });
  });
});
