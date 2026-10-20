import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OUTPUT_CONTRACT_FINDING_ID,
  checkToolOutputContract,
  clearRecordedOutputContractResults,
  getRecordedOutputContractResults,
  recordOutputContractResult,
  summarizeOutputContracts,
  validateAgainstOutputSchema,
  withoutOutputSchema,
} from './outputContract';

const weatherSchema = {
  type: 'object',
  properties: {
    city: { type: 'string' },
    temperature: { type: 'number' },
    unit: { enum: ['C', 'F'] },
    readings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { at: { type: 'string' }, value: { type: 'number' } },
        required: ['at', 'value'],
        additionalProperties: false,
      },
    },
  },
  required: ['city', 'temperature'],
  additionalProperties: false,
};

const weatherTool = { name: 'get_weather', outputSchema: weatherSchema };

const callResult = (structuredContent?: unknown, extra: Record<string, unknown> = {}) => ({
  content: [{ type: 'text', text: 'ok' }],
  ...(structuredContent !== undefined ? { structuredContent } : {}),
  ...extra,
});

describe('output contract validation', () => {
  afterEach(() => clearRecordedOutputContractResults());

  it('passes structured content that matches the declared schema', () => {
    const contract = checkToolOutputContract(weatherTool, callResult({
      city: 'Oslo',
      temperature: 4,
      unit: 'C',
      readings: [{ at: '09:00', value: 3.5 }],
    }));

    expect(contract).toEqual({
      toolName: 'get_weather',
      status: 'pass',
      violations: [],
      hasStructuredContent: true,
      isError: false,
    });
  });

  it('lists each violation once with a readable path and message', () => {
    const contract = checkToolOutputContract(weatherTool, callResult({
      temperature: 'warm',
      unit: 'K',
      readings: [{ at: '09:00', value: 'high' }, { at: '10:00', note: 'x' }],
      source: 'sensor',
    }));

    expect(contract.status).toBe('fail');
    expect(contract.violations).toEqual([
      { path: 'structuredContent.city', message: 'Required property "city" is missing.' },
      { path: 'structuredContent.temperature', message: 'Expected number but got string.' },
      { path: 'structuredContent.unit', message: 'Value is not one of the allowed values ["C","F"].' },
      { path: 'structuredContent.readings[0].value', message: 'Expected number but got string.' },
      { path: 'structuredContent.readings[1].value', message: 'Required property "value" is missing.' },
      { path: 'structuredContent.readings[1].note', message: 'Property "note" is not allowed by the schema.' },
      { path: 'structuredContent.source', message: 'Property "source" is not allowed by the schema.' },
    ]);
  });

  it('flags a declared schema without structuredContent as a contract violation', () => {
    const contract = checkToolOutputContract(weatherTool, callResult());

    expect(contract.status).toBe('fail');
    expect(contract.hasStructuredContent).toBe(false);
    expect(contract.violations).toHaveLength(1);
    expect(contract.violations[0].path).toBe('structuredContent');
    expect(contract.violations[0].message).toMatch(/declares an outputSchema but returned no structuredContent/);
  });

  it('gives no verdict when the tool declares no schema', () => {
    const contract = checkToolOutputContract({ name: 'free_form' }, callResult({ anything: true }));

    expect(contract.status).toBe('no-schema');
    expect(contract.hasStructuredContent).toBe(true);
    expect(contract.violations).toEqual([]);
  });

  it('does not judge error results against the output schema', () => {
    const contract = checkToolOutputContract(weatherTool, callResult(undefined, { isError: true }));

    expect(contract.status).toBe('not-checked');
    expect(contract.isError).toBe(true);
  });

  it('reports an unusable schema instead of throwing', () => {
    const outcome = validateAgainstOutputSchema({ $ref: '#/$defs/missing' }, {});

    expect(outcome.valid).toBe(false);
    expect(outcome.violations[0]).toMatchObject({ path: '(schema)' });
    expect(outcome.violations[0].message).toMatch(/could not be used/);
  });

  it('follows local $ref and explains a failed anyOf in one sentence', () => {
    const outcome = validateAgainstOutputSchema({
      $defs: { id: { anyOf: [{ type: 'string' }, { type: 'integer' }] } },
      type: 'object',
      properties: { id: { $ref: '#/$defs/id' } },
    }, { id: true });

    expect(outcome.violations).toEqual([
      { path: 'structuredContent.id', message: 'Value does not match any subschemas.' },
    ]);
  });

  it('quotes property names that are not identifiers', () => {
    const outcome = validateAgainstOutputSchema({
      type: 'object',
      properties: { 'a/b c': { type: 'string' } },
    }, { 'a/b c': 1 });

    expect(outcome.violations).toEqual([
      { path: 'structuredContent["a/b c"]', message: 'Expected string but got number.' },
    ]);
  });

  it('ignores draft-07 conditionals in a schema that declares draft-06', () => {
    const conditional = {
      type: 'object',
      if: { required: ['x'] },
      then: { required: ['y'] },
    };
    const draft06 = { $schema: 'http://json-schema.org/draft-06/schema#', ...conditional };

    expect(checkToolOutputContract({ name: 'draft06', outputSchema: draft06 }, callResult({ x: 1 })))
      .toMatchObject({ status: 'pass', violations: [] });
    // Draft-07 still applies them.
    const draft07 = { $schema: 'http://json-schema.org/draft-07/schema#', ...conditional };
    const draft07Contract = checkToolOutputContract({ name: 'draft07', outputSchema: draft07 }, callResult({ x: 1 }));
    expect(draft07Contract.status).toBe('fail');
    expect(draft07Contract.violations).toContainEqual({
      path: 'structuredContent.y', message: 'Required property "y" is missing.',
    });
  });

  it('removes newer keywords from nested subschemas and keeps properties that share their names', () => {
    const outcome = validateAgainstOutputSchema({
      $schema: 'http://json-schema.org/draft-06/schema#',
      type: 'object',
      properties: {
        if: { type: 'string' },
        nested: { $ref: '#/definitions/conditional' },
        list: { type: 'array', items: [{ if: { type: 'number' }, then: { minimum: 10 } }] },
      },
      required: ['if'],
      definitions: { conditional: { if: { required: ['a'] }, then: { required: ['b'] } } },
    }, { if: 'kept', nested: { a: 1 }, list: [1] });

    expect(outcome).toEqual({ valid: true, violations: [] });
    expect(validateAgainstOutputSchema({
      $schema: 'http://json-schema.org/draft-06/schema#',
      type: 'object',
      properties: { if: { type: 'string' } },
      required: ['if'],
    }, { if: 1 }).violations).toEqual([
      { path: 'structuredContent.if', message: 'Expected string but got number.' },
    ]);
  });

  it.each([
    ['draft-04 const', { $schema: 'http://json-schema.org/draft-04/schema#', const: 1 }, 2],
    ['draft-04 conditionals', {
      $schema: 'http://json-schema.org/draft-04/schema#', if: { required: ['x'] }, then: { required: ['y'] },
    }, { x: 1 }],
    ['draft-06 date format', { $schema: 'http://json-schema.org/draft-06/schema#', format: 'date' }, 'soon'],
    ['draft-07 unevaluatedProperties', {
      $schema: 'http://json-schema.org/draft-07/schema#', properties: { a: {} }, unevaluatedProperties: false,
    }, { a: 1, b: 2 }],
    ['draft-07 dependentRequired', {
      $schema: 'http://json-schema.org/draft-07/schema#', dependentRequired: { a: ['b'] },
    }, { a: 1 }],
    ['2019-09 prefixItems', {
      $schema: 'https://json-schema.org/draft/2019-09/schema', prefixItems: [{ type: 'string' }],
    }, [1]],
  ])('does not enforce keywords newer than the declared dialect: %s', (_label, schema, value) => {
    expect(validateAgainstOutputSchema(schema, value)).toEqual({ valid: true, violations: [] });
  });

  it('still enforces those keywords when no dialect is declared', () => {
    expect(validateAgainstOutputSchema({ if: { required: ['x'] }, then: { required: ['y'] } }, { x: 1 }).valid)
      .toBe(false);
    expect(validateAgainstOutputSchema({ const: 1 }, 2).valid).toBe(false);
  });

  it('removes only the outputSchema from a tool definition', () => {
    const tool = { name: 'x', inputSchema: { type: 'object' }, outputSchema: { type: 'object' } };

    expect(withoutOutputSchema(tool)).toEqual({ name: 'x', inputSchema: { type: 'object' } });
    expect(tool.outputSchema).toEqual({ type: 'object' });
  });
});

