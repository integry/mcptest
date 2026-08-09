import { describe, expect, it } from 'vitest';
import { classifySavedCardAuthenticationFailure } from './App';

describe('saved card authentication failures', () => {
  it('does not request OAuth for a direct JSON-RPC Forbidden application error', () => {
    const error = new Error('MCP error -32000: Forbidden operation');

    expect(classifySavedCardAuthenticationFailure(error, false)).toBeUndefined();
  });
});
