package com.appsleuth.argus.companion.graph

import com.appsleuth.argus.companion.model.EventType
import com.appsleuth.argus.companion.model.FlightEvent
import com.appsleuth.argus.companion.model.Outcome

/**
 * Builds a Cumulative Session Journey DAG from observed FlightEvents.
 * This is the Android equivalent of buildJourneyGraph() in popup.js.
 *
 * It models the real causal chain:
 * SCREEN_VIEW -> USER_ACTION (Tap) -> API_CALL -> API_RESULT
 * and flags divergence points where timeouts, 4xx/5xx or drops occurred.
 */
object JourneyGraphBuilder {

    data class JourneyGraph(
        val appName: String,
        val totalEvents: Int,
        val screenViews: List<String>,
        val userActions: List<String>,
        val apiCalls: List<ApiCallSummary>,
        val faultPoints: List<FaultPoint>,
        val happyPathSummary: String,
        val hasFailures: Boolean
    )

    data class ApiCallSummary(
        val host: String,
        val method: String?,
        val url: String?,
        val status: Int?,
        val durationMs: Long?,
        val outcome: Outcome,
        val triggeredByAction: String?
    )

    data class FaultPoint(
        val stepIndex: Int,
        val label: String,
        val faultType: String,
        val plainEnglishCause: String,
        val triggeredBy: String?
    )

    fun build(events: List<FlightEvent>): JourneyGraph {
        if (events.isEmpty()) {
            return JourneyGraph(
                appName = "Active App",
                totalEvents = 0,
                screenViews = emptyList(),
                userActions = emptyList(),
                apiCalls = emptyList(),
                faultPoints = emptyList(),
                happyPathSummary = "No events recorded yet.",
                hasFailures = false
            )
        }

        val appName = events.lastOrNull {
            it.sourceApp.isNotBlank() &&
            it.sourceApp != "unknown" &&
            !it.sourceApp.startsWith("com.appsleuth")
        }?.sourceApp ?: "Target Application"

        val screenViews = events.filter { it.type == EventType.SCREEN_VIEW }.map { it.label }
        val userActions = events.filter { it.type == EventType.USER_ACTION }.map { it.label }
        val faultPoints = mutableListOf<FaultPoint>()
        val apiCalls = mutableListOf<ApiCallSummary>()

        var lastAction: String? = null

        events.forEachIndexed { index, event ->
            when (event.type) {
                EventType.USER_ACTION -> {
                    lastAction = event.label
                }

                EventType.API_RESULT_OK -> {
                    apiCalls.add(
                        ApiCallSummary(
                            host = event.host ?: "unknown",
                            method = event.method,
                            url = event.url,
                            status = event.status ?: 200,
                            durationMs = event.durationMs,
                            outcome = Outcome.SUCCESS,
                            triggeredByAction = lastAction
                        )
                    )
                }

                EventType.API_RESULT_ERROR -> {
                    val status = event.status
                    apiCalls.add(
                        ApiCallSummary(
                            host = event.host ?: "unknown",
                            method = event.method,
                            url = event.url,
                            status = status,
                            durationMs = event.durationMs,
                            outcome = Outcome.FAILURE,
                            triggeredByAction = lastAction
                        )
                    )

                    val faultType = when (status) {
                        401, 403 -> "AUTH_REJECTED"
                        404 -> "RESOURCE_NOT_FOUND"
                        429 -> "RATE_LIMITED"
                        in 500..599 -> "SERVER_ERROR"
                        else -> "HTTP_ERROR"
                    }

                    faultPoints.add(
                        FaultPoint(
                            stepIndex = index + 1,
                            label = event.label,
                            faultType = faultType,
                            plainEnglishCause = "Server returned HTTP ${status ?: "error"} for host ${event.host ?: "endpoint"}",
                            triggeredBy = lastAction
                        )
                    )
                }

                EventType.API_RESULT_TIMEOUT -> {
                    apiCalls.add(
                        ApiCallSummary(
                            host = event.host ?: "unknown",
                            method = event.method,
                            url = event.url,
                            status = null,
                            durationMs = event.durationMs,
                            outcome = Outcome.TIMEOUT,
                            triggeredByAction = lastAction
                        )
                    )

                    faultPoints.add(
                        FaultPoint(
                            stepIndex = index + 1,
                            label = event.label,
                            faultType = "TIMEOUT",
                            plainEnglishCause = "Connection to ${event.host ?: "server"} timed out after ${event.durationMs ?: "?"}ms",
                            triggeredBy = lastAction
                        )
                    )
                }

                else -> Unit
            }
        }

        val happyPathSummary = buildSummary(screenViews, userActions, apiCalls)

        return JourneyGraph(
            appName = appName,
            totalEvents = events.size,
            screenViews = screenViews,
            userActions = userActions,
            apiCalls = apiCalls,
            faultPoints = faultPoints,
            happyPathSummary = happyPathSummary,
            hasFailures = faultPoints.isNotEmpty()
        )
    }

