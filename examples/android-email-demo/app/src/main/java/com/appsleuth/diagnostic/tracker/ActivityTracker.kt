package com.appsleuth.diagnostic.tracker

import android.app.Activity
import android.app.Application
import android.os.Bundle
import com.appsleuth.diagnostic.GraphBuilder
import com.appsleuth.diagnostic.model.*
import java.util.UUID

/**
 * Registered once in Application.onCreate(). Automatically emits a SCREEN_VIEW
 * node every time a new Activity is resumed — zero per-screen boilerplate.
 */
class ActivityTracker : Application.ActivityLifecycleCallbacks {

    override fun onActivityResumed(activity: Activity) {
        GraphBuilder.addNode(
            GraphNode(
                id        = UUID.randomUUID().toString(),
                type      = NodeType.SCREEN_VIEW,
                label     = "Screen:${activity.javaClass.simpleName}",
                timestamp = System.currentTimeMillis(),
                metadata  = mapOf(
                    "activityClass" to activity.javaClass.name
                ),
                outcome   = Outcome.SUCCESS
            )
        )
    }

    override fun onActivityCreated(a: Activity, b: Bundle?) = Unit
    override fun onActivityStarted(a: Activity) = Unit
    override fun onActivityPaused(a: Activity) = Unit
    override fun onActivityStopped(a: Activity) = Unit
    override fun onActivitySaveInstanceState(a: Activity, b: Bundle) = Unit
    override fun onActivityDestroyed(a: Activity) = Unit
}
