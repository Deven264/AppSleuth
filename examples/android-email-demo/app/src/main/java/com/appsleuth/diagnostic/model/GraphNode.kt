package com.appsleuth.diagnostic.model

data class GraphNode(
    val id: String,
    val type: NodeType,
    val label: String,
    val timestamp: Long,
    val metadata: Map<String, Any?> = emptyMap(),
    var outcome: Outcome? = null
)

enum class NodeType {
    SESSION_START,
    SCREEN_VIEW,
    USER_ACTION,
    API_CALL,
    API_RESULT,
    STATE_CHANGE,
    ERROR
}

enum class Outcome {
    SUCCESS,
    FAILURE,
    TIMEOUT,
    PENDING
}
