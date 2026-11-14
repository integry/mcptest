import { useEffect, useState } from 'react';
import {
  NEXT_STEPS_PROGRESS_EVENT,
  isHintActive,
  readCompletedSteps,
  readDismissedHints,
  type OnboardingHint,
} from '../utils/nextStepsProgress';

interface OnboardingProgress {
  completed: string[];
  dismissed: string[];
  isActive: (hint: OnboardingHint) => boolean;
}

/** Completed steps and dismissed hints, kept current across components and tabs. */
export const useOnboardingProgress = (): OnboardingProgress => {
  const [state, setState] = useState(() => ({ completed: readCompletedSteps(), dismissed: readDismissedHints() }));
  useEffect(() => {
    const update = () => setState({ completed: readCompletedSteps(), dismissed: readDismissedHints() });
    window.addEventListener(NEXT_STEPS_PROGRESS_EVENT, update);
    // Another tab finishing a step counts here too.
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(NEXT_STEPS_PROGRESS_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return {
    ...state,
    isActive: (hint) => isHintActive(hint, state.completed, state.dismissed),
  };
};
