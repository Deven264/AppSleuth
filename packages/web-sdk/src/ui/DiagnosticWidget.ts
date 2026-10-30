import { graphBuilder } from '../GraphBuilder';
import { DiagnosticSession } from '../DiagnosticSession';
import { GraphNode } from '../types';

export class DiagnosticWidget {
  private container: HTMLDivElement | null = null;
  private isModalOpen = false;
  private activeTab: 'trace' | 'diagnose' = 'trace';
  private unsubscribe: (() => void) | null = null;
  private currentDiagnosis: any = null;
  private userQueryInput = '';

  constructor(private position: 'bottom-right' | 'bottom-left' = 'bottom-right') {}

  public mount(): void {
    if (typeof document === 'undefined') return;

    this.container = document.createElement('div');
    this.container.id = 'argus-widget-root';
    document.body.appendChild(this.container);

    this.render();
    this.unsubscribe = graphBuilder.subscribe(() => {
      const nodes = graphBuilder.getNodes();
      const hasFailure = nodes.some(n => n.outcome === 'FAILURE' || n.outcome === 'TIMEOUT');
      if (hasFailure && !this.currentDiagnosis) {
        this.runClientDiagnosis();
      }
      this.render();
    });
  }

  public unmount(): void {
    if (this.unsubscribe) this.unsubscribe();
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }

  private runClientDiagnosis(query: string = ''): void {
    const nodes = graphBuilder.getNodes();
    const failNode = nodes.find(n => n.outcome === 'FAILURE' || n.outcome === 'TIMEOUT');

    if (!failNode) {
      this.currentDiagnosis = {
        diverged: false,
        type: 'HEALTHY',
        title: '✅ Normal Execution',
        userExplanation: 'All recorded events executed successfully according to standard behavior.',
        developerDiagnosis: 'Zero failure outcomes detected in current session trace.',
        actions: ['No remediation needed. Workflow is behaving normally.']
      };
      return;
    }

    const meta = failNode.metadata || {};
    const duration = meta.durationMs ? `${meta.durationMs}ms` : 'several seconds';
    const endpoint = meta.endpoint || meta.url || failNode.label;
    const isTimeout = failNode.outcome === 'TIMEOUT' || failNode.label.toLowerCase().includes('timeout');
    const isCors = JSON.stringify(meta).toLowerCase().includes('cors');

    let divType = 'FAILURE';
    let userExp = '';
    let devDiag = '';
    let actions: string[] = [];

    if (isTimeout) {
      divType = 'TIMEOUT';
      userExp = `Your request to ${endpoint} timed out after ${duration}. No data was corrupted, but the action did not finish processing.`;
      devDiag = `Network request timed out at '${failNode.label}'. Duration: ${duration}. Endpoint: ${endpoint}.`;
      actions = [
        `Verify backend latency and network connectivity for ${endpoint}.`,
        `Consider increasing client timeout threshold if transaction requires > ${duration}.`,
        'Implement automatic retry with backoff for transient timeouts.'
      ];
    } else if (isCors) {
      divType = 'CORS_VIOLATION';
      userExp = 'The browser blocked the network request due to security (CORS) restrictions. Your card or data was not processed.';
      devDiag = `Browser CORS policy blocked cross-origin request to ${endpoint}.`;
      actions = [
        `Configure Access-Control-Allow-Origin headers on remote server for: ${endpoint}.`,
        'Check preflight OPTIONS handling on API gateway.'
      ];
    } else {
      divType = 'ERROR';
      userExp = `An unexpected error occurred while processing ${endpoint}. The operation was interrupted.`;
      devDiag = `Failure recorded at '${failNode.label}'. Metadata: ${JSON.stringify(meta)}.`;
      actions = [
        'Inspect server logs for 5xx exceptions or unhandled rejections.',
        'Verify request payload parameters.'
      ];
    }

    if (query.trim()) {
      userExp = `Regarding: "${query.trim()}" — ${userExp}`;
    }

    this.currentDiagnosis = {
      diverged: true,
      type: divType,
      title: `🚨 Divergence Detected (${divType})`,
      divergenceNode: failNode.label,
      userExplanation: userExp,
      developerDiagnosis: devDiag,
      actions: actions
    };
  }

