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
