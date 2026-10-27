package com.appsleuth

import android.app.Application
import android.util.Log
import com.appsleuth.diagnostic.DiagnosticSession
import com.appsleuth.diagnostic.tracker.ActivityTracker

class AppSleuthApplication : Application() {

    override fun onCreate() {
        super.onCreate()

        // Start the diagnostic session — records all activity from here on
        DiagnosticSession.start(appVersion = "1.0.0")

        // Register the activity tracker for automatic screen-view nodes
        registerActivityLifecycleCallbacks(ActivityTracker())

        // Flush the graph on any uncaught crash
        val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            Log.e("AppSleuth", "Uncaught exception — flushing graph", throwable)
            DiagnosticSession.flush(applicationContext)
            defaultHandler?.uncaughtException(thread, throwable)
        }
    }
}
