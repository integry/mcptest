import { describe, expect, it } from 'vitest';
import {
  createTestedServerHistoryEntry,
  getTestedServerResultLabel,
  upsertTestedServerHistoryEntry,
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

  it.each([
    ['partial', 'Partial evaluation - not scored'],
    ['failed', 'Evaluation failed - not scored'],
  ] as const)('stores a %s evaluation without an overall score', (outcome, label) => {
    const entry = createTestedServerHistoryEntry({
      serverUrl: 'https://mcp.example/mcp',
      outcome,
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
    }, 789);

    expect(entry).toEqual({
      url: 'https://mcp.example/mcp',
      score: null,
      timestamp: 789,
      outcome,
    });
    expect(getTestedServerResultLabel(entry)).toBe(label);
  });

  it('continues to score legacy reports without an explicit outcome', () => {
    const entry = createTestedServerHistoryEntry({
      serverUrl: 'https://legacy.example/mcp',
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
    }, 999);

    expect(entry).toMatchObject({ score: 50, outcome: 'scored' });
  });

  it('replaces legacy raw URLs with the normalized authorization-required entry', () => {
    const legacyEntry = {
      url: 'mcp.example',
      score: 92,
      timestamp: 100,
    };
    const authorizationEntry = {
      url: 'https://mcp.example/',
      score: null,
      timestamp: 200,
      outcome: 'authorization-required' as const,
    };

    expect(upsertTestedServerHistoryEntry([legacyEntry], authorizationEntry)).toEqual([
      authorizationEntry,
    ]);
  });

  it('uses a safe string identity for malformed legacy URLs', () => {
    const staleEntry = { url: ' invalid url ', score: 70, timestamp: 100 };
    const replacement = { url: 'invalid url', score: null, timestamp: 200 };

    expect(upsertTestedServerHistoryEntry([staleEntry], replacement)).toEqual([replacement]);
  });
});
