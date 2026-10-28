import { graphBuilder } from '../GraphBuilder';

export function setupNavigationTracker(): () => void {
  if (typeof window === 'undefined') return () => {};

  let lastTrackedPath = window.location.pathname + window.location.hash;

  const recordPageView = (trigger: string) => {
    const currentPath = window.location.pathname + window.location.hash;
    graphBuilder.addNode({
      type: 'PAGE_VIEW',
      label: `PageView:${window.location.pathname || '/'}`,
      metadata: {
        path: window.location.pathname,
        hash: window.location.hash,
        title: document.title,
        trigger
      },
      outcome: 'SUCCESS'
    });
    lastTrackedPath = currentPath;
  };

  // Record initial page load
  recordPageView('initial_load');

  // Listen to browser Back/Forward navigation
  const onPopState = () => recordPageView('popstate');
  const onHashChange = () => recordPageView('hashchange');

  window.addEventListener('popstate', onPopState);
  window.addEventListener('hashchange', onHashChange);

  // Monkey-patch history.pushState & history.replaceState for client-side routers (React, Vue, Next.js)
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  window.history.pushState = function (...args) {
    originalPushState.apply(this, args);
    setTimeout(() => {
      const newPath = window.location.pathname + window.location.hash;
      if (newPath !== lastTrackedPath) {
        recordPageView('pushState');
      }
    }, 0);
  };

  window.history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    setTimeout(() => {
      const newPath = window.location.pathname + window.location.hash;
      if (newPath !== lastTrackedPath) {
        recordPageView('replaceState');
      }
    }, 0);
  };

  return () => {
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('hashchange', onHashChange);
    window.history.pushState = originalPushState;
    window.history.replaceState = originalReplaceState;
  };
}
