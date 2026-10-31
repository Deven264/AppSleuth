package com.appsleuth.argus.companion.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import com.appsleuth.argus.companion.model.EventType
import com.appsleuth.argus.companion.model.FlightEvent
import com.appsleuth.argus.companion.model.Outcome
import com.appsleuth.argus.companion.recorder.FlightRecorder

/**
 * Android Accessibility Service that non-invasively captures UI interaction events
 * from ANY installed application on the device.
 *
 * This is the Android counterpart of the browser extension's DOM event interceptor.
 * It intercepts:
 * - SCREEN_VIEW: Activity/screen transitions
 * - USER_ACTION: Button, list item, or interactive element taps
 * - APP_SWITCH: Switching foreground applications
 */
class ArgusAccessibilityService : AccessibilityService() {

    companion object {
        const val TAG = "ArgusAccessibility"

        @Volatile
        var isRunning: Boolean = false
            private set

        /** Packages to filter out as ambient OS noise */
        private val IGNORED_PACKAGES = setOf(
            "com.appsleuth.argus.companion",
            "com.android.systemui",
            "com.google.android.inputmethod.latin",
            "com.samsung.android.honeyboard",
            "com.touchtype.swiftkey",
            "com.android.launcher3",
            "com.google.android.apps.nexuslauncher",
            "com.sec.android.app.launcher",
            "android"
        )
    }

    private var lastScreenLabel = ""
    private var lastPackage = ""

    override fun onServiceConnected() {
        super.onServiceConnected()
        isRunning = true
        Log.i(TAG, "Argus Accessibility Service connected and active")

        val info = serviceInfo ?: AccessibilityServiceInfo()
        info.eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                AccessibilityEvent.TYPE_VIEW_CLICKED or
                AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
        info.notificationTimeout = 100
        info.flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        serviceInfo = info
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg in IGNORED_PACKAGES) return

        try {
            when (event.eventType) {
                AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> handleScreenChange(event, pkg)
                AccessibilityEvent.TYPE_VIEW_CLICKED -> handleViewClick(event, pkg)
                else -> Unit
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error handling accessibility event: ${e.message}")
        }
    }

    private fun handleScreenChange(event: AccessibilityEvent, pkg: String) {
        val texts = event.text
        val screenTitle = when {
            texts != null && texts.isNotEmpty() -> texts.joinToString(" / ") { it.toString() }.trim()
            event.className != null -> event.className.toString().substringAfterLast(".")
            else -> pkg.substringAfterLast(".")
        }.take(80)

        if (screenTitle == lastScreenLabel && pkg == lastPackage) return

        // Detect app switch
        if (pkg != lastPackage && lastPackage.isNotEmpty()) {
            FlightRecorder.record(
                FlightEvent(
                    type = EventType.APP_SWITCH,
                    sourceApp = pkg,
                    label = "Switch → ${pkg.substringAfterLast(".")}",
                    outcome = Outcome.SUCCESS
                )
            )
        }

        lastScreenLabel = screenTitle
        lastPackage = pkg

        FlightRecorder.record(
            FlightEvent(
                type = EventType.SCREEN_VIEW,
                sourceApp = pkg,
                label = "Screen:$screenTitle",
                outcome = Outcome.SUCCESS
            )
        )
        Log.d(TAG, "[$pkg] ScreenView: $screenTitle")
    }

    private fun handleViewClick(event: AccessibilityEvent, pkg: String) {
        val label = buildString {
            val desc = event.contentDescription?.toString()
            val text = event.text?.joinToString(" ") { it.toString() }?.trim()
            val viewId = event.source?.viewIdResourceName?.substringAfterLast("/")

            when {
                !desc.isNullOrBlank() -> append(desc)
                !text.isNullOrBlank() -> append(text)
                !viewId.isNullOrBlank() -> append(viewId)
                else -> append("ActionElement")
            }
        }.take(60)

        FlightRecorder.record(
            FlightEvent(
                type = EventType.USER_ACTION,
                sourceApp = pkg,
                label = "Tap:$label",
                outcome = Outcome.SUCCESS
            )
        )
        Log.d(TAG, "[$pkg] UserAction: Tap:$label")
    }

    override fun onInterrupt() {
        Log.w(TAG, "Argus Accessibility Service interrupted")
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        Log.i(TAG, "Argus Accessibility Service destroyed")
    }
}
