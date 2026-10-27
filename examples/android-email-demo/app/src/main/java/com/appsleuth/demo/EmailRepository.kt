package com.appsleuth.demo

import com.appsleuth.diagnostic.interceptor.DiagnosticOkHttpInterceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import java.util.concurrent.TimeUnit

/**
 * EmailRepository handles email sending.
 *
 * BUG (intentional): The MockWebServer is configured with a 60-second delay on /api/upload
 * so the OkHttp client (with a 10s timeout) always times out before receiving a response.
 * This simulates a real attachment-upload timeout failure.
 *
 * NOTE: MockWebServer is initialized lazily and on background IO thread to prevent
 * any NetworkOnMainThreadException or UI freezes.
 */
class EmailRepository {

    private var mockServer: MockWebServer? = null

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)      // Will timeout before server responds
        .writeTimeout(10, TimeUnit.SECONDS)
        .addInterceptor(DiagnosticOkHttpInterceptor())   // Diagnostic layer wired in here
        .build()

    @Synchronized
    private fun getOrStartUploadUrl(): String {
        if (mockServer == null) {
            val server = MockWebServer()
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    return MockResponse()
                        .setBody("""{"status":"ok"}""")
                        .setHeadersDelay(60, TimeUnit.SECONDS) // Delay headers — OkHttp read timeout fires at 10s
                }
            }
            server.start()
            mockServer = server
        }
        return mockServer!!.url("/api/upload").toString()
    }

    /**
     * Attempts to upload a PDF attachment. Will timeout due to the mock server delay.
     * Throws SocketTimeoutException — caller must handle it.
     * Must be called from a background thread (e.g. Dispatchers.IO).
     */
    fun uploadAttachment(fileName: String, fileContent: ByteArray): Boolean {
        val uploadUrl = getOrStartUploadUrl()

        val requestBody = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart(
                "file", fileName,
                fileContent.toRequestBody("application/pdf".toMediaType())
            )
            .build()

        val request = Request.Builder()
            .url(uploadUrl)
            .post(requestBody)
            .build()

        client.newCall(request).execute().use { response ->
            return response.isSuccessful
        }
    }

    fun shutdown() {
        val server = mockServer
        mockServer = null
        if (server != null) {
            Thread {
                try {
                    server.shutdown()
                } catch (_: Exception) {}
            }.start()
        }
    }
}
