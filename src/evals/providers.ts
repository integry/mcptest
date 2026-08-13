import type {
  EvalFixtureOutput,
  EvalProvider,
  EvalProviderId,
  EvalProviderRequest,
  ProviderObservation,
  ToolCallObservation,
} from './types';

const CREDENTIAL_PREFIX = 'mcptest.eval.credential.';

export const getSessionCredential = (
  provider: Exclude<EvalProviderId, 'fixture'>,
  storage: Pick<Storage, 'getItem'> = sessionStorage
): string => storage.getItem(`${CREDENTIAL_PREFIX}${provider}`) || '';

export const setSessionCredential = (
  provider: Exclude<EvalProviderId, 'fixture'>,
  value: string,
  storage: Pick<Storage, 'setItem' | 'removeItem'> = sessionStorage
): void => {
  if (value) storage.setItem(`${CREDENTIAL_PREFIX}${provider}`, value);
  else storage.removeItem(`${CREDENTIAL_PREFIX}${provider}`);
};

export const clearSessionCredentials = (
  storage: Pick<Storage, 'removeItem'> = sessionStorage
): void => {
  storage.removeItem(`${CREDENTIAL_PREFIX}openai`);
  storage.removeItem(`${CREDENTIAL_PREFIX}anthropic`);
};

const parseArguments = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
};

const promptFor = (request: EvalProviderRequest): string => {
  if (request.arm !== 'plain-context') return request.case.prompt;
  return `${request.case.prompt}\n\nUse this supplied context to answer. Do not claim that you called a tool:\n${JSON.stringify(request.case.toolReturnedData ?? null)}`;
};

const fixtureArguments = (request: EvalProviderRequest): Record<string, unknown> => Object.fromEntries(
  (request.case.argumentAssertions || [])
    .filter(assertion => assertion.operator === 'equals' && !assertion.path.includes('.'))
    .map(assertion => [assertion.path.replace(/^\$\.?/, ''), assertion.value])
);

const fixtureForTrial = (fixture: EvalFixtureOutput | EvalFixtureOutput[] | undefined, trial: number): EvalFixtureOutput | undefined => (
  Array.isArray(fixture) ? fixture[(trial - 1) % fixture.length] : fixture
);

export const createFixtureProvider = (): EvalProvider => ({
  id: 'fixture',
  async run(request) {
    const startedAt = performance.now();
    const configured = fixtureForTrial(request.case.fixture, request.trial);
    const defaultCalls: ToolCallObservation[] = request.arm === 'with-mcp'
      && !request.case.expectedNoTool
      && Boolean(request.case.acceptableTools?.[0])
      ? [{
          name: request.case.acceptableTools![0],
          arguments: fixtureArguments(request),
          result: request.case.toolReturnedData,
        }]
      : [];
    const calls = request.arm === 'with-mcp'
      ? (configured?.toolCalls || defaultCalls)
      : [];
    const contextFigures = request.case.expectedFigures || [];
    const finalAnswer = configured?.finalAnswer
      || (contextFigures.length ? `The checkable result is ${contextFigures.join(', ')}.` : 'Fixture response completed.');
    return {
      toolCalls: calls,
      finalAnswer,
      latencyMs: configured?.latencyMs ?? Math.max(1, performance.now() - startedAt),
      inputTokens: configured?.inputTokens ?? Math.ceil(request.case.prompt.length / 4),
      outputTokens: configured?.outputTokens ?? Math.ceil(finalAnswer.length / 4),
    };
  },
});

type FetchLike = typeof fetch;

const redactString = (value: string, secret: string): string => secret
  ? value.split(secret).join('[redacted]')
  : value;

export const redactCredential = <T>(value: T, secret: string): T => {
  if (!secret) return value;
  if (typeof value === 'string') return redactString(value, secret) as T;
  if (Array.isArray(value)) return value.map(item => redactCredential(item, secret)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      redactString(key, secret),
      redactCredential(child, secret),
    ])) as T;
  }
  return value;
};

const ensureResponse = async (response: Response, secret = ''): Promise<unknown> => {
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const nested = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : {};
    throw new Error(redactString(
      typeof nested.message === 'string' ? nested.message : `Provider request failed with HTTP ${response.status}.`,
      secret
    ));
  }
  return body;
};

