// @vitest-environment node
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('root TypeScript tooling compatibility', () => {
  it('provides the JavaScript compiler API used by article example tests', () => {
    const ts = require('typescript');
    const result = ts.transpileModule('const value: number = 42; return value;', {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    });
    expect(result.diagnostics).toEqual([]);
    expect(new Function(result.outputText)()).toBe(42);
  });

  it('keeps the classic language server available during the TS 6 transition', () => {
    expect(existsSync(require.resolve('typescript/lib/tsserver.js'))).toBe(true);
    const bin = require('typescript/package.json').bin.tsserver;
    expect(typeof bin).toBe('string');
    expect(existsSync(require.resolve(`typescript/${bin}`))).toBe(true);
  });
});
