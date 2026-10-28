import { graphBuilder } from '../GraphBuilder';

export function setupErrorTracker(): () => void {
  if (typeof window === 'undefined') return () => {};

  const onError = (event: ErrorEvent) => {
    graphBuilder.addNode({
      type: 'ERROR',
      label: `Error:${event.error?.name || 'UncaughtException'}`,
      metadata: {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack?.slice(0, 500)
      },
      outcome: 'FAILURE'
    });
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    graphBuilder.addNode({
      type: 'ERROR',
      label: `UnhandledRejection:${reason instanceof Error ? reason.name : 'PromiseError'}`,
      metadata: {
        message,
        stack: reason instanceof Error ? reason.stack?.slice(0, 500) : undefined
      },
      outcome: 'FAILURE'
    });
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
  };
}
