import type { ToolSelectionDatasetV1 } from './types';

export const LOCAL_TOOL_SELECTION_FIXTURE: ToolSelectionDatasetV1 = {
  version: '1.0',
  id: 'local-weather-eval',
  name: 'Local tool-selection fixture',
  descriptionRevision: 'weather-descriptions-v1',
  schemaRevision: 'weather-schemas-v1',
  description: 'A deterministic dataset covering alternate tools, no-tool behavior, malformed arguments, and grounding.',
  tools: [
    {
      name: 'get_weather',
      description: 'Get current weather for a city.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { city: { type: 'string', minLength: 1 } },
        required: ['city'],
      },
    },
    {
      name: 'get_forecast',
      description: 'Get a weather forecast for a city.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { city: { type: 'string' }, days: { type: 'integer', minimum: 1, maximum: 10 } },
        required: ['city', 'days'],
      },
    },
    {
      name: 'search_docs',
      description: 'Search product documentation.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  ],
  cases: [
    {
      id: 'multiple-acceptable-tools',
      prompt: 'Will it rain in Lisbon tomorrow?',
      acceptableTools: ['get_weather', 'get_forecast'],
      forbiddenTools: ['search_docs'],
      argumentAssertions: [{ path: 'city', operator: 'equals', value: 'Lisbon' }],
      tags: ['selection', 'multiple-acceptable'],
      toolReturnedData: { city: 'Lisbon', rainChancePercent: 32 },
      expectedFigures: [32],
      fixture: {
        toolCalls: [{ name: 'get_forecast', arguments: { city: 'Lisbon', days: 1 }, result: { rainChancePercent: 32 } }],
        finalAnswer: 'The chance of rain is 32%.',
        latencyMs: 42,
        inputTokens: 40,
        outputTokens: 12,
      },
    },
    {
      id: 'expected-no-tool',
      prompt: 'Say hello in Spanish.',
      expectedNoTool: true,
      forbiddenTools: ['get_weather', 'get_forecast', 'search_docs'],
      tags: ['no-tool'],
      fixture: { finalAnswer: 'Hola.', latencyMs: 18, inputTokens: 8, outputTokens: 2 },
    },
    {
      id: 'malformed-arguments',
      prompt: 'Give me a three-day forecast for Oslo.',
      acceptableTools: ['get_forecast'],
      forbiddenTools: ['get_weather', 'search_docs'],
      argumentAssertions: [
        { path: 'city', operator: 'equals', value: 'Oslo' },
        { path: 'days', operator: 'equals', value: 3 },
      ],
      tags: ['schema', 'negative-fixture'],
      notes: 'The local provider intentionally returns malformed arguments so schema scoring can be verified.',
      fixture: {
        toolCalls: [{ name: 'get_forecast', arguments: { city: 'Oslo', days: 'three' } }],
        finalAnswer: 'Fixture returned malformed arguments.',
        latencyMs: 27,
        inputTokens: 14,
        outputTokens: 6,
      },
    },
  ],
};

export const LOCAL_TOOL_SELECTION_FIXTURE_JSON = JSON.stringify(LOCAL_TOOL_SELECTION_FIXTURE, null, 2);
