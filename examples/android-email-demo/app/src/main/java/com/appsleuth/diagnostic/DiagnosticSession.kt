package com.appsleuth.diagnostic

import android.content.Context
import android.util.Log
import com.appsleuth.diagnostic.model.*
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import java.io.File
import java.util.UUID

object DiagnosticSession {

    private var sessionId: String = ""
    private var appVersion: String = ""
    private var startTime: Long = 0L
    private val gson: Gson = GsonBuilder().setPrettyPrinting().create()

    const val TAG = "AppSleuth"

    fun start(appVersion: String) {
        GraphBuilder.reset()
        sessionId = UUID.randomUUID().toString()
        this.appVersion = appVersion
        startTime = System.currentTimeMillis()

        GraphBuilder.addNode(
            GraphNode(
                id = UUID.randomUUID().toString(),
                type = NodeType.SESSION_START,
                label = "SessionStart",
                timestamp = startTime,
                metadata = mapOf(
                    "sessionId"  to sessionId,
                    "appVersion" to appVersion
                ),
                outcome = Outcome.SUCCESS
            )
        )
        Log.d(TAG, "Diagnostic session started: $sessionId")
    }

    /**
     * Serialize the current execution graph to JSON and save it to:
     * 1) App internal storage
     * 2) Device's public Downloads directory (accessible directly via Files app on device)
     * Returns the user-friendly destination path.
     */
    fun flush(context: Context): String {
        val graph = ExecutionGraph(
            sessionId  = sessionId,
            appVersion = appVersion,
            startTime  = startTime,
            endTime    = System.currentTimeMillis(),
            nodes      = GraphBuilder.getNodes(),
            edges      = GraphBuilder.getEdges()
        )
        val json = gson.toJson(graph)

        // 1. App internal files directory
        val file = File(context.filesDir, GraphStorageHelper.FILE_NAME)
        file.writeText(json)

        // 2. Device Downloads directory (no adb needed!)
        val location = GraphStorageHelper.saveToDownloads(context, json)

        Log.d(TAG, "Execution graph saved: internal=${file.absolutePath}, location=$location")
        Log.d(TAG, "Graph: ${graph.nodes.size} nodes, ${graph.edges.size} edges")
        return location
    }
}
