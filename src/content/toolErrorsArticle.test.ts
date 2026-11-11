// @vitest-environment node
// Vite's Oxc transformer needs Node.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformWithOxc } from 'vite';
import { describe, expect, it } from 'vitest';

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
type Handler = (args: Record<string, unknown>, ctx?: unknown) => Promise<ToolResult>;

const article = readFileSync(resolve('src/content/articles/mcp-tool-errors-agents-can-act-on.md'), 'utf8');
const samples = [...article.matchAll(/```typescript\n([\s\S]*?)```/g)].map(([, code]) => code);
const SECRET = 's3cr3t-TOKEN';

function handlerSource(sample: string): string {
  const source = sample.match(/^( +)async \(\{[^}]*\}(?:, ctx)?\) => \{\n[\s\S]*?^\1\}$/m)?.[0];
  if (!source) throw new Error('tool errors article sample no longer contains a registerTool handler');
  return source;
}

// Compiles the handler with the sample's free variables bound to the given stubs.
async function loadHandler(source: string, scope: Record<string, unknown>): Promise<Handler> {
  const { code } = await transformWithOxc(`const handler = ${source.trim()};`, 'handler.ts', { target: 'es2022' });
  const names = Object.keys(scope);
  return new Function(...names, `${code}\nreturn handler;`)(...names.map((name) => scope[name])) as Handler;
}

function logRecorder() {
  const refs: string[] = [];
  return { refs, logError: (ref: string) => void refs.push(ref) };
}

function expectSanitized(result: ToolResult, refs: string[]) {
  const text = result.content.map((part) => part.text).join('\n');
  expect(result.isError).toBe(true);
  expect(text).not.toContain(SECRET);
  expect(refs).toHaveLength(1);
  expect(text).toContain(refs[0]);
}

describe('tool errors article: unexpected exceptions stay in server logs', () => {
  it('search-issues returns a generic isError result with a reference for an unexpected upstream failure', async () => {
    const sample = samples.find((code) => code.includes("'search-issues'"));
    if (!sample) throw new Error('search-issues sample missing');
    const toolErrorSource = sample.match(/^const toolError = .*;$/m)?.[0];
    if (!toolErrorSource) throw new Error('toolError helper missing');
    const { code: toolErrorJs } = await transformWithOxc(toolErrorSource, 'toolError.ts', { target: 'es2022' });
    const toolError = new Function(`${toolErrorJs}\nreturn toolError;`)();

    const log = logRecorder();
    const handler = await loadHandler(handlerSource(sample), {
      UpstreamError: class UpstreamError extends Error {},
      toolError,
      randomUUID: () => 'ref-0001',
      logError: log.logError,
      trackerSearch: async () => {
        throw new Error(`GET https://bot:${SECRET}@tracker.internal/api failed: ECONNRESET`);
      },
    });

    expectSanitized(await handler({ query: 'login bug', status: 'open' }), log.refs);
  });

  it.each([
    ['the permission check', 'mayCloseIssue'],
    ['the write', 'closeIssue'],
  ])('close-issue returns a generic isError result when %s throws', async (_label, failing) => {
    const sample = samples.find((code) => code.includes("'close-issue'"));
    if (!sample) throw new Error('close-issue sample missing');
    const fail = async () => {
      throw new Error(`pg: password ${SECRET} rejected for admin@10.0.0.5`);
    };
    const log = logRecorder();
    const handler = await loadHandler(handlerSource(sample), {
      randomUUID: () => 'ref-0002',
      logError: log.logError,
      mayCloseIssue: failing === 'mayCloseIssue' ? fail : async () => true,
      closeIssue: failing === 'closeIssue' ? fail : async () => {},
    });

    const ctx = { http: { authInfo: { token: 't', clientId: 'c', scopes: ['issues:write'] } } };
    expectSanitized(await handler({ id: 'ISS-12' }, ctx), log.refs);
  });
});