export const createOpenAiProvider = (apiKey: string, fetcher: FetchLike = fetch): EvalProvider => ({
  id: 'openai',
  async run(request) {
    if (!apiKey.trim()) throw new Error('An OpenAI API key is required for this session.');
    const startedAt = performance.now();
    const tools = request.tools.map(tool => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
    }));
    const messages: Array<Record<string, unknown>> = [{ role: 'user', content: promptFor(request) }];
    const makeRequest = async () => (await ensureResponse(await fetcher('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: request.model, messages, ...(tools.length ? { tools, tool_choice: 'auto' } : {}) }),
    }), apiKey)) as Record<string, unknown>;
    const first = await makeRequest();
    const firstChoice = Array.isArray(first.choices) ? first.choices[0] as Record<string, unknown> : {};
    const message = firstChoice.message && typeof firstChoice.message === 'object' ? firstChoice.message as Record<string, unknown> : {};
    const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls as Array<Record<string, unknown>> : [];
    const calls: ToolCallObservation[] = rawCalls.map(call => {
      const fn = call.function && typeof call.function === 'object' ? call.function as Record<string, unknown> : {};
      return {
        name: String(fn.name || ''),
        arguments: parseArguments(fn.arguments),
        result: request.case.toolReturnedData,
      };
    });
    let finalAnswer = typeof message.content === 'string' ? message.content : undefined;
    let inputTokens = Number((first.usage as Record<string, unknown> | undefined)?.prompt_tokens || 0);
    let outputTokens = Number((first.usage as Record<string, unknown> | undefined)?.completion_tokens || 0);
    let followUpError: string | undefined;
    if (rawCalls.length && request.case.toolReturnedData !== undefined) {
      messages.push(message);
      rawCalls.forEach(call => messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(request.case.toolReturnedData),
      }));
      try {
        const second = await makeRequest();
        const secondChoice = Array.isArray(second.choices) ? second.choices[0] as Record<string, unknown> : {};
        const secondMessage = secondChoice.message && typeof secondChoice.message === 'object' ? secondChoice.message as Record<string, unknown> : {};
        finalAnswer = typeof secondMessage.content === 'string' ? secondMessage.content : finalAnswer;
        inputTokens += Number((second.usage as Record<string, unknown> | undefined)?.prompt_tokens || 0);
        outputTokens += Number((second.usage as Record<string, unknown> | undefined)?.completion_tokens || 0);
      } catch (error) {
        followUpError = error instanceof Error ? error.message : String(error);
      }
    }
    return redactCredential({
      toolCalls: calls,
      finalAnswer,
      latencyMs: performance.now() - startedAt,
      inputTokens,
      outputTokens,
      error: followUpError,
    }, apiKey);
  },
});

export const createAnthropicProvider = (apiKey: string, fetcher: FetchLike = fetch): EvalProvider => ({
  id: 'anthropic',
  async run(request) {
    if (!apiKey.trim()) throw new Error('An Anthropic API key is required for this session.');
    const startedAt = performance.now();
    const tools = request.tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }));
    const messages: Array<Record<string, unknown>> = [{ role: 'user', content: promptFor(request) }];
    const makeRequest = async () => (await ensureResponse(await fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: request.model, max_tokens: 1024, messages, ...(tools.length ? { tools } : {}) }),
    }), apiKey)) as Record<string, unknown>;
    const first = await makeRequest();
    const content = Array.isArray(first.content) ? first.content as Array<Record<string, unknown>> : [];
    const toolUses = content.filter(block => block.type === 'tool_use');
    const calls: ToolCallObservation[] = toolUses.map(block => ({
      name: String(block.name || ''),
      arguments: block.input,
      result: request.case.toolReturnedData,
    }));
    let finalAnswer = content.filter(block => block.type === 'text').map(block => String(block.text || '')).join('\n') || undefined;
    let inputTokens = Number((first.usage as Record<string, unknown> | undefined)?.input_tokens || 0);
    let outputTokens = Number((first.usage as Record<string, unknown> | undefined)?.output_tokens || 0);
    let followUpError: string | undefined;
    if (toolUses.length && request.case.toolReturnedData !== undefined) {
      messages.push({ role: 'assistant', content });
      messages.push({ role: 'user', content: toolUses.map(block => ({
        type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(request.case.toolReturnedData),
      })) });
      try {
        const second = await makeRequest();
        const secondContent = Array.isArray(second.content) ? second.content as Array<Record<string, unknown>> : [];
        finalAnswer = secondContent.filter(block => block.type === 'text').map(block => String(block.text || '')).join('\n') || finalAnswer;
        inputTokens += Number((second.usage as Record<string, unknown> | undefined)?.input_tokens || 0);
        outputTokens += Number((second.usage as Record<string, unknown> | undefined)?.output_tokens || 0);
      } catch (error) {
        followUpError = error instanceof Error ? error.message : String(error);
      }
    }
    return redactCredential({
      toolCalls: calls,
      finalAnswer,
      latencyMs: performance.now() - startedAt,
      inputTokens,
      outputTokens,
      error: followUpError,
    }, apiKey);
  },
});

export const createProvider = (provider: EvalProviderId, credential = '', fetcher: FetchLike = fetch): EvalProvider => {
  if (provider === 'openai') return createOpenAiProvider(credential, fetcher);
  if (provider === 'anthropic') return createAnthropicProvider(credential, fetcher);
  return createFixtureProvider();
};
