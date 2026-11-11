import { describe, expect, it } from 'vitest';
import { accessStateChanged, classifyBreakingChanges, type ToolSurfaceSnapshot } from './breakingChanges';
import { diffInterfaceSnapshots, type InterfaceSnapshot } from './reportDiff';

const surface = (tools: string[], authentication?: ToolSurfaceSnapshot['authentication']): ToolSurfaceSnapshot => ({
  tools: tools.map((name) => ({ name, inputSchema: { type: 'object' } })),
  outputSchemasObserved: false,
  annotationsObserved: false,
  titlesObserved: false,
  promptArgumentsObserved: false,
  ...(authentication ? { authentication } : {}),
});

const snapshot = (tools: string[], authentication?: InterfaceSnapshot['authentication']): InterfaceSnapshot => ({
  observedAt: '2026-11-11T00:00:00.000Z',
  source: 'report',
  tools: tools.map((name) => ({ name, inputSchemaFingerprint: 'fnv1a-32:00000000:2' })),
  outputSchemasObserved: false,
  ...(authentication ? { authentication } : {}),
});

describe('comparisons respect the recorded access state', () => {
  it('detects a change only when both listings recorded it', () => {
    expect(accessStateChanged({ authentication: 'authenticated' }, { authentication: 'unauthenticated' })).toBe(true);
    expect(accessStateChanged({ authentication: 'authenticated' }, { authentication: 'authenticated' })).toBe(false);
    expect(accessStateChanged({}, { authentication: 'unauthenticated' })).toBe(false);
  });

  it('does not classify a tool hidden from unauthenticated callers as a breaking removal', () => {
    const report = classifyBreakingChanges(surface(['search', 'admin'], 'authenticated'), surface(['search'], 'unauthenticated'));
    expect(report.hasBreakingChanges).toBe(false);
    expect(report.findings).toEqual([expect.objectContaining({ rule: 'tool-removed', severity: 'risky', subject: 'admin' })]);
    expect(report.findings[0].reason).toContain('access state changed');
    expect(report.limitations.join(' ')).toContain('compare listings obtained the same way');
  });

  it('still reports removals as breaking when the access state is the same or unknown', () => {
    expect(classifyBreakingChanges(surface(['search', 'admin'], 'authenticated'), surface(['search'], 'authenticated')).hasBreakingChanges).toBe(true);
    expect(classifyBreakingChanges(surface(['search', 'admin']), surface(['search'], 'unauthenticated')).hasBreakingChanges).toBe(true);
  });

  it('marks interface membership changes across an access change as not comparable', () => {
    const diff = diffInterfaceSnapshots(snapshot(['search', 'admin'], 'authenticated'), snapshot(['search', 'public'], 'unauthenticated'));
    expect(diff.hasBreakingChanges).toBe(false);
    expect(diff.changes.map(({ kind, classification }) => [kind, classification])).toEqual([
      ['tool-removed', 'unknown'],
      ['tool-added', 'unknown'],
    ]);
    expect(diffInterfaceSnapshots(snapshot(['search', 'admin'], 'authenticated'), snapshot(['search'], 'authenticated')).hasBreakingChanges).toBe(true);
  });
});
