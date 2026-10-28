import { GraphNode, GraphEdge, NodeType, Outcome } from './types';

export class GraphBuilder {
  private nodes: GraphNode[] = [];
  private edges: GraphEdge[] = [];
  private lastNodeId: string | null = null;
  private listeners: Array<() => void> = [];

  public addNode(node: Omit<GraphNode, 'id' | 'timestamp'> & { id?: string; timestamp?: number }): string {
    const id = node.id || `node-${Math.random().toString(36).substring(2, 9)}-${Date.now()}`;
    const timestamp = node.timestamp || Date.now();

    const fullNode: GraphNode = {
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

  public updateNode(nodeId: string, outcome: Outcome, extraMetadata: Record<string, unknown> = {}): void {
    const idx = this.nodes.findIndex(n => n.id === nodeId);
    if (idx >= 0) {
      this.nodes[idx] = {
        ...this.nodes[idx],
        outcome,
        metadata: {
          ...this.nodes[idx].metadata,
          ...extraMetadata
        }
      };
      this.notifyListeners();
    }
  }

  public addEdge(fromId: string, toId: string, label: string): void {
    this.edges.push({ fromId, toId, label });
    this.notifyListeners();
  }

  public getNodes(): GraphNode[] {
    return [...this.nodes];
  }

  public getEdges(): GraphEdge[] {
    return [...this.edges];
  }

  public reset(): void {
    this.nodes = [];
    this.edges = [];
    this.lastNodeId = null;
    this.notifyListeners();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('[AppSleuth] Error in graph listener:', err);
      }
    }
  }

  private edgeLabelFor(type: NodeType): string {
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

export const graphBuilder = new GraphBuilder();
