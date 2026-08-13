import { describe, expect, it, vi } from 'vitest';
import { createAnthropicProvider, createOpenAiProvider } from './providers';
import type { EvalProviderRequest } from './types';

const request: EvalProviderRequest = {
  case: {
    id: 'weather',
    prompt: 'Weather in Lisbon?',
    acceptableTools: ['get_weather'],
    toolReturnedData: { temperature: 21 },
    expectedFigures: [21],
  },
  tools: [{
    name: 'get_weather',
    description: 'Get weather.',
    inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  }],
  arm: 'with-mcp',
  model: 'provider-model',
  trial: 1,
};

describe('browser model providers', () => {
  it('normalizes OpenAI tool calls and completes a tool-result turn', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Lisbon"}' } }] } }],
        usage: { prompt_tokens: 20, completion_tokens: 8 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'It is 21 degrees.' } }],
        usage: { prompt_tokens: 30, completion_tokens: 7 },
      }), { status: 200 }));

    const result = await createOpenAiProvider('session-secret', fetcher as typeof fetch).run(request);
    expect(result).toMatchObject({
      toolCalls: [{ name: 'get_weather', arguments: { city: 'Lisbon' }, result: { temperature: 21 } }],
      finalAnswer: 'It is 21 degrees.', inputTokens: 50, outputTokens: 15,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const firstInit = fetcher.mock.calls[0][1] as RequestInit;
    expect(new Headers(firstInit.headers).get('authorization')).toBe('Bearer session-secret');
    expect(String(firstInit.body)).not.toContain('session-secret');
    const secondBody = JSON.parse(String((fetcher.mock.calls[1][1] as RequestInit).body));
    expect(secondBody.messages).toContainEqual(expect.objectContaining({ role: 'tool', content: '{"temperature":21}' }));
  });

  it('normalizes Anthropic tool calls and completes a tool-result turn', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        content: [{ type: 'tool_use', id: 'tool-1', name: 'get_weather', input: { city: 'Lisbon' } }],
        usage: { input_tokens: 18, output_tokens: 6 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        content: [{ type: 'text', text: 'The temperature is 21.' }],
        usage: { input_tokens: 22, output_tokens: 7 },
      }), { status: 200 }));

    const result = await createAnthropicProvider('session-secret', fetcher as typeof fetch).run(request);
    expect(result).toMatchObject({
      toolCalls: [{ name: 'get_weather', arguments: { city: 'Lisbon' }, result: { temperature: 21 } }],
      finalAnswer: 'The temperature is 21.', inputTokens: 40, outputTokens: 13,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const headers = new Headers((fetcher.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get('x-api-key')).toBe('session-secret');
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
  });

  it('omits tools in the plain-context arm and includes supplied data in the prompt', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: '21 degrees.' } }],
      usage: {},
    }), { status: 200 }));
    await createOpenAiProvider('key', fetcher as typeof fetch).run({ ...request, arm: 'plain-context', tools: [] });
    const body = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body));
    expect(body.tools).toBeUndefined();
    expect(body.messages[0].content).toContain('{"temperature":21}');
    expect(body.messages[0].content).toContain('Do not claim that you called a tool');
  });

  it('redacts a credential if a provider reflects it in an error or answer', async () => {
    const secret = 'reflected-secret';
    const errorFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: `Invalid key ${secret}` },
    }), { status: 401 }));
    await expect(createOpenAiProvider(secret, errorFetch as typeof fetch).run({ ...request, case: { ...request.case, toolReturnedData: undefined } }))
      .rejects.toThrow('Invalid key [redacted]');

    const answerFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: `Never show ${secret}` } }],
      usage: {},
    }), { status: 200 }));
    const result = await createOpenAiProvider(secret, answerFetch as typeof fetch).run({
      ...request,
      tools: [],
      arm: 'without-mcp',
      case: { ...request.case, toolReturnedData: undefined },
    });
    expect(result.finalAnswer).toBe('Never show [redacted]');
  });

  it('recursively redacts reflected credentials in provider tool calls', async () => {
    const secret = 'reflected-tool-secret';
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: { name: `tool-${secret}`, arguments: JSON.stringify({ value: secret, nested: { [secret]: secret } }) },
        }],
      } }],
      usage: {},
    }), { status: 200 }));

    const result = await createOpenAiProvider(secret, fetcher as typeof fetch).run({
      ...request,
      case: { ...request.case, toolReturnedData: undefined },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.toolCalls[0].name).toBe('tool-[redacted]');
    expect(result.toolCalls[0].arguments).toEqual({ value: '[redacted]', nested: { '[redacted]': '[redacted]' } });
  });

  it('rejects reflected property names that collide after credential redaction', async () => {
    const secret = 'reflected-key';
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: {
            name: 'get_weather',
            arguments: JSON.stringify({ [secret]: 'credential key', '[redacted]': 'existing key' }),
          },
        }],
      } }],
      usage: {},
    }), { status: 200 }));

    await expect(createOpenAiProvider(secret, fetcher as typeof fetch).run({
      ...request,
      case: { ...request.case, toolReturnedData: undefined },
    })).rejects.toThrow('duplicate property names');
  });

  it('preserves first-turn tool calls when optional grounding follow-ups fail', async () => {
    const secret = 'follow-up-secret';
    const openAiFetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Lisbon"}' } }] } }],
        usage: { prompt_tokens: 20, completion_tokens: 8 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: `Failed ${secret}` } }), { status: 500 }));
    const openAiResult = await createOpenAiProvider(secret, openAiFetcher as typeof fetch).run(request);
    expect(openAiResult).toMatchObject({
      toolCalls: [{ name: 'get_weather', arguments: { city: 'Lisbon' } }],
      inputTokens: 20,
      outputTokens: 8,
      error: 'Failed [redacted]',
    });

    const anthropicFetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        content: [{ type: 'tool_use', id: 'tool-1', name: 'get_weather', input: { city: 'Lisbon' } }],
        usage: { input_tokens: 18, output_tokens: 6 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: `Failed ${secret}` } }), { status: 500 }));
    const anthropicResult = await createAnthropicProvider(secret, anthropicFetcher as typeof fetch).run(request);
    expect(anthropicResult).toMatchObject({
      toolCalls: [{ name: 'get_weather', arguments: { city: 'Lisbon' } }],
      inputTokens: 18,
      outputTokens: 6,
      error: 'Failed [redacted]',
    });
  });
});
