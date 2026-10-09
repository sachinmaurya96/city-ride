import { lazy, Suspense, type ComponentType } from 'react';

/** Lazily loaded overlay/system component wrapped in its own Suspense boundary. */
export function lazyOverlay<P extends object>(loader: () => Promise<ComponentType<P>>) {
  const L = lazy(async () => ({ default: await loader() }));
  return function LazyOverlay(props: P) {
    return (
      <Suspense fallback={null}>
        <L {...props} />
      </Suspense>
    );
  };
}