    private fun buildSummary(
        screens: List<String>,
        actions: List<String>,
        calls: List<ApiCallSummary>
    ): String = buildString {
        if (screens.isNotEmpty()) append("Screens visited: ${screens.take(4).joinToString(" → ")}. ")
        if (actions.isNotEmpty()) append("Actions taken: ${actions.take(4).joinToString(", ")}. ")
        val okCalls = calls.filter { it.outcome == Outcome.SUCCESS }
        if (okCalls.isNotEmpty()) {
            append("Successful API calls: ${okCalls.take(4).joinToString(", ") { "${it.host} (${it.status})" }}.")
        }
    }.ifEmpty { "Session initiated without completed interactions." }

    fun toPromptContext(graph: JourneyGraph): String = buildString {
        appendLine("=== OBSERVED CUMULATIVE SESSION JOURNEY ===")
        appendLine("Target App Package: ${graph.appName}")
        appendLine("Total Intercepted Events: ${graph.totalEvents}")
        appendLine()
        appendLine("SCREENS VISITED:")
        if (graph.screenViews.isEmpty()) {
            appendLine("  (None recorded)")
        } else {
            graph.screenViews.forEachIndexed { i, s -> appendLine("  ${i + 1}. $s") }
        }
        appendLine()
        appendLine("USER ACTIONS (Taps):")
        if (graph.userActions.isEmpty()) {
            appendLine("  (None recorded)")
        } else {
            graph.userActions.forEachIndexed { i, a -> appendLine("  ${i + 1}. $a") }
        }
        appendLine()
        appendLine("API CALLS & OUTCOMES:")
        if (graph.apiCalls.isEmpty()) {
            appendLine("  (None recorded)")
        } else {
            graph.apiCalls.forEachIndexed { i, api ->
                val statusStr = api.status?.let { " → HTTP $it" } ?: " → [No Response/Drop]"
                val durStr = api.durationMs?.let { " (${it}ms)" } ?: ""
                val mark = when (api.outcome) {
                    Outcome.SUCCESS -> "✅"
                    Outcome.FAILURE -> "❌"
                    Outcome.TIMEOUT -> "⏱️"
                    else -> "❓"
                }
                appendLine("  ${i + 1}. $mark ${api.method ?: "CONN"} ${api.host}$statusStr$durStr")
                api.triggeredByAction?.let {
                    appendLine("     Triggered by User Action: $it")
                }
            }
        }

        if (graph.faultPoints.isNotEmpty()) {
            appendLine()
            appendLine("⚠️ DETECTED FAULT NODES (Divergence Points):")
            graph.faultPoints.forEach { f ->
                appendLine("  • [Step ${f.stepIndex}] ${f.label}")
                appendLine("    Type: ${f.faultType}")
                appendLine("    Cause: ${f.plainEnglishCause}")
                f.triggeredBy?.let { appendLine("    Triggered after: $it") }
            }
        } else {
            appendLine()
            appendLine("✅ No obvious network fault nodes detected in raw trace.")
        }
        appendLine("============================================")
    }
}
