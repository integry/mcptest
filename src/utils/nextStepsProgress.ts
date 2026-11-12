export const NEXT_STEPS_PROGRESS_EVENT = 'mcptest:next-step-completed';
const key = 'mcptest-next-steps-completed';
export const readCompletedSteps = (): string[] => {
  try { return JSON.parse(sessionStorage.getItem(key) || '[]'); } catch { return []; }
};
export const completeNextStep = (step: string): void => {
  const completed = readCompletedSteps();
  if (completed.includes(step)) return;
  try { sessionStorage.setItem(key, JSON.stringify([...completed, step])); } catch { /* Session only when storage is available. */ }
  window.dispatchEvent(new Event(NEXT_STEPS_PROGRESS_EVENT));
};
