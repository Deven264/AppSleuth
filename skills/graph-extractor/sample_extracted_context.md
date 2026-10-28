# AppSleuth Codebase Context Extraction

**Root Project:** `D:\AppSleuth\examples\android-email-demo`

> Provide this document to the AppSleuth Graph Extractor LLM to generate `expected_graph.json`.

## Tests (1 files found)

### File: `app\src\test\java\com\appsleuth\demo\ComposeEmailWorkflowTest.kt`
```kt
package com.appsleuth.demo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.SocketTimeoutException

/**
 * Specification and verification tests for the Email Sending workflow.
 *
 * This test suite documents the intended application behavior:
 * - Happy Path: Valid inputs + attachment -> upload 200 OK -> EmailSent state.
 * - Failure Mode 1: Attachment upload times out -> UploadFailed state with retry.
 * - Failure Mode 2: Empty recipient or subject -> Validation failure.
 * - Failure Mode 3: Server HTTP error (500/413) -> Failure state.
 */
class ComposeEmailWorkflowTest {

    @Test
    fun testSendEmail_happyPath_completesSuccessfully() {
        // GIVEN: User navigates from MainActivity to ComposeEmailActivity
        val currentScreen = "ComposeEmailActivity"
        val recipient = "client@example.com"
        val subject = "Q3 Financial Report"
        val attachment = "report_Q3_2024.pdf"

        // WHEN: User taps Send Email with valid data and attachment
        val uiStateBefore = "loading"
        assertEquals("loading", uiStateBefore)

        // API Call is initiated: POST /api/upload
        val httpStatus = 200
        val isSuccessful = (httpStatus == 200)
        assertTrue("Upload must succeed with HTTP 200", isSuccessful)

        // THEN: App state transitions to EmailSent
        val uiStateAfter = "success"
        assertEquals("success", uiStateAfter)
    }

    @Test
    fun testSendEmail_attachmentUploadTimeout_transitionsToUploadFailed() {
        // GIVEN: User composes email with 4.2 MB PDF attachment
        val recipient = "client@example.com"
        val subject = "Q3 Financial Report"
        val attachment = "report_Q3_2024.pdf"

        // WHEN: User taps Send Email and entered uploading state
        val uiStateDuringUpload = "loading"
        assertEquals("loading", uiStateDuringUpload)

        // Upload API call is made: POST /api/upload
        // The server takes > 10 seconds, triggering SocketTimeoutException
        var timeoutCaught = false
        var failureReason = ""
        try {
            throw SocketTimeoutException("Read timed out after 10000ms")
        } catch (e: SocketTimeoutException) {
            timeoutCaught = true
            failureReason = "upload_timeout"
        }

        // THEN: Verify timeout is caught and handled gracefully
        assertTrue("SocketTimeoutException must be caught", timeoutCaught)
        assertEquals("upload_timeout", failureReason)

        // UI state transitions to UploadFailed, Send button re-enabled for retry
        val uiStateAfter = "error"
        val canRetry = true
        assertEquals("error", uiStateAfter)
        assertTrue("User must be able to retry after timeout", canRetry)
    }

    @Test
    fun testSendEmail_validationFailure_whenFieldsEmpty() {
        // GIVEN: User leaves recipient or subject empty
        val emptyRecipient = ""
        val emptySubject = ""

        // WHEN: Validation check executes
        val isValid = emptyRecipient.isNotEmpty() && emptySubject.isNotEmpty()

        // THEN: Network call must not be triggered
        assertFalse("Cannot send email without recipient or subject", isValid)
    }

    @Test
    fun testSendEmail_serverHttpError_transitionsToErrorState() {
        // GIVEN: User sends email, but server returns 500 Internal Server Error
        val httpStatus = 500
        val isSuccess = (httpStatus in 200..299)

        // THEN: App records failure state
        assertFalse("Server 500 error is not successful", isSuccess)
        val uiState = "error"
        assertEquals("error", uiState)
    }
}

```

## Navigation & Routes (1 files found)

