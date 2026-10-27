package com.appsleuth.diagnostic.model

data class ExecutionGraph(
    val sessionId: String,
    val appVersion: String,
    val startTime: Long,
    val endTime: Long? = null,
    val nodes: List<GraphNode>,
    val edges: List<GraphEdge>
)
