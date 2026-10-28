import { DiagnosticSession } from './DiagnosticSession';
import { graphBuilder } from './GraphBuilder';
export * from './types';
export { DiagnosticSession, graphBuilder };

// Attach to window for easy direct script-tag usage
if (typeof window !== 'undefined') {
  (window as unknown as { AppSleuth: typeof DiagnosticSession }).AppSleuth = DiagnosticSession;
}