describe('CSP-safe validation', () => {
  const guardCodeGeneration = <T,>(run: () => T): T => {
    const originalFunction = globalThis.Function;
    const originalEval = globalThis.eval;
    const blocked = () => {
      throw new EvalError('Refused to evaluate a string as JavaScript (CSP without unsafe-eval).');
    };
    globalThis.Function = new Proxy(originalFunction, { apply: blocked, construct: blocked });
    globalThis.eval = blocked as typeof eval;
    try {
      return run();
    } finally {
      globalThis.Function = originalFunction;
      globalThis.eval = originalEval;
    }
  };

  it('validates without the Function constructor or eval', () => {
    const outcome = guardCodeGeneration(() => [
      validateAgainstOutputSchema(weatherSchema, { city: 'Oslo', temperature: 4 }),
      validateAgainstOutputSchema(weatherSchema, { city: 1 }),
    ]);

    expect(outcome[0].valid).toBe(true);
    expect(outcome[1].valid).toBe(false);
  });

  it('detects code generation, as a control: Ajv compilation is refused by the same guard', () => {
    const ajv = new Ajv2020({ strict: false, logger: false });

    expect(() => guardCodeGeneration(() => ajv.compile(weatherSchema))).toThrow(/unsafe-eval/);
  });

  it('ships a validator build that contains no runtime code generation', () => {
    const require = createRequire(import.meta.url);
    const packageDir = dirname(require.resolve('@cfworker/json-schema/package.json'));
    const esmDir = join(packageDir, 'dist', 'esm');
    const source = readdirSync(esmDir)
      .filter(file => file.endsWith('.js'))
      .map(file => readFileSync(join(esmDir, file), 'utf8'))
      .join('\n');

    expect(source.length).toBeGreaterThan(0);
    expect(source).not.toMatch(/new\s+Function\s*\(/);
    expect(source).not.toMatch(/\beval\s*\(/);
  });

  it('keeps the page CSP without unsafe-eval', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];

    expect(csp).toBeDefined();
    expect(csp).toMatch(/script-src /);
    expect(csp).not.toMatch(/unsafe-eval/);
  });
});

