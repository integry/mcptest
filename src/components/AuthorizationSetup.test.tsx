import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getAuthorizationGuidanceForEndpoint } from '../utils/authorizationGuidanceLookup';
import AuthorizationSetup from './AuthorizationSetup';

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('AuthorizationSetup callback copying', () => {
  it('announces the selectable-text fallback when the Clipboard API is absent', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
      <AuthorizationSetup
        guidance={getAuthorizationGuidanceForEndpoint('https://mcp.asana.com/v2/mcp')}
      />
    ));

    const callback = container.querySelector('.authorization-callback code');
    const copyButton = container.querySelector<HTMLButtonElement>('.authorization-callback button');
    await act(async () => copyButton?.click());

    expect(callback?.textContent).toBe('https://mcptest.io/oauth/callback');
    expect(container.querySelector('[role="status"]')?.textContent)
      .toBe('Clipboard access is unavailable; select and copy the callback URI manually.');
    expect(container.querySelector('[role="status"]')?.textContent)
      .not.toContain('Callback URI copied');
  });
});
