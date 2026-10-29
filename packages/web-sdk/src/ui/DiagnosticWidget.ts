import { graphBuilder } from '../GraphBuilder';
import { DiagnosticSession } from '../DiagnosticSession';

export class DiagnosticWidget {
  private container: HTMLDivElement | null = null;
  private isModalOpen = false;
  private unsubscribe: (() => void) | null = null;

  constructor(private position: 'bottom-right' | 'bottom-left' = 'bottom-right') {}

  public mount(): void {
    if (typeof document === 'undefined') return;

    this.container = document.createElement('div');
    this.container.id = 'argus-widget-root';
    document.body.appendChild(this.container);

    this.render();
    this.unsubscribe = graphBuilder.subscribe(() => this.render());
  }

  public unmount(): void {
    if (this.unsubscribe) this.unsubscribe();
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
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
        .as-pill:hover {
          transform: translateY(-2px);
        }
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
          width: 380px;
          max-height: 520px;
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
        .as-title {
          font-weight: 700;
          font-size: 14px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .as-close {
          background: transparent;
          border: none;
          color: #94a3b8;
          font-size: 18px;
          cursor: pointer;
          line-height: 1;
        }
        .as-body {
          flex: 1;
          overflow-y: auto;
          padding: 12px 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
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
        .as-node-card.failure {
          border-color: #ef4444;
          background: #2b1414;
        }
        .as-node-card.timeout {
          border-color: #f59e0b;
          background: #2b2014;
        }
        .as-node-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
        }
        .as-node-type {
          font-weight: 600;
          color: #38bdf8;
        }
        .as-node-label {
          font-weight: 600;
          font-size: 12px;
          color: #f1f5f9;
        }
        .as-outcome-tag {
          font-size: 10px;
          padding: 1px 5px;
          border-radius: 4px;
          font-weight: 600;
        }
        .as-outcome-success { background: #166534; color: #4ade80; }
        .as-outcome-timeout { background: #854d0e; color: #fde047; }
        .as-outcome-failure { background: #991b1b; color: #f87171; }
        .as-footer {
          padding: 12px 16px;
          background: #1e293b;
          border-top: 1px solid #334155;
          display: flex;
          gap: 8px;
        }
        .as-btn {
          flex: 1;
          padding: 7px 10px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid #475569;
          background: #334155;
          color: #ffffff;
          transition: background 0.15s;
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
          <div class="as-title">
            <span>🔍 Execution Graph</span>
            <span style="font-size: 11px; color: #94a3b8; font-weight: normal;">(${nodes.length} nodes, ${edges.length} edges)</span>
          </div>
          <button class="as-close" id="as-modal-close">×</button>
        </div>

        <div class="as-body">
          ${nodes.length === 0 ? '<div style="color: #94a3b8; text-align: center; padding: 20px;">No events recorded yet. Interact with the page!</div>' : ''}
          ${nodes.map((n, i) => {
            const outcomeClass = n.outcome === 'TIMEOUT' ? 'as-outcome-timeout' : (n.outcome === 'FAILURE' ? 'as-outcome-failure' : 'as-outcome-success');
            const cardClass = n.outcome === 'TIMEOUT' ? 'timeout' : (n.outcome === 'FAILURE' ? 'failure' : '');
            return `
              <div class="as-node-card ${cardClass}">
                <div class="as-node-header">
                  <span class="as-node-type">#${i + 1} ${n.type}</span>
                  <span class="as-outcome-tag ${outcomeClass}">${n.outcome || 'SUCCESS'}</span>
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

    // Wire up events
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