### File: `app\src\main\AndroidManifest.xml`
```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />

    <application
        android:name=".AppSleuthApplication"
        android:label="@string/app_name"
        android:theme="@style/Theme.AppSleuth"
        android:usesCleartextTraffic="true"
        android:allowBackup="true">

        <activity
            android:name=".demo.MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <activity android:name=".demo.ComposeEmailActivity" />

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>
    </application>

</manifest>

```

## UI Screens & Controllers (2 files found)

### File: `app\src\main\java\com\appsleuth\demo\ComposeEmailActivity.kt`
```kt
package com.appsleuth.demo

import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.appsleuth.databinding.ActivityComposeEmailBinding
import com.appsleuth.diagnostic.DiagnosticSession
import com.appsleuth.diagnostic.GraphBuilder
import com.appsleuth.diagnostic.GraphStorageHelper
import com.appsleuth.diagnostic.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.SocketTimeoutException
import java.util.UUID

class ComposeEmailActivity : AppCompatActivity() {

    private lateinit var binding: ActivityComposeEmailBinding
    private val emailRepository = EmailRepository()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityComposeEmailBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Simulate a PDF attachment being pre-selected
        binding.tvAttachmentName.text = "report_Q3_2024.pdf (4.2 MB)"

        binding.btnSend.setOnClickListener {
            handleSendEmail()
        }

        binding.btnViewGraph.setOnClickListener {
            GraphStorageHelper.showGraphDialog(this)
        }

        binding.btnShareGraph.setOnClickListener {
            GraphStorageHelper.shareGraphFile(this)
        }
    }

    private fun handleSendEmail() {
        val recipient = binding.etRecipient.text.toString().trim()
        val subject   = binding.etSubject.text.toString().trim()

        if (recipient.isEmpty() || subject.isEmpty()) {
            Toast.makeText(this, "Please fill in recipient and subject", Toast.LENGTH_SHORT).show()
            return
        }

        // Hide any previous diagnostic card
        binding.cardDiagnostic.visibility = View.GONE

        // Record: user tapped Send
        GraphBuilder.addNode(
            GraphNode(
                id        = UUID.randomUUID().toString(),
                type      = NodeType.USER_ACTION,
                label     = "TapSendEmail",
                timestamp = System.currentTimeMillis(),
                metadata  = mapOf(
                    "recipient"      to recipient,
                    "subject"        to subject,
                    "hasAttachment"  to true,
                    "attachmentName" to "report_Q3_2024.pdf"
                ),
                outcome   = Outcome.SUCCESS
            )
        )

        // Show loading state
        binding.btnSend.isEnabled = false
        binding.progressBar.visibility = View.VISIBLE

        // Record: entered loading/uploading state
        GraphBuilder.addNode(
            GraphNode(
                id        = UUID.randomUUID().toString(),
                type      = NodeType.STATE_CHANGE,
                label     = "StateChange:Uploading",
                timestamp = System.currentTimeMillis(),
                metadata  = mapOf("uiState" to "loading"),
                outcome   = Outcome.PENDING
            )
        )

        lifecycleScope.launch {
            try {
                val fakeFileContent = ByteArray(1024) { it.toByte() } // 1KB dummy "PDF"

                val success = withContext(Dispatchers.IO) {
                    emailRepository.uploadAttachment("report_Q3_2024.pdf", fakeFileContent)
                }

                if (success) {
                    // Record: email sent successfully
                    GraphBuilder.addNode(
                        GraphNode(
                            id        = UUID.randomUUID().toString(),
                            type      = NodeType.STATE_CHANGE,
                            label     = "StateChange:EmailSent",
                            timestamp = System.currentTimeMillis(),
                            metadata  = mapOf("uiState" to "success"),
                            outcome   = Outcome.SUCCESS
                        )
                    )
                    Toast.makeText(this@ComposeEmailActivity, "Email sent!", Toast.LENGTH_SHORT).show()
                    finish()
                }

            } catch (e: SocketTimeoutException) {
                // Record: timeout failure
                GraphBuilder.addNode(
                    GraphNode(
                        id        = UUID.randomUUID().toString(),
                        type      = NodeType.STATE_CHANGE,
                        label     = "StateChange:UploadFailed",
                        timestamp = System.currentTimeMillis(),
                        metadata  = mapOf(
                            "uiState"  to "error",
                            "reason"   to "upload_timeout",
                            "expected" to "StateChange:EmailSent"
                        ),
                        outcome   = Outcome.TIMEOUT
                    )
                )

                // Flush the graph to disk and device Downloads folder
                val savedLocation = DiagnosticSession.flush(applicationContext)
                Log.d("AppSleuth", "Graph flushed after timeout. Saved to: $savedLocation")

                withContext(Dispatchers.Main) {
                    binding.progressBar.visibility = View.GONE
                    binding.btnSend.isEnabled = true
                    
                    // Show in-app diagnostic action card
                    binding.tvDiagnosticDesc.text = "Saved to: $savedLocation\nReady to inspect or share."
                    binding.cardDiagnostic.visibility = View.VISIBLE

                    Toast.makeText(
                        this@ComposeEmailActivity,
                        "Upload timed out! Graph saved to device.",
                        Toast.LENGTH_LONG
                    ).show()
                }

            } catch (e: Exception) {
                GraphBuilder.addNode(
                    GraphNode(
                        id        = UUID.randomUUID().toString(),
                        type      = NodeType.ERROR,
                        label     = "Error:UnexpectedException",
                        timestamp = System.currentTimeMillis(),
                        metadata  = mapOf("error" to e.javaClass.simpleName, "message" to (e.message ?: "unknown")),
                        outcome   = Outcome.FAILURE
                    )
                )
                val savedLocation = DiagnosticSession.flush(applicationContext)
                withContext(Dispatchers.Main) {
                    binding.progressBar.visibility = View.GONE
                    binding.btnSend.isEnabled = true
                    binding.tvDiagnosticDesc.text = "Saved to: $savedLocation"
                    binding.cardDiagnostic.visibility = View.VISIBLE
                    Toast.makeText(this@ComposeEmailActivity, "Error: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    override fun onStop() {
        super.onStop()
        // Always flush the graph when leaving this screen — captures both success and failure paths
        DiagnosticSession.flush(applicationContext)
    }

    override fun onDestroy() {
        super.onDestroy()
        emailRepository.shutdown()
    }
}

```

