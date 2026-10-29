export type NodeType =
  | 'SESSION_START'
  | 'PAGE_VIEW'
  | 'USER_ACTION'
  | 'API_CALL'
  | 'API_RESULT'
  | 'STATE_CHANGE'
  | 'ERROR';

export type Outcome = 'SUCCESS' | 'PENDING' | 'TIMEOUT' | 'FAILURE';

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  outcome?: Outcome;
}

export interface GraphEdge {
  fromId: string;
  toId: string;
  label: string;
}

export interface ExecutionGraph {
  sessionId: string;
  appVersion: string;
  platform: 'web';
  startTime: number;
  endTime?: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ArgusConfig {
  appVersion?: string;
  autoTrackClicks?: boolean;
  autoTrackNavigation?: boolean;
  autoTrackFetch?: boolean;
  autoTrackErrors?: boolean;
  showWidget?: boolean;
  widgetPosition?: 'bottom-right' | 'bottom-left';
}

export type AppSleuthConfig = ArgusConfig;