  private render(): void {
    if (!this.container) return;

    const nodes = graphBuilder.getNodes();
    const edges = graphBuilder.getEdges();
    const hasFailure = nodes.some(n => n.outcome === 'FAILURE' || n.outcome === 'TIMEOUT');
    const failureCount = nodes.filter(n => n.outcome === 'FAILURE' || n.outcome === 'TIMEOUT').length;

    const pillBg = hasFailure ? '#dc2626' : '#1e293b';
    const pillBorder = hasFailure ? '#ef4444' : '#334155';
    const badgeBg = hasFailure ? '#ffffff' : '#3b82f6';
    const badgeText = hasFailure ? '#dc2626' : '#ffffff';
    const positionStyle = this.position === 'bottom-left' ? 'left: 20px;' : 'right: 20px;';

    this.container.innerHTML = `
      <style>
        #argus-widget-root {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 13px;
          z-index: 999999;
          position: fixed;
          bottom: 20px;
          ${positionStyle}
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
          box-shadow: 0 4px 12px rgba(0,0,0,0.25);
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
          ${positionStyle}
          width: 400px;
          max-height: 560px;
          background: #0f172a;
          color: #f8fafc;
          border: 1px solid #334155;
          border-radius: 12px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.5);
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
        .as-tabs {
          display: flex;
          background: #1e293b;
          border-bottom: 1px solid #334155;
        }
        .as-tab-btn {
          flex: 1;
          padding: 8px 12px;
          background: transparent;
          border: none;
          color: #94a3b8;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          border-bottom: 2px solid transparent;
        }
        .as-tab-btn.active {
          color: #38bdf8;
          border-bottom: 2px solid #38bdf8;
          background: rgba(56, 189, 248, 0.08);
        }
        .as-body {
          flex: 1;
          overflow-y: auto;
          padding: 12px 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
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
        .as-diag-box {
          background: ${hasFailure ? '#2b1414' : '#14291e'};
          border: 1px solid ${hasFailure ? '#ef4444' : '#22c55e'};
          border-radius: 8px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .as-diag-title {
          font-weight: 700;
          font-size: 13px;
          color: ${hasFailure ? '#f87171' : '#4ade80'};
        }
        .as-diag-text {
          font-size: 12px;
          line-height: 1.4;
          color: #cbd5e1;
        }
        .as-footer {
          padding: 10px 16px;
          background: #1e293b;
          border-top: 1px solid #334155;
          display: flex;
          gap: 8px;
        }
        .as-btn {
          flex: 1;
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid #475569;
          background: #334155;
          color: #ffffff;
          text-align: center;
        }
        .as-btn:hover { background: #475569; }
        .as-btn-primary { background: #2563eb; border-color: #3b82f6; }
        .as-btn-primary:hover { background: #1d4ed8; }
      </style>

      <div class="as-pill" id="as-pill-btn">
        <span>👁️ Argus</span>
        <span class="as-badge">${hasFailure ? `⚠️ ${failureCount} failure` : `${nodes.length} nodes`}</span>
      </div>

      <div class="as-modal" id="as-modal-view">
        <div class="as-header">
          <div style="font-weight: 700; font-size: 14px; display: flex; align-items: center; gap: 6px;">
            <span>👁️ Argus: SystemSleuth</span>
          </div>
          <button style="background:transparent; border:none; color:#94a3b8; font-size:18px; cursor:pointer;" id="as-modal-close">×</button>
        </div>

        <div class="as-tabs">
          <button class="as-tab-btn ${this.activeTab === 'trace' ? 'active' : ''}" id="as-tab-trace">🧭 Execution Trace (${nodes.length})</button>
          <button class="as-tab-btn ${this.activeTab === 'diagnose' ? 'active' : ''}" id="as-tab-diagnose">⚡ Self-Diagnosis ${hasFailure ? '🚨' : ''}</button>
        </div>

        <div class="as-body">
          ${this.activeTab === 'trace' ? this.renderTraceView(nodes) : this.renderDiagnoseView(hasFailure)}
        </div>

        <div class="as-footer">
          <button class="as-btn as-btn-primary" id="as-btn-copy">📋 Copy JSON</button>
          <button class="as-btn" id="as-btn-download">💾 Download</button>
          <button class="as-btn" id="as-btn-clear" style="flex: 0 0 36px;" title="Reset Graph">🗑️</button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private renderTraceView(nodes: GraphNode[]): string {
    if (nodes.length === 0) {
      return '<div style="color: #94a3b8; text-align: center; padding: 20px;">No events recorded yet. Interact with the page!</div>';
    }

    return nodes.map((n, i) => {
      const outcomeClass = n.outcome === 'TIMEOUT' ? 'as-outcome-timeout' : (n.outcome === 'FAILURE' ? 'as-outcome-failure' : 'as-outcome-success');
      const cardClass = n.outcome === 'TIMEOUT' ? 'timeout' : (n.outcome === 'FAILURE' ? 'failure' : '');
      const outcomeBg = n.outcome === 'TIMEOUT' ? '#854d0e' : (n.outcome === 'FAILURE' ? '#991b1b' : '#166534');
      const outcomeColor = n.outcome === 'TIMEOUT' ? '#fde047' : (n.outcome === 'FAILURE' ? '#f87171' : '#4ade80');
      return `
        <div class="as-node-card ${cardClass}">
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
            <span style="font-weight: 600; color: #38bdf8;">#${i + 1} ${n.type}</span>
            <span style="font-size: 10px; padding: 1px 5px; border-radius: 4px; font-weight: 600; background: ${outcomeBg}; color: ${outcomeColor};">${n.outcome || 'SUCCESS'}</span>
          </div>
          <div style="font-weight: 600; font-size: 12px; color: #f1f5f9;">${n.label}</div>
        </div>
      `;
    }).join('');
  }

  private renderDiagnoseView(hasFailure: boolean): string {
    if (!this.currentDiagnosis) {
      this.runClientDiagnosis();
    }
    const diag = this.currentDiagnosis;

    return `
      <div style="display: flex; gap: 6px; margin-bottom: 4px;">
        <input
          type="text"
          id="as-issue-input"
          placeholder="Describe issue (e.g. 'Card charge timed out')"
          value="${this.userQueryInput}"
          style="flex: 1; background: #1e293b; border: 1px solid #475569; color: #f8fafc; padding: 6px 10px; border-radius: 6px; font-size: 12px;"
        />
        <button class="as-btn as-btn-primary" id="as-run-diag-btn" style="flex: 0 0 80px;">Diagnose</button>
      </div>

      <div class="as-diag-box">
        <div class="as-diag-title">${diag.title}</div>
        <div class="as-diag-text"><strong>User Explanation:</strong> ${diag.userExplanation}</div>
        <div class="as-diag-text" style="color: #94a3b8; font-size: 11px;"><strong>Root Cause:</strong> ${diag.developerDiagnosis}</div>
        ${diag.actions && diag.actions.length ? `
          <div style="font-size: 11px; margin-top: 4px;">
            <strong>Suggested Actions:</strong>
            <ul style="margin: 4px 0 0 16px; padding: 0;">
              ${diag.actions.map((a: string) => `<li>${a}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `;
  }

  private bindEvents(): void {
    if (!this.container) return;

    this.container.querySelector('#as-pill-btn')?.addEventListener('click', () => {
      this.isModalOpen = !this.isModalOpen;
      const nodes = graphBuilder.getNodes();
      const hasFailure = nodes.some(n => n.outcome === 'FAILURE' || n.outcome === 'TIMEOUT');
      if (hasFailure) {
        this.activeTab = 'diagnose';
      }
      this.render();
    });

    this.container.querySelector('#as-modal-close')?.addEventListener('click', () => {
      this.isModalOpen = false;
      this.render();
    });

    this.container.querySelector('#as-tab-trace')?.addEventListener('click', () => {
      this.activeTab = 'trace';
      this.render();
    });

    this.container.querySelector('#as-tab-diagnose')?.addEventListener('click', () => {
      this.activeTab = 'diagnose';
      this.render();
    });

    this.container.querySelector('#as-run-diag-btn')?.addEventListener('click', () => {
      const input = this.container?.querySelector('#as-issue-input') as HTMLInputElement | null;
      this.userQueryInput = input?.value || '';
      this.runClientDiagnosis(this.userQueryInput);
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
        this.currentDiagnosis = null;
        this.render();
      }
    });
  }
}
