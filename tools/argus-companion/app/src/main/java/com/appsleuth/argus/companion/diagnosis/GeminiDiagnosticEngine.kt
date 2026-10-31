package com.appsleuth.argus.companion.diagnosis

import com.appsleuth.argus.companion.graph.JourneyGraphBuilder
import com.appsleuth.argus.companion.model.FlightEvent
import com.appsleuth.argus.companion.model.Outcome
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * AI Diagnostic Engine for Android applications.
 * Correlates the user's natural language complaint with the runtime Journey Graph
 * to deliver clear root-cause explanations and pinpoint divergence steps.
 */
object GeminiDiagnosticEngine {

    private const val GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
    private val CANDIDATE_MODELS = listOf(
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-1.5-flash-latest",
        "gemini-1.5-flash"
    )

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .build()

    data class DiagnosisResult(
        val userFacingExplanation: String,
        val technicalRootCause: String,
        val divergedAtStep: String?,
        val confidence: String,
        val engine: String
    )

    suspend fun diagnose(
        userComplaint: String,
        events: List<FlightEvent>,
        apiKey: String?
    ): DiagnosisResult = withContext(Dispatchers.IO) {
        val graph = JourneyGraphBuilder.build(events)
        val graphContext = JourneyGraphBuilder.toPromptContext(graph)

        if (!apiKey.isNullOrBlank()) {
            try {
                return@withContext diagnoseWithGemini(userComplaint, graphContext, graph, apiKey.trim())
            } catch (e: Exception) {
                // Fall back gracefully to built-in heuristic correlation engine
            }
        }

        return@withContext heuristicDiagnosis(userComplaint, graph)
    }

    private fun diagnoseWithGemini(
        complaint: String,
        graphContext: String,
        graph: JourneyGraphBuilder.JourneyGraph,
        apiKey: String
    ): DiagnosisResult {
        val prompt = """
You are Argus: SystemSleuth's Principal Android Reliability Engineer & Behavioral Diagnostician.
A user reported an issue with the application "${graph.appName}".
Your goal is to diagnose the root cause by cross-referencing the user's complaint with the observed session journey DAG.

USER COMPLAINT:
"$complaint"

$graphContext

DIAGNOSIS INSTRUCTIONS:
1. Pinpoint which specific user action, screen transition, or API call is the root cause.
2. Formulate a plain-English explanation (1-2 empathetic sentences) suitable for a non-technical end user.
3. Formulate a precise technical root cause (1-2 sentences) for developers, specifying endpoints, status codes, or timeouts.
4. Pinpoint the exact step in the journey where execution diverged from expected behavior.
5. If the network trace returned 200 OK or is sparse, evaluate potential silent failures (e.g. empty JSON responses, client-side UI unresponsiveness, or unhandled navigation intent).

Return strictly valid JSON with this EXACT structure:
{
  "userFacingExplanation": "string",
  "technicalRootCause": "string",
  "divergedAtStep": "string or null",
  "confidence": "HIGH|MEDIUM|LOW"
}
""".trimIndent()

        var lastError: Exception? = null

        for (model in CANDIDATE_MODELS) {
            try {
                val jsonBody = JSONObject().apply {
                    put("contents", JSONArray().put(
                        JSONObject().put("parts", JSONArray().put(
                            JSONObject().put("text", prompt)
                        ))
                    ))
                    put("generationConfig", JSONObject().apply {
                        put("temperature", 0.2)
                        put("maxOutputTokens", 1024)
                    })
                }

                val request = Request.Builder()
                    .url("$GEMINI_BASE/models/$model:generateContent?key=$apiKey")
                    .post(jsonBody.toString().toRequestBody("application/json".toMediaType()))
                    .build()

                httpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw Exception("Gemini HTTP ${response.code}")
                    }
                    val bodyString = response.body?.string() ?: throw Exception("Empty body")
                    val root = JSONObject(bodyString)
                    val text = root.optJSONArray("candidates")
                        ?.optJSONObject(0)
                        ?.optJSONObject("content")
                        ?.optJSONArray("parts")
                        ?.optJSONObject(0)
                        ?.optString("text") ?: throw Exception("No text in candidate")

                    val cleaned = text.trim()
                        .removePrefix("```json")
                        .removePrefix("```")
                        .removeSuffix("```")
                        .trim()

                    val parsed = JSONObject(cleaned)
                    return DiagnosisResult(
                        userFacingExplanation = parsed.optString("userFacingExplanation", "Could not deduce explanation."),
                        technicalRootCause = parsed.optString("technicalRootCause", "Unknown technical cause."),
                        divergedAtStep = parsed.optString("divergedAtStep").takeIf { it.isNotBlank() && it != "null" },
                        confidence = parsed.optString("confidence", "HIGH"),
                        engine = "Gemini AI ($model)"
                    )
                }
            } catch (e: Exception) {
                lastError = e
            }
        }

        throw lastError ?: Exception("All Gemini models failed")
    }

    private fun heuristicDiagnosis(
        complaint: String,
        graph: JourneyGraphBuilder.JourneyGraph
    ): DiagnosisResult {
        if (graph.faultPoints.isEmpty()) {
            return DiagnosisResult(
                userFacingExplanation = "All recorded network calls completed successfully (200 OK). Your issue may be a silent client-side glitch, an unexpected empty data response, or a visual rendering bug.",
                technicalRootCause = "Zero non-2xx HTTP responses or timeouts were logged in the observed session trace. Inspect UI event dispatchers and payload response schemas.",
                divergedAtStep = null,
                confidence = "LOW",
                engine = "Offline Heuristic Correlator"
            )
        }

        val primaryFault = graph.faultPoints.first()
        val relatedApi = graph.apiCalls.find { it.outcome != Outcome.SUCCESS }

        val (userMsg, techMsg) = when (primaryFault.faultType) {
            "TIMEOUT" -> Pair(
                "The app's server took too long to respond and timed out. This typically occurs when the backend service is experiencing high load or your connection dropped.",
                "SocketTimeoutException or handshake deadline exceeded for ${relatedApi?.host ?: "endpoint"} (duration: ${relatedApi?.durationMs ?: "N/A"}ms)."
            )
            "AUTH_REJECTED" -> Pair(
                "Your session or login token was rejected by the server. Logging out and back in usually resolves this.",
                "HTTP ${relatedApi?.status ?: 401} Unauthorized/Forbidden received on ${relatedApi?.host ?: "endpoint"} following action ${primaryFault.triggeredBy ?: "user tap"}."
            )
            "RATE_LIMITED" -> Pair(
                "Too many requests were sent in a short period and the server temporarily throttled the app. Please wait a minute and retry.",
                "HTTP 429 Too Many Requests returned by ${relatedApi?.host ?: "upstream gateway"}."
            )
            "SERVER_ERROR" -> Pair(
                "The app's server ran into an internal error while processing your request. This is an issue on the service provider's end.",
                "HTTP ${relatedApi?.status ?: 500} Internal Server Error produced by ${relatedApi?.host ?: "service"}."
            )
            else -> Pair(
                primaryFault.plainEnglishCause,
                "Observed fault divergence: ${primaryFault.label} (${relatedApi?.host ?: "unknown"})."
            )
        }

        return DiagnosisResult(
            userFacingExplanation = userMsg,
            technicalRootCause = techMsg,
            divergedAtStep = "Step ${primaryFault.stepIndex}: ${primaryFault.label}",
            confidence = "MEDIUM",
            engine = "Offline Heuristic Correlator"
        )
    }
}
