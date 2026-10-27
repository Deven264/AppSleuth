package com.appsleuth.diagnostic

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.core.content.FileProvider
import java.io.File

object GraphStorageHelper {
    private const val TAG = "AppSleuthStorage"
    const val FILE_NAME = "execution_graph.json"

    /**
     * Saves the execution graph JSON directly into the device's Downloads directory.
     * On Android 10+ (Q+), uses MediaStore.Downloads with zero special permissions required.
     * Returns the human-readable saved path or destination.
     */
    fun saveToDownloads(context: Context, jsonContent: String): String {
        var userReadableLocation = "Downloads/$FILE_NAME"

        // 1. Save to device Public Downloads folder
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = context.contentResolver
                val contentValues = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, FILE_NAME)
                    put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                }
                val uri: Uri? = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
                if (uri != null) {
                    resolver.openOutputStream(uri)?.use { stream ->
                        stream.write(jsonContent.toByteArray(Charsets.UTF_8))
                    }
                    Log.d(TAG, "Successfully written to MediaStore Downloads: $uri")
                }
            } else {
                @Suppress("DEPRECATION")
                val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                if (!downloadsDir.exists()) {
                    downloadsDir.mkdirs()
                }
                val file = File(downloadsDir, FILE_NAME)
                file.writeText(jsonContent)
                userReadableLocation = file.absolutePath
                MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), null, null)
                Log.d(TAG, "Successfully written to legacy Downloads: ${file.absolutePath}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error writing to public Downloads folder", e)
        }

        // 2. Also save to app's external files directory (easily accessible via USB file transfer)
        try {
            val extDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            if (extDir != null) {
                val extFile = File(extDir, FILE_NAME)
                extFile.writeText(jsonContent)
                Log.d(TAG, "Also saved to app external files dir: ${extFile.absolutePath}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error writing to app external files dir", e)
        }

        return userReadableLocation
    }

    /**
     * Reads the current recorded graph JSON string.
     */
    fun getRecordedGraphJson(context: Context): String? {
        val file = File(context.filesDir, FILE_NAME)
        return if (file.exists()) file.readText() else null
    }

    /**
     * Shows a dialog displaying the execution graph with Copy & Share buttons.
     */
    fun showGraphDialog(activity: Activity) {
        val json = getRecordedGraphJson(activity)
        if (json.isNullOrBlank()) {
            Toast.makeText(activity, "No execution graph recorded yet. Run a flow first!", Toast.LENGTH_SHORT).show()
            return
        }

        val textView = TextView(activity).apply {
            text = json
            setPadding(32, 24, 32, 24)
            setTextIsSelectable(true)
            textSize = 12f
        }
        val scrollView = ScrollView(activity).apply {
            addView(textView)
        }

        AlertDialog.Builder(activity)
            .setTitle("Execution Graph (${FILE_NAME})")
            .setView(scrollView)
            .setPositiveButton("Copy to Clipboard") { _, _ ->
                val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("Execution Graph", json))
                Toast.makeText(activity, "Graph JSON copied to clipboard!", Toast.LENGTH_SHORT).show()
            }
            .setNeutralButton("Share File") { _, _ ->
                shareGraphFile(activity)
            }
            .setNegativeButton("Close", null)
            .show()
    }

    /**
     * Launches the native Android Share sheet to share the graph JSON file.
     * Works with WhatsApp, Gmail, Drive, Quick Share, Bluetooth, Slack, etc.
     */
    fun shareGraphFile(context: Context) {
        val file = File(context.filesDir, FILE_NAME)
        if (!file.exists()) {
            Toast.makeText(context, "No execution graph recorded yet!", Toast.LENGTH_SHORT).show()
            return
        }

        try {
            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                file
            )

            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "application/json"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, "AppSleuth Execution Graph")
                putExtra(Intent.EXTRA_TEXT, "Here is the recorded execution graph from AppSleuth.")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            context.startActivity(Intent.createChooser(shareIntent, "Share Execution Graph"))
        } catch (e: Exception) {
            Log.e(TAG, "Error opening share sheet", e)
            Toast.makeText(context, "Could not open share sheet: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }
}
