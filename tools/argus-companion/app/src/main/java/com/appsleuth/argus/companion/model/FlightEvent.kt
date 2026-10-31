package com.appsleuth.argus.companion.model

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * A single recorded event from either the Accessibility Service (UI events)
 * or the Local VPN Service (network events).
 * This forms the Android equivalent of the browser extension's flight recorder event buffer.
 */
data class FlightEvent(
    val id: Long = System.nanoTime(),
    val timestamp: Long = System.currentTimeMillis(),
    val type: EventType,
    val sourceApp: String,
    val label: String,
    val method: String? = null,
    val url: String? = null,
    val host: String? = null,
    val status: Int? = null,
    val durationMs: Long? = null,
    val outcome: Outcome = Outcome.UNKNOWN,
    val errorMessage: String? = null
) {
    fun formattedTime(): String =
        SimpleDateFormat("HH:mm:ss.SSS", Locale.getDefault()).format(Date(timestamp))

    fun shortLabel(): String = when {
        label.length <= 55 -> label
        else -> label.take(52) + "…"
    }
}

enum class EventType(val displayName: String, val colorHex: String) {
    SCREEN_VIEW("SCREEN", "#1F6FEB"),
    USER_ACTION("TAP", "#A371F7"),
    API_CALL("API ↗", "#39C5CF"),
    API_RESULT_OK("200 OK", "#2EA043"),
    API_RESULT_ERROR("ERROR", "#F85149"),
    API_RESULT_TIMEOUT("TIMEOUT", "#D29922"),
    APP_SWITCH("APP", "#8B949E"),
    UNKNOWN("EVENT", "#484F58")
}

enum class Outcome {
    SUCCESS,
    FAILURE,
    TIMEOUT,
    PENDING,
    UNKNOWN
}
