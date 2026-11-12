import React, { type ComponentType } from 'react';

type Loader<P> = () => Promise<{ default: ComponentType<P> }>;

export interface DeferredComponent<P> {
  /** A `React.lazy` component; render it inside a `Suspense` boundary. */
  Component: React.LazyExoticComponent<ComponentType<P>>;
  /** Starts (or joins) the chunk download. Resolves once the component can render synchronously. */
  preload: () => Promise<void>;
  /** True once the chunk has arrived. */
  isLoaded: () => boolean;
}

/**
 * `React.lazy` with a preload. Once the chunk has arrived the lazy initializer
 * receives an already-settled thenable, so the first render commits the real
 * component with no fallback frame: main.tsx preloads the chunks the current
 * route needs before mounting, which keeps the static first paint and the
 * React mount identical (the first-paint test asserts that).
 */
export function createDeferredComponent<P extends object>(load: Loader<P>): DeferredComponent<P> {
  let resolved: ComponentType<P> | undefined;
  let pending: Promise<void> | undefined;

  const preload = (): Promise<void> => {
    if (resolved) return Promise.resolve();
    pending ??= load()
      .then(module => {
        resolved = module.default;
      })
      .catch(error => {
        pending = undefined;
        throw error;
      });
    return pending;
  };

  const Component = React.lazy(() => {
    if (resolved) {
      const module = { default: resolved };
      // A thenable that settles synchronously; React.lazy resolves it before it can suspend.
      return { then: (onFulfilled: (value: typeof module) => void) => onFulfilled(module) } as unknown as Promise<typeof module>;
    }
    return preload().then(() => ({ default: resolved! }));
  });

  return { Component, preload, isLoaded: () => resolved !== undefined };
}
