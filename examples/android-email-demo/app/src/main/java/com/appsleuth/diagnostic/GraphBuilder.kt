package com.appsleuth.diagnostic

import com.appsleuth.diagnostic.model.*
import java.util.UUID

object GraphBuilder {

    private val nodes = mutableListOf<GraphNode>()
    private val edges = mutableListOf<GraphEdge>()
    private var lastNodeId: String? = null
    private val lock = Any()

    /**
     * Add a node to the graph. Automatically creates an edge from the previous node.
     * Returns the new node's ID so callers can reference it for updates.
     */
    fun addNode(node: GraphNode): String {
        synchronized(lock) {
            nodes.add(node)
            lastNodeId?.let { prevId ->
                edges.add(GraphEdge(prevId, node.id, edgeLabelFor(node.type)))
            }
            lastNodeId = node.id
            return node.id
        }
    }

    /**
     * Add a non-linear edge (e.g., retry, error recovery, branching flow).
     */
    fun addEdge(fromId: String, toId: String, label: String) {
        synchronized(lock) {
            edges.add(GraphEdge(fromId, toId, label))
        }
    }

    /**
     * Update a previously added node's outcome once the result is known (e.g., API response).
     */
    fun updateNode(nodeId: String, outcome: Outcome, extraMetadata: Map<String, Any?> = emptyMap()) {
        synchronized(lock) {
            val idx = nodes.indexOfFirst { it.id == nodeId }
            if (idx >= 0) {
                val existing = nodes[idx]
                nodes[idx] = existing.copy(
                    outcome = outcome,
                    metadata = existing.metadata + extraMetadata
                )
            }
        }
    }

    fun getNodes(): List<GraphNode> = synchronized(lock) { nodes.toList() }
    fun getEdges(): List<GraphEdge> = synchronized(lock) { edges.toList() }

    fun reset() {
        synchronized(lock) {
            nodes.clear()
            edges.clear()
            lastNodeId = null
        }
    }

    private fun edgeLabelFor(type: NodeType) = when (type) {
        NodeType.SESSION_START -> "session_started"
        NodeType.SCREEN_VIEW   -> "navigated_to"
        NodeType.USER_ACTION   -> "user_triggered"
        NodeType.API_CALL      -> "api_initiated"
        NodeType.API_RESULT    -> "api_responded"
        NodeType.STATE_CHANGE  -> "state_changed"
        NodeType.ERROR         -> "error_occurred"
    }
}