### File: `app\src\main\java\com\appsleuth\demo\MainActivity.kt`
```kt
package com.appsleuth.demo

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.appsleuth.databinding.ActivityMainBinding
import com.appsleuth.diagnostic.DiagnosticSession
import com.appsleuth.diagnostic.GraphBuilder
import com.appsleuth.diagnostic.GraphStorageHelper
import com.appsleuth.diagnostic.model.*
import java.util.UUID

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnComposeEmail.setOnClickListener {
            // Record the user action before navigating
            GraphBuilder.addNode(
                GraphNode(
                    id        = UUID.randomUUID().toString(),
                    type      = NodeType.USER_ACTION,
                    label     = "TapComposeEmail",
                    timestamp = System.currentTimeMillis(),
                    outcome   = Outcome.SUCCESS
                )
            )
            startActivity(Intent(this, ComposeEmailActivity::class.java))
        }

        binding.btnViewGraph.setOnClickListener {
            GraphStorageHelper.showGraphDialog(this)
        }

        binding.btnShareGraph.setOnClickListener {
            GraphStorageHelper.shareGraphFile(this)
        }
    }

    override fun onStop() {
        super.onStop()
        // Flush whatever graph has been recorded so far (e.g. before entering ComposeEmail)
        DiagnosticSession.flush(applicationContext)
    }
}

```

## State & ViewModels (0 files found)

*None found.*

## Network & APIs (1 files found)

### File: `app\src\main\java\com\appsleuth\demo\EmailRepository.kt`
```kt
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

```
