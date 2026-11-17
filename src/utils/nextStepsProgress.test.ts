import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NEXT_STEPS_PROGRESS_EVENT,
  completeNextStep,
  dismissHint,
  isHintActive,
  readCompletedSteps,
  readDismissedHints,
  resetOnboardingMemory,
} from './nextStepsProgress';

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetOnboardingMemory();
  vi.restoreAllMocks();
});

describe('onboarding hint persistence', () => {
  it('shows a hint to a new visitor', () => {
    expect(isHintActive('pick-tool')).toBe(true);
    expect(isHintActive('share-report')).toBe(true);
  });

  it('remembers completed steps in localStorage, so a returning visitor sees no hint for them', () => {
    completeNextStep('tool');
    expect(JSON.parse(localStorage.getItem('mcptest-next-steps-completed')!)).toEqual(['tool']);
    resetOnboardingMemory();
    expect(isHintActive('pick-tool')).toBe(false);
    expect(isHintActive('share-report')).toBe(true);
    completeNextStep('report');
    expect(isHintActive('share-report')).toBe(false);
  });

  it('remembers a dismissed hint without completing its step', () => {
    dismissHint('pick-tool');
    expect(JSON.parse(localStorage.getItem('mcptest-onboarding-dismissed')!)).toEqual(['pick-tool']);
    expect(isHintActive('pick-tool')).toBe(false);
    expect(readCompletedSteps()).toEqual([]);
  });

  it('notifies listeners once per change', () => {
    const listener = vi.fn();
    window.addEventListener(NEXT_STEPS_PROGRESS_EVENT, listener);
    completeNextStep('tool');
    completeNextStep('tool');
    dismissHint('share-report');
    dismissHint('share-report');
    window.removeEventListener(NEXT_STEPS_PROGRESS_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('still counts progress recorded per session by earlier builds', () => {
    sessionStorage.setItem('mcptest-next-steps-completed', JSON.stringify(['tool']));
    expect(isHintActive('pick-tool')).toBe(false);
  });

  it('keeps working for this page when storage refuses writes', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => completeNextStep('tool')).not.toThrow();
    expect(() => dismissHint('share-report')).not.toThrow();
    expect(readCompletedSteps()).toContain('tool');
    expect(readDismissedHints()).toContain('share-report');
    expect(isHintActive('pick-tool')).toBe(false);
  });

  it('ignores corrupt stored values', () => {
    localStorage.setItem('mcptest-next-steps-completed', '{not json');
    localStorage.setItem('mcptest-onboarding-dismissed', JSON.stringify({ hint: 'pick-tool' }));
    expect(readCompletedSteps()).toEqual([]);
    expect(readDismissedHints()).toEqual([]);
  });
});
