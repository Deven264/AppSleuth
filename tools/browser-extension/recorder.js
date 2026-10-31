/**
 * Argus: SystemSleuth — In-Page Rolling Flight Recorder
 * Lightweight circular in-memory buffer tracking live user actions & network APIs.
 * Runs in the webpage's MAIN world context to intercept native fetch & XHR.
 */
(() => {
  if (window.__ARGUS_RECORDER_INSTALLED__) return;
  window.__ARGUS_RECORDER_INSTALLED__ = true;

  const MAX_EVENTS = 50;
  window.__ARGUS_FLIGHT_RECORDER_BUFFER__ = window.__ARGUS_FLIGHT_RECORDER_BUFFER__ || [];

  // -------------------------------------------------------------
  // 1. Buffer Management & Sanitization
  // -------------------------------------------------------------
  function addEvent(evt) {
    try {
      evt.timestamp = evt.timestamp || Date.now();
      window.__ARGUS_FLIGHT_RECORDER_BUFFER__.push(evt);
      if (window.__ARGUS_FLIGHT_RECORDER_BUFFER__.length > MAX_EVENTS) {
        window.__ARGUS_FLIGHT_RECORDER_BUFFER__.shift();
      }
    } catch (_) {}
  }

  function sanitizeUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl, window.location.origin);
      // Remove sensitive query params
      const sensitiveParams = ['token', 'auth', 'key', 'secret', 'password', 'access_token'];
      sensitiveParams.forEach(p => {
        if (parsed.searchParams.has(p)) {
          parsed.searchParams.set(p, '[REDACTED]');
        }
      });
      return parsed.pathname + parsed.search;
    } catch {
      return String(rawUrl).slice(0, 100);
    }
  }

  // -------------------------------------------------------------
  // 2. Initial Page View & History Navigation Hooks
  // -------------------------------------------------------------
  addEvent({
    type: 'PAGE_VIEW',
    label: `PageView:${window.location.pathname}`,
    url: window.location.href,
    pathname: window.location.pathname,
    title: document.title || 'Page Loaded'
  });

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    addEvent({
      type: 'PAGE_VIEW',
      label: `PageView:${window.location.pathname}`,
      url: window.location.href,
      pathname: window.location.pathname,
      title: document.title || 'Navigated'
    });
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    addEvent({
      type: 'PAGE_VIEW',
      label: `PageView:${window.location.pathname}`,
      url: window.location.href,
      pathname: window.location.pathname,
      title: document.title || 'Navigated'
    });
  };

  window.addEventListener('popstate', () => {
    addEvent({
      type: 'PAGE_VIEW',
      label: `PageView:${window.location.pathname}`,
      url: window.location.href,
      pathname: window.location.pathname,
      title: document.title || 'Navigated Back'
    });
  }, true);

  // -------------------------------------------------------------
  // 3. User Action Interception (Clicks)
  // -------------------------------------------------------------
  document.addEventListener('click', (e) => {
    try {
      const target = e.target;
      if (!target || !(target instanceof Element)) return;

      const interactive = target.closest(
        'button, [role="button"], a, input[type="submit"], input[type="button"], [data-argus-track], [data-testid]'
      );

      if (!interactive) return;

      let label = interactive.getAttribute('data-argus-track')
        || interactive.getAttribute('data-testid')
        || interactive.getAttribute('aria-label')
        || (interactive instanceof HTMLInputElement ? interactive.value : '')
        || interactive.innerText?.trim()
        || interactive.id
        || interactive.tagName.toLowerCase();

      label = label.replace(/\s+/g, ' ').slice(0, 32);

      addEvent({
        type: 'USER_ACTION',
        label: `Click:${label}`,
        tag: interactive.tagName,
        id: interactive.id || null,
        className: interactive.className ? String(interactive.className).slice(0, 40) : null
      });
    } catch (_) {}
  }, true);

  // -------------------------------------------------------------
  // 4. Native fetch() Interception
  // -------------------------------------------------------------
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const reqInput = args[0];
      const reqInit = args[1] || {};

      let rawUrl = typeof reqInput === 'string' ? reqInput : (reqInput?.url || '');
      let method = (reqInit.method || (typeof reqInput === 'object' && reqInput?.method) || 'GET').toUpperCase();

      // Skip internal browser or Google AI Studio calls
      if (rawUrl.includes('generativelanguage.googleapis.com') || rawUrl.startsWith('chrome-extension://')) {
        return originalFetch.apply(this, args);
      }

      const cleanEndpoint = sanitizeUrl(rawUrl);
      const callId = 'call_' + Math.random().toString(36).substring(2, 8);
      const startTime = performance.now();

      addEvent({
        type: 'API_CALL',
        callId,
        method,
        url: cleanEndpoint,
        label: `ApiCall:${cleanEndpoint}`
      });

      try {
        const response = await originalFetch.apply(this, args);
        const durationMs = Math.round(performance.now() - startTime);

        let outcome = 'SUCCESS';
        if (durationMs >= 8000) {
          outcome = 'TIMEOUT';
        } else if (!response.ok) {
          outcome = 'FAILURE';
        }

        addEvent({
          type: 'API_RESULT',
          callId,
          method,
          url: cleanEndpoint,
          status: response.status,
          statusText: response.statusText,
          durationMs,
          outcome,
          label: `ApiResult:${outcome === 'TIMEOUT' ? 'TIMEOUT' : response.status}:${cleanEndpoint}`
        });

        return response;
      } catch (err) {
        const durationMs = Math.round(performance.now() - startTime);
        const isTimeout = durationMs >= 7500 || err.name === 'TimeoutError' || err.name === 'AbortError';
        const outcome = isTimeout ? 'TIMEOUT' : 'FAILURE';

        addEvent({
          type: 'API_RESULT',
          callId,
          method,
          url: cleanEndpoint,
          status: 0,
          error: err.message || 'NetworkError',
          durationMs,
          outcome,
          label: `ApiResult:${outcome}:${cleanEndpoint}`
        });

        throw err;
      }
    };
  }

  // -------------------------------------------------------------
  // 5. Native XMLHttpRequest Interception
  // -------------------------------------------------------------
  if (typeof window.XMLHttpRequest === 'function') {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__argus_method = String(method).toUpperCase();
      this.__argus_url = sanitizeUrl(url);
      this.__argus_callId = 'xhr_' + Math.random().toString(36).substring(2, 8);
      return originalOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      const callId = this.__argus_callId;
      const method = this.__argus_method || 'GET';
      const cleanUrl = this.__argus_url || '/';

      if (cleanUrl.includes('generativelanguage.googleapis.com')) {
        return originalSend.apply(this, args);
      }

      const startTime = performance.now();
      addEvent({
        type: 'API_CALL',
        callId,
        method,
        url: cleanUrl,
        label: `ApiCall:${cleanUrl}`
      });

      const onFinish = (status, errorMsg = null) => {
        const durationMs = Math.round(performance.now() - startTime);
        let outcome = 'SUCCESS';
        if (durationMs >= 8000 || status === 408 || status === 504) {
          outcome = 'TIMEOUT';
        } else if (status === 0 || status >= 400) {
          outcome = 'FAILURE';
        }

        addEvent({
          type: 'API_RESULT',
          callId,
          method,
          url: cleanUrl,
          status,
          durationMs,
          error: errorMsg,
          outcome,
          label: `ApiResult:${outcome === 'TIMEOUT' ? 'TIMEOUT' : status}:${cleanUrl}`
        });
      };

      this.addEventListener('load', () => onFinish(this.status));
      this.addEventListener('error', () => onFinish(0, 'XHR Network Error'));
      this.addEventListener('timeout', () => onFinish(408, 'XHR Timeout'));
      this.addEventListener('abort', () => onFinish(0, 'XHR Aborted'));

      return originalSend.apply(this, args);
    };
  }

  // -------------------------------------------------------------
  // 6. Unhandled Runtime Errors
  // -------------------------------------------------------------
  window.addEventListener('error', (e) => {
    addEvent({
      type: 'ERROR',
      label: `Error:${(e.message || 'ScriptError').slice(0, 30)}`,
      message: e.message,
      filename: e.filename ? sanitizeUrl(e.filename) : null,
      lineno: e.lineno || null
    });
  }, true);

  window.addEventListener('unhandledrejection', (e) => {
    addEvent({
      type: 'ERROR',
      label: 'Error:UnhandledRejection',
      message: String(e.reason || 'Promise rejected')
    });
  }, true);

  console.log('[Argus] 📡 Rolling Flight Recorder active. Memory buffer ready.');
})();
