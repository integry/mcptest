/**
 * The one store for first-run guidance: which next steps the visitor has
 * completed and which hints they dismissed. Both are remembered in
 * localStorage so a returning visitor who already called a tool or ran the
 * report never sees those hints again. Storage failures degrade to the
 * current page only and never block the UI.
 */
export const NEXT_STEPS_PROGRESS_EVENT = 'mcptest:next-step-completed';

const completedKey = 'mcptest-next-steps-completed';
const dismissedHintsKey = 'mcptest-onboarding-dismissed';

export type NextStep = 'tool' | 'report' | 'badge' | 'watch' | 'ci';
/** Inline hints in the connected view. Each one belongs to a next step. */
export type OnboardingHint = 'pick-tool' | 'share-report';

export const HINT_STEP: Record<OnboardingHint, NextStep> = {
  'pick-tool': 'tool',
  'share-report': 'report',
};

const memory = { completed: [] as string[], dismissed: [] as string[] };

const readList = (key: string, fallback: string[]): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : fallback;
  } catch {
    return fallback;
  }
};

/** Writes the list; when storage refuses, keeps it for this page only. */
const writeList = (key: string, values: string[], fallback: 'completed' | 'dismissed'): void => {
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch {
    memory[fallback] = values;
  }
};

/** Earlier builds kept progress per tab session; it still counts. */
const readLegacySession = (): string[] => {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(completedKey) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const readCompletedSteps = (): string[] => {
  const stored = readList(completedKey, []);
  return [...new Set([...stored, ...memory.completed, ...readLegacySession()])];
};

const notify = () => window.dispatchEvent(new Event(NEXT_STEPS_PROGRESS_EVENT));

export const completeNextStep = (step: string): void => {
  const completed = readCompletedSteps();
  if (completed.includes(step)) return;
  writeList(completedKey, [...completed, step], 'completed');
  notify();
};

export const readDismissedHints = (): string[] => (
  [...new Set([...readList(dismissedHintsKey, []), ...memory.dismissed])]
);

export const dismissHint = (hint: OnboardingHint): void => {
  const dismissed = readDismissedHints();
  if (dismissed.includes(hint)) return;
  writeList(dismissedHintsKey, [...dismissed, hint], 'dismissed');
  notify();
};

/** A hint shows until its step is done or the visitor dismisses it. */
export const isHintActive = (
  hint: OnboardingHint,
  completed: readonly string[] = readCompletedSteps(),
  dismissed: readonly string[] = readDismissedHints()
): boolean => !completed.includes(HINT_STEP[hint]) && !dismissed.includes(hint);

/** Test helper: forget the in-memory fallback between cases. */
export const resetOnboardingMemory = (): void => {
  memory.completed = [];
  memory.dismissed = [];
};
