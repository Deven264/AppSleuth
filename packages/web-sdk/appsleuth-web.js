/**
 * AppSleuth Web Diagnostic SDK (Standalone Browser Build)
 * Version: 1.0.0
 * License: Apache-2.0
 */
(function (global) {
  'use strict';

  // ── GraphBuilder ──────────────────────────────────────────────────────────
  class GraphBuilder {
    constructor() {
      this.nodes = [];
      this.edges = [];
      this.lastNodeId = null;
      this.listeners = [];
    }

    addNode(node) {
      const id = node.id || 'node-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now();
      const timestamp = node.timestamp || Date.now();
      const fullNode = {
        ...node,
        id,
        timestamp,
        metadata: node.metadata || {},
        outcome: node.outcome || 'SUCCESS'
      };

      this.nodes.push(fullNode);

      if (this.lastNodeId) {
        this.edges.push({
          fromId: this.lastNodeId,
          toId: id,
          label: this.edgeLabelFor(fullNode.type)
        });
      }

      this.lastNodeId = id;
      this.notifyListeners();
      return id;
    }

    updateNode(nodeId, outcome, extraMetadata = {}) {
      const idx = this.nodes.findIndex(n => n.id === nodeId);
      if (idx >= 0) {
        this.nodes[idx] = {
          ...this.nodes[idx],
          outcome,
          metadata: { ...this.nodes[idx].metadata, ...extraMetadata }
        };
        this.notifyListeners();
      }
    }

    addEdge(fromId, toId, label) {
      this.edges.push({ fromId, toId, label });
      this.notifyListeners();
    }

    getNodes() { return [...this.nodes]; }
    getEdges() { return [...this.edges]; }

    reset() {
      this.nodes = [];
      this.edges = [];
      this.lastNodeId = null;
      this.notifyListeners();
    }

    subscribe(listener) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter(l => l !== listener);
      };
    }

    notifyListeners() {
      for (const listener of this.listeners) {
        try { listener(); } catch (err) { console.error('[AppSleuth] Listener error:', err); }
      }
    }

    edgeLabelFor(type) {
      switch (type) {
        case 'SESSION_START': return 'session_started';
        case 'PAGE_VIEW':     return 'navigated_to';
        case 'USER_ACTION':   return 'user_triggered';
        case 'API_CALL':      return 'api_initiated';
        case 'API_RESULT':    return 'api_responded';
        case 'STATE_CHANGE':  return 'state_changed';
        case 'ERROR':         return 'error_occurred';
        default:              return 'transitioned_to';
      }
    }
  }

  const graphBuilder = new GraphBuilder();

  // ── Interceptors ─────────────────────────────────────────────────────────
  function setupFetchInterceptor() {
    if (typeof window === 'undefined' || !window.fetch) return () => {};

    const originalFetch = window.fetch;

    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
      const method = (init && init.method ? init.method : (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET')).toUpperCase();

      let path = url;
      try {
        const parsed = new URL(url, window.location.origin);
        path = parsed.pathname;
      } catch (_) {}

      const endpointLabel = `${method} ${path}`;
      const startTime = Date.now();

      graphBuilder.addNode({
        type: 'API_CALL',
        label: `ApiCall:${path}`,
        metadata: {
          method,
          url,
          bodySize: init && init.body ? (typeof init.body === 'string' ? init.body.length : 'unknown') : 0
        },
        outcome: 'PENDING'
      });

      try {
        const response = await originalFetch.apply(this, [input, init]);
        const durationMs = Date.now() - startTime;
        const isSuccess = response.ok;

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
          outcome: isSuccess ? 'SUCCESS' : 'FAILURE'
        });

        return response;
      } catch (err) {
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

    return () => { window.fetch = originalFetch; };
  }

  function setupNavigationTracker() {
    if (typeof window === 'undefined') return () => {};

    let lastPath = window.location.pathname + window.location.hash;

    const recordPageView = (trigger) => {
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
      lastPath = currentPath;
    };

    recordPageView('initial_load');

    const onPop = () => recordPageView('popstate');
    const onHash = () => recordPageView('hashchange');
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onHash);

    const origPush = window.history.pushState;
    const origReplace = window.history.replaceState;

    window.history.pushState = function (...args) {
      origPush.apply(this, args);
      setTimeout(() => {
        const p = window.location.pathname + window.location.hash;
        if (p !== lastPath) recordPageView('pushState');
      }, 0);
    };

    window.history.replaceState = function (...args) {
      origReplace.apply(this, args);
      setTimeout(() => {
        const p = window.location.pathname + window.location.hash;
        if (p !== lastPath) recordPageView('replaceState');
      }, 0);
    };

    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onHash);
      window.history.pushState = origPush;
      window.history.replaceState = origReplace;
    };
  }

  function setupUiTracker() {
    if (typeof window === 'undefined') return () => {};

    const onClick = (e) => {
      const target = e.target;
      if (!target || typeof target.closest !== 'function') return;

      const interactive = target.closest('button, a, input[type="submit"], input[type="button"], [data-appsleuth-track], [role="button"]');
      if (!interactive) return;

      // Do not track clicks inside our own diagnostic widget!
      if (interactive.closest('#appsleuth-widget-root')) return;

      let label = interactive.getAttribute('data-appsleuth-track')
        || interactive.getAttribute('data-track')
        || interactive.getAttribute('aria-label')
        || (interactive.tagName === 'INPUT' ? interactive.value : '')
        || interactive.innerText?.trim()
        || interactive.id
        || interactive.tagName.toLowerCase();

      label = label.replace(/\s+/g, ' ').slice(0, 40);

      graphBuilder.addNode({
        type: 'USER_ACTION',
        label: `Click:${label}`,
        metadata: {
          tag: interactive.tagName.toLowerCase(),
          id: interactive.id || undefined,
          text: label
        },
        outcome: 'SUCCESS'
      });
    };

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }

  function setupErrorTracker() {
    if (typeof window === 'undefined') return () => {};

    const onError = (e) => {
      graphBuilder.addNode({
        type: 'ERROR',
        label: `Error:${e.error?.name || 'UncaughtException'}`,
        metadata: {
          message: e.message,
          filename: e.filename,
          lineno: e.lineno
        },
        outcome: 'FAILURE'
      });
    };

    const onRejection = (e) => {
      const reason = e.reason;
      graphBuilder.addNode({
        type: 'ERROR',
        label: `UnhandledRejection:${reason instanceof Error ? reason.name : 'PromiseError'}`,
        metadata: {
          message: reason instanceof Error ? reason.message : String(reason)
        },
        outcome: 'FAILURE'
      });
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }

  // ── DiagnosticWidget ──────────────────────────────────────────────────────
  class DiagnosticWidget {
    constructor(position = 'bottom-right') {
      this.position = position;
      this.container = null;
      this.isModalOpen = false;
      this.unsubscribe = null;
    }

    mount() {
      if (typeof document === 'undefined') return;
      this.container = document.createElement('div');
      this.container.id = 'appsleuth-widget-root';
      document.body.appendChild(this.container);
      this.render();
      this.unsubscribe = graphBuilder.subscribe(() => this.render());
    }

    unmount() {
      if (this.unsubscribe) this.unsubscribe();
      if (this.container && this.container.parentNode) {
        this.container.parentNode.removeChild(this.container);
      }
    }

    render() {
      if (!this.container) return;

      const nodes = graphBuilder.getNodes();
      const edges = graphBuilder.getEdges();
      const hasFailure = nodes.some(n => n.outcome === 'FAILURE' || n.outcome === 'TIMEOUT');
      const failureCount = nodes.filter(n => n.outcome === 'FAILURE' || n.outcome === 'TIMEOUT').length;

      const pillBg = hasFailure ? '#dc2626' : '#1e293b';
      const pillBorder = hasFailure ? '#ef4444' : '#334155';
      const badgeBg = hasFailure ? '#ffffff' : '#3b82f6';
      const badgeText = hasFailure ? '#dc2626' : '#ffffff';
      const posStyle = this.position === 'bottom-left' ? 'left: 20px;' : 'right: 20px;';

      this.container.innerHTML = `
        <style>
          #appsleuth-widget-root {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            z-index: 999999;
            position: fixed;
            bottom: 20px;
            ${posStyle}
          }
          .as-pill {
            display: flex;
            align-items: center;
            gap: 8px;
            background: ${pillBg};
            color: #ffffff;
            padding: 8px 14px;
            border-radius: 9999px;
            border: 1px solid ${pillBorder};
            box-shadow: 0 4px 14px rgba(0,0,0,0.3);
            cursor: pointer;
            user-select: none;
            transition: transform 0.15s ease, background 0.2s ease;
          }
          .as-pill:hover { transform: translateY(-2px); }
          .as-badge {
            background: ${badgeBg};
            color: ${badgeText};
            padding: 2px 7px;
            border-radius: 9999px;
            font-size: 11px;
            font-weight: 700;
          }
          .as-modal {
            display: ${this.isModalOpen ? 'flex' : 'none'};
            flex-direction: column;
            position: fixed;
            bottom: 70px;
            ${posStyle}
            width: 380px;
            max-height: 520px;
            background: #0f172a;
            color: #f8fafc;
            border: 1px solid #334155;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            overflow: hidden;
          }
          .as-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: #1e293b;
            border-bottom: 1px solid #334155;
          }
          .as-title { font-weight: 700; font-size: 14px; display: flex; align-items: center; gap: 6px; }
          .as-close { background: transparent; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; line-height: 1; }
          .as-body { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
          .as-node-card {
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 6px;
            padding: 8px 10px;
            display: flex;
            flex-direction: column;
            gap: 3px;
          }
          .as-node-card.failure { border-color: #ef4444; background: #2b1414; }
          .as-node-card.timeout { border-color: #f59e0b; background: #2b2014; }
          .as-node-header { display: flex; justify-content: space-between; align-items: center; font-size: 11px; }
          .as-node-type { font-weight: 600; color: #38bdf8; }
          .as-node-label { font-weight: 600; font-size: 12px; color: #f1f5f9; }
          .as-outcome-tag { font-size: 10px; padding: 1px 5px; border-radius: 4px; font-weight: 600; }
          .as-outcome-success { background: #166534; color: #4ade80; }
          .as-outcome-timeout { background: #854d0e; color: #fde047; }
          .as-outcome-failure { background: #991b1b; color: #f87171; }
          .as-footer { padding: 12px 16px; background: #1e293b; border-top: 1px solid #334155; display: flex; gap: 8px; }
          .as-btn {
            flex: 1; padding: 7px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;
            border: 1px solid #475569; background: #334155; color: #ffffff; text-align: center;
          }
          .as-btn:hover { background: #475569; }
          .as-btn-primary { background: #2563eb; border-color: #3b82f6; }
          .as-btn-primary:hover { background: #1d4ed8; }
        </style>

        <div class="as-pill" id="as-pill-btn">
          <span>🔍 AppSleuth</span>
          <span class="as-badge">${hasFailure ? '⚠️ ' + failureCount + ' failure' : nodes.length + ' nodes'}</span>
        </div>

        <div class="as-modal" id="as-modal-view">
          <div class="as-header">
            <div class="as-title">
              <span>🔍 Execution Graph</span>
              <span style="font-size: 11px; color: #94a3b8; font-weight: normal;">(${nodes.length} nodes, ${edges.length} edges)</span>
            </div>
            <button class="as-close" id="as-modal-close">×</button>
          </div>

          <div class="as-body">
            ${nodes.length === 0 ? '<div style="color: #94a3b8; text-align: center; padding: 20px;">No events recorded yet. Interact with the page!</div>' : ''}
            ${nodes.map((n, i) => {
              const oClass = n.outcome === 'TIMEOUT' ? 'as-outcome-timeout' : (n.outcome === 'FAILURE' ? 'as-outcome-failure' : 'as-outcome-success');
              const cClass = n.outcome === 'TIMEOUT' ? 'timeout' : (n.outcome === 'FAILURE' ? 'failure' : '');
              return `
                <div class="as-node-card ${cClass}">
                  <div class="as-node-header">
                    <span class="as-node-type">#${i + 1} ${n.type}</span>
                    <span class="as-outcome-tag ${oClass}">${n.outcome || 'SUCCESS'}</span>
                  </div>
                  <div class="as-node-label">${n.label}</div>
                </div>
              `;
            }).join('')}
          </div>

          <div class="as-footer">
            <button class="as-btn as-btn-primary" id="as-btn-copy">📋 Copy JSON</button>
            <button class="as-btn" id="as-btn-download">💾 Download</button>
            <button class="as-btn" id="as-btn-clear" style="flex: 0 0 40px;" title="Reset Graph">🗑️</button>
          </div>
        </div>
      `;

      this.container.querySelector('#as-pill-btn')?.addEventListener('click', () => {
        this.isModalOpen = !this.isModalOpen;
        this.render();
      });

      this.container.querySelector('#as-modal-close')?.addEventListener('click', () => {
        this.isModalOpen = false;
        this.render();
      });

      this.container.querySelector('#as-btn-copy')?.addEventListener('click', () => {
        const json = DiagnosticSession.exportJson();
        navigator.clipboard.writeText(json).then(() => {
          alert('Execution Graph JSON copied to clipboard!');
        });
      });

      this.container.querySelector('#as-btn-download')?.addEventListener('click', () => {
        DiagnosticSession.downloadJson();
      });

      this.container.querySelector('#as-btn-clear')?.addEventListener('click', () => {
        if (confirm('Reset recorded execution graph?')) {
          graphBuilder.reset();
          DiagnosticSession.recordSessionStart();
        }
      });
    }
  }

  // ── DiagnosticSession ─────────────────────────────────────────────────────
  class DiagnosticSession {
    static sessionId = '';
    static appVersion = '1.0.0';
    static startTime = 0;
    static isInitialized = false;
    static cleanups = [];
    static widget = null;

    static start(config = {}) {
      if (this.isInitialized) return;
      this.isInitialized = true;

      this.sessionId = 'sess-web-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now();
      this.appVersion = config.appVersion || '1.0.0';
      this.startTime = Date.now();

      graphBuilder.reset();
      this.recordSessionStart();

      if (config.autoTrackNavigation !== false) this.cleanups.push(setupNavigationTracker());
      if (config.autoTrackClicks !== false) this.cleanups.push(setupUiTracker());
      if (config.autoTrackFetch !== false) this.cleanups.push(setupFetchInterceptor());
      if (config.autoTrackErrors !== false) this.cleanups.push(setupErrorTracker());

      graphBuilder.subscribe(() => { this.flushToStorage(); });

      if (config.showWidget !== false) {
        this.widget = new DiagnosticWidget(config.widgetPosition || 'bottom-right');
        this.widget.mount();
      }

      console.log(`[AppSleuth Web] Diagnostic session initialized (${this.sessionId})`);
    }

    static recordSessionStart() {
      graphBuilder.addNode({
        type: 'SESSION_START',
        label: 'SessionStart',
        metadata: {
          sessionId: this.sessionId,
          appVersion: this.appVersion,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
          url: typeof window !== 'undefined' ? window.location.href : 'unknown'
        },
        outcome: 'SUCCESS'
      });
    }

    static getGraph() {
      return {
        sessionId: this.sessionId,
        appVersion: this.appVersion,
        platform: 'web',
        startTime: this.startTime,
        endTime: Date.now(),
        nodes: graphBuilder.getNodes(),
        edges: graphBuilder.getEdges()
      };
    }

    static exportJson() {
      return JSON.stringify(this.getGraph(), null, 2);
    }

    static flush() {
      const json = this.exportJson();
      this.flushToStorage();
      return json;
    }

    static downloadJson(fileName = 'execution_graph.json') {
      if (typeof document === 'undefined') return;
      const json = this.exportJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    static trackStateChange(label, metadata = {}, outcome = 'SUCCESS') {
      return graphBuilder.addNode({
        type: 'STATE_CHANGE',
        label: 'StateChange:' + label,
        metadata,
        outcome
      });
    }

    static trackAction(label, metadata = {}) {
      return graphBuilder.addNode({
        type: 'USER_ACTION',
        label: 'UserAction:' + label,
        metadata,
        outcome: 'SUCCESS'
      });
    }

    static flushToStorage() {
      if (typeof window === 'undefined' || !window.sessionStorage) return;
      try {
        window.sessionStorage.setItem('appsleuth_execution_graph', this.exportJson());
      } catch (_) {}
    }

    static stop() {
      this.cleanups.forEach(c => c());
      this.cleanups = [];
      if (this.widget) {
        this.widget.unmount();
        this.widget = null;
      }
      this.isInitialized = false;
    }
  }

  // Export to global scope
  global.AppSleuth = DiagnosticSession;
  global.AppSleuthGraphBuilder = graphBuilder;

})(typeof window !== 'undefined' ? window : globalThis);
