import { describe, expect, it } from 'vitest';
import {
  createTestedServerHistoryEntry,
  getTestedServerResultLabel,
} from './reportPresentation';

describe('report presentation', () => {
  it('stores an OAuth-gated evaluation as not scored', () => {
    const entry = createTestedServerHistoryEntry({
      serverUrl: 'https://mcp.example/mcp',
      authenticationUrl: 'https://mcp.example/mcp',
      outcome: 'authorization-required',
      finalScore: 0,
      sections: {
        auth: {
          name: 'Authorization Required',
          description: '',
          score: 0,
          maxScore: 0,
          details: [],
        },
      },
    }, 123);

    expect(entry).toEqual({
      url: 'https://mcp.example/mcp',
      score: null,
      timestamp: 123,
      outcome: 'authorization-required',
    });
    expect(getTestedServerResultLabel(entry)).toBe('Authorization required - not scored');
  });

  it('keeps a completed evaluation score in history', () => {
    const entry = createTestedServerHistoryEntry({
      serverUrl: 'https://mcp.example/mcp',
      outcome: 'scored',
      finalScore: 35,
      sections: {
        protocol: {
          name: 'Protocol',
          description: '',
          score: 35,
          maxScore: 70,
          details: [],
        },
      },
    }, 456);

    expect(entry.score).toBe(50);
    expect(getTestedServerResultLabel(entry)).toBe('Score: 50%');
  });
});
