package com.appsleuth.diagnostic.interceptor

import com.appsleuth.diagnostic.GraphBuilder
import com.appsleuth.diagnostic.model.*
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.UUID

/**
 * OkHttp interceptor that automatically records every HTTP request and its outcome
 * as nodes in the execution graph. Add this to your OkHttpClient once and it
 * instruments all network calls transparently.
 */
class DiagnosticOkHttpInterceptor : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val endpointLabel = "${request.method} ${request.url.encodedPath}"

        // Node: API call initiated
        GraphBuilder.addNode(
            GraphNode(
                id        = UUID.randomUUID().toString(),
                type      = NodeType.API_CALL,
                label     = "ApiCall:${request.url.encodedPath}",
                timestamp = System.currentTimeMillis(),
                metadata  = mapOf(
                    "method"      to request.method,
                    "url"         to request.url.toString(),
                    "bodyBytes"   to (request.body?.contentLength() ?: -1)
                ),
                outcome   = Outcome.PENDING
            )
        )

        val startMs = System.currentTimeMillis()

        return try {
            val response = chain.proceed(request)
            val durationMs = System.currentTimeMillis() - startMs
            val outcome = if (response.isSuccessful) Outcome.SUCCESS else Outcome.FAILURE

            // Node: API result received
            GraphBuilder.addNode(
                GraphNode(
                    id        = UUID.randomUUID().toString(),
                    type      = NodeType.API_RESULT,
                    label     = "ApiResult:${request.url.encodedPath}",
                    timestamp = System.currentTimeMillis(),
                    metadata  = mapOf(
                        "httpCode"    to response.code,
                        "durationMs"  to durationMs,
                        "success"     to response.isSuccessful,
                        "endpoint"    to endpointLabel
                    ),
                    outcome   = outcome
                )
            )
            response

        } catch (e: SocketTimeoutException) {
            val durationMs = System.currentTimeMillis() - startMs

            // Node: Timeout — this is the "known failure" we want to detect
            GraphBuilder.addNode(
                GraphNode(
                    id        = UUID.randomUUID().toString(),
                    type      = NodeType.API_RESULT,
                    label     = "ApiResult:TIMEOUT:${request.url.encodedPath}",
                    timestamp = System.currentTimeMillis(),
                    metadata  = mapOf(
                        "error"       to "SocketTimeoutException",
                        "message"     to (e.message ?: "timeout"),
                        "durationMs"  to durationMs,
                        "endpoint"    to endpointLabel
                    ),
                    outcome   = Outcome.TIMEOUT
                )
            )
            throw e  // Re-throw so the app handles it normally

        } catch (e: IOException) {
            GraphBuilder.addNode(
                GraphNode(
                    id        = UUID.randomUUID().toString(),
                    type      = NodeType.ERROR,
                    label     = "NetworkError:${request.url.encodedPath}",
                    timestamp = System.currentTimeMillis(),
                    metadata  = mapOf(
                        "error"    to e.javaClass.simpleName,
                        "message"  to (e.message ?: "unknown"),
                        "endpoint" to endpointLabel
                    ),
                    outcome   = Outcome.FAILURE
                )
            )
            throw e
        }
    }
}
