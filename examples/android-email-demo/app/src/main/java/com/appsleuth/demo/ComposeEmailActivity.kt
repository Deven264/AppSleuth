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
