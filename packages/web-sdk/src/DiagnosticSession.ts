import { graphBuilder } from './GraphBuilder';
import { setupFetchInterceptor } from './interceptors/fetchInterceptor';
import { setupNavigationTracker } from './interceptors/navigationTracker';
import { setupUiTracker } from './interceptors/uiTracker';
import { setupErrorTracker } from './interceptors/errorTracker';
import { DiagnosticWidget } from './ui/DiagnosticWidget';
import { AppSleuthConfig, ExecutionGraph } from './types';

export class DiagnosticSession {
  private static sessionId: string = '';
  private static appVersion: string = '1.0.0';
  private static startTime: number = 0;
  private static isInitialized = false;
  private static cleanups: Array<() => void> = [];
  private static widget: DiagnosticWidget | null = null;

  public static start(config: AppSleuthConfig = {}): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    this.sessionId = `sess-web-${Math.random().toString(36).substring(2, 9)}-${Date.now()}`;
    this.appVersion = config.appVersion || '1.0.0';
    this.startTime = Date.now();

    graphBuilder.reset();
    this.recordSessionStart();

    // Auto-interceptors
    if (config.autoTrackNavigation !== false) {
      this.cleanups.push(setupNavigationTracker());
    }
    if (config.autoTrackClicks !== false) {
      this.cleanups.push(setupUiTracker());
    }
    if (config.autoTrackFetch !== false) {
      this.cleanups.push(setupFetchInterceptor());
    }
    if (config.autoTrackErrors !== false) {
      this.cleanups.push(setupErrorTracker());
    }

    // Auto-save to sessionStorage on every graph change
    graphBuilder.subscribe(() => {
      this.flushToStorage();
    });

    // In-page floating widget
    if (config.showWidget !== false) {
      this.widget = new DiagnosticWidget(config.widgetPosition || 'bottom-right');
      this.widget.mount();
    }

    console.log(`[AppSleuth Web] Diagnostic session initialized (${this.sessionId})`);
  }

  public static recordSessionStart(): void {
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

  public static getGraph(): ExecutionGraph {
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

  public static exportJson(): string {
    return JSON.stringify(this.getGraph(), null, 2);
  }

  public static flush(): string {
    const json = this.exportJson();
    this.flushToStorage();
    return json;
  }

  public static downloadJson(fileName: string = 'execution_graph.json'): void {
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

  public static trackStateChange(label: string, metadata: Record<string, unknown> = {}, outcome: 'SUCCESS' | 'PENDING' | 'TIMEOUT' | 'FAILURE' = 'SUCCESS'): string {
    return graphBuilder.addNode({
      type: 'STATE_CHANGE',
      label: `StateChange:${label}`,
      metadata,
      outcome
    });
  }

  public static trackAction(label: string, metadata: Record<string, unknown> = {}): string {
    return graphBuilder.addNode({
      type: 'USER_ACTION',
      label: `UserAction:${label}`,
      metadata,
      outcome: 'SUCCESS'
    });
  }

  private static flushToStorage(): void {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    try {
      window.sessionStorage.setItem('appsleuth_execution_graph', this.exportJson());
    } catch {
      // Storage quota or restriction
    }
  }

  public static stop(): void {
    this.cleanups.forEach(c => c());
    this.cleanups = [];
    if (this.widget) {
      this.widget.unmount();
      this.widget = null;
    }
    this.isInitialized = false;
  }
}
