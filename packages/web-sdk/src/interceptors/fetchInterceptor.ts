import { graphBuilder } from '../GraphBuilder';
import { Outcome } from '../types';

export function setupFetchInterceptor(): () => void {
  if (typeof window === 'undefined' || !window.fetch) {
    return () => {};
  }

  const originalFetch = window.fetch;

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET')).toUpperCase();

    // Extract path for concise labeling
    let path = url;
    try {
      const parsed = new URL(url, window.location.origin);
      path = parsed.pathname;
    } catch {
      // Keep raw url if parsing fails
    }

    const endpointLabel = `${method} ${path}`;
    const startTime = Date.now();

    // Record API Call node
    const callNodeId = graphBuilder.addNode({
      type: 'API_CALL',
      label: `ApiCall:${path}`,
      metadata: {
        method,
        url,
        bodySize: init?.body ? (typeof init.body === 'string' ? init.body.length : 'unknown') : 0
      },
      outcome: 'PENDING'
    });

    try {
      const response = await originalFetch.apply(this, [input, init]);
      const durationMs = Date.now() - startTime;
      const isSuccess = response.ok;
      const outcome: Outcome = isSuccess ? 'SUCCESS' : 'FAILURE';

      graphBuilder.addNode({
        type: 'API_RESULT',
        label: `ApiResult:${response.status}:${path}`,
        metadata: {
          httpCode: response.status,
          statusText: response.statusText,
          durationMs,
          success: isSuccess,
          endpoint: endpointLabel
        },
        outcome
      });

      return response;
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isTimeout = errorMsg.toLowerCase().includes('timeout') || errorMsg.toLowerCase().includes('aborted');

      graphBuilder.addNode({
        type: 'API_RESULT',
        label: isTimeout ? `ApiResult:TIMEOUT:${path}` : `ApiResult:FAILED:${path}`,
        metadata: {
          error: err instanceof Error ? err.name : 'NetworkError',
          message: errorMsg,
          durationMs,
          endpoint: endpointLabel,
          isCorsOrNetwork: !isTimeout
        },
        outcome: isTimeout ? 'TIMEOUT' : 'FAILURE'
      });

      throw err;
    }
  };

  return () => {
    window.fetch = originalFetch;
  };
}
