import { DiagnosticSession } from './DiagnosticSession';
import { graphBuilder } from './GraphBuilder';
export * from './types';
export { DiagnosticSession, graphBuilder };

// Attach to window for easy direct script-tag usage
if (typeof window !== 'undefined') {
  const win = window as unknown as Record<string, unknown>;
  win.Argus = DiagnosticSession;
  win.SystemSleuth = DiagnosticSession;
  win.AppSleuth = DiagnosticSession; // Backwards compatibility
}