describe('recorded contract results', () => {
  afterEach(() => clearRecordedOutputContractResults());

  it('keeps the latest verdict per tool for the same server', () => {
    recordOutputContractResult('mcp.example.com/mcp', checkToolOutputContract(weatherTool, callResult({ city: 1 })));
    recordOutputContractResult('https://mcp.example.com/mcp', checkToolOutputContract(weatherTool, callResult({ city: 'Oslo', temperature: 1 })));
    recordOutputContractResult('https://mcp.example.com/mcp', checkToolOutputContract({ name: 'free' }, callResult({})));

    const recorded = getRecordedOutputContractResults('https://mcp.example.com/mcp');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ toolName: 'get_weather', status: 'pass' });
    expect(getRecordedOutputContractResults('https://other.example/mcp')).toEqual([]);
  });

  it('forgets only the tool whose schema was removed and keeps verdicts across error results', () => {
    const otherTool = { ...weatherTool, name: 'get_forecast' };
    recordOutputContractResult('https://mcp.example.com/mcp', checkToolOutputContract(weatherTool, callResult({ city: 1 })));
    recordOutputContractResult('https://mcp.example.com/mcp', checkToolOutputContract(otherTool, callResult({ city: 1 })));
    recordOutputContractResult('https://mcp.example.com/mcp', checkToolOutputContract(otherTool, { content: [], isError: true }));
    recordOutputContractResult('mcp.example.com/mcp', checkToolOutputContract({ name: 'get_weather' }, callResult({ city: 1 })));

    expect(getRecordedOutputContractResults('https://mcp.example.com/mcp')).toMatchObject([
      { toolName: 'get_forecast', status: 'fail' },
    ]);
  });

  it('summarizes passing and violating tools for the evaluator', () => {
    const summary = summarizeOutputContracts([
      checkToolOutputContract(weatherTool, callResult({ city: 'Oslo', temperature: 1 })),
      checkToolOutputContract({ name: 'broken', outputSchema: { type: 'object', required: ['a', 'b', 'c', 'd', 'e', 'f'] } }, callResult({})),
      checkToolOutputContract({ name: 'free' }, callResult({})),
    ]);

    expect(summary).toMatchObject({
      checkedToolCount: 2,
      passingTools: ['get_weather'],
      violatingTools: [{ toolName: 'broken', omittedViolationCount: 1 }],
    });
    expect(summary?.violatingTools[0].violations).toHaveLength(5);
    expect(summarizeOutputContracts([])).toBeUndefined();
    expect(OUTPUT_CONTRACT_FINDING_ID).toBe('tool.output-contract-violation');
  });
});
