import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { getRunnableCases, parseDataset, suggestCases, validateDataset } from './dataset';
import { LOCAL_TOOL_SELECTION_FIXTURE } from './fixtures';

const publicSchema = JSON.parse(readFileSync(resolve('public/schemas/tool-selection-eval/v1.schema.json'), 'utf8'));
const validatePublicSchema = new Ajv2020({ strict: false }).compile(publicSchema);

describe('versioned eval datasets', () => {
  it('validates the local version 1 fixture', () => {
    expect(validateDataset(LOCAL_TOOL_SELECTION_FIXTURE)).toMatchObject({ valid: true, errors: [] });
    expect(parseDataset(JSON.stringify(LOCAL_TOOL_SELECTION_FIXTURE)).id).toBe('local-weather-eval');
  });

  it('publishes a JSON Schema that accepts the local fixture and reviewed suggestions', () => {
    const suggestion = { ...suggestCases(LOCAL_TOOL_SELECTION_FIXTURE)[0], reviewStatus: 'approved' as const };
    expect(validatePublicSchema({ ...LOCAL_TOOL_SELECTION_FIXTURE, suggestions: [suggestion] }), validatePublicSchema.errors?.map(error => error.message).join(', ')).toBe(true);
  });

  it('keeps runtime structural validation in parity with the published schema', () => {
    const validSuggestion = { ...suggestCases(LOCAL_TOOL_SELECTION_FIXTURE)[0], reviewStatus: 'approved' as const };
    const structures: unknown[] = [
      LOCAL_TOOL_SELECTION_FIXTURE,
      { ...LOCAL_TOOL_SELECTION_FIXTURE, suggestions: [validSuggestion] },
      { ...LOCAL_TOOL_SELECTION_FIXTURE, unknownProperty: true },
      { ...LOCAL_TOOL_SELECTION_FIXTURE, cases: [{ ...LOCAL_TOOL_SELECTION_FIXTURE.cases[0], tags: ['valid', 3] }] },
      { ...LOCAL_TOOL_SELECTION_FIXTURE, cases: [{ ...LOCAL_TOOL_SELECTION_FIXTURE.cases[0], expectedFigures: [true] }] },
      { ...LOCAL_TOOL_SELECTION_FIXTURE, cases: [{ ...LOCAL_TOOL_SELECTION_FIXTURE.cases[0], fixture: [] }] },
      { ...LOCAL_TOOL_SELECTION_FIXTURE, cases: [{ ...LOCAL_TOOL_SELECTION_FIXTURE.cases[0], fixture: { finalAnswer: 42 } }] },
      { ...LOCAL_TOOL_SELECTION_FIXTURE, cases: [{ ...LOCAL_TOOL_SELECTION_FIXTURE.cases[0], argumentAssertions: [{ path: 'city', operator: 'equals' }] }] },
    ];

    structures.forEach(structure => {
      const publishedValid = validatePublicSchema(structure);
      expect(validateDataset(structure).valid).toBe(publishedValid);
    });
  });

  it('rejects unsupported versions and contradictory expectations', () => {
    const result = validateDataset({
      ...LOCAL_TOOL_SELECTION_FIXTURE,
      version: '2.0',
      cases: [{ id: 'bad', prompt: 'Bad', expectedNoTool: true, acceptableTools: ['get_weather'] }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('Unsupported dataset version');
    expect(result.errors.join(' ')).toContain('cannot expect no tool');
  });

  it('requires synthetic suggestions to be reviewed before they run', () => {
    const suggestions = suggestCases(LOCAL_TOOL_SELECTION_FIXTURE);
    const dataset = { ...LOCAL_TOOL_SELECTION_FIXTURE, suggestions };
    expect(getRunnableCases(dataset)).toHaveLength(LOCAL_TOOL_SELECTION_FIXTURE.cases.length);
    suggestions[0] = { ...suggestions[0], reviewStatus: 'approved' };
    expect(getRunnableCases({ ...dataset, suggestions })).toHaveLength(LOCAL_TOOL_SELECTION_FIXTURE.cases.length + 1);
  });
});
