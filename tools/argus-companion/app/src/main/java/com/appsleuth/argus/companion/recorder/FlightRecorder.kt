package com.appsleuth.argus.companion.recorder

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import com.appsleuth.argus.companion.model.FlightEvent
import java.util.LinkedList

/**
 * Thread-safe, circular in-memory buffer that stores the last MAX_EVENTS
 * flight events intercepted across all Android applications.
 * Directly corresponds to the browser extension's window.__ARGUS_FLIGHT_RECORDER_BUFFER__.
 */
object FlightRecorder {

    const val MAX_EVENTS = 150

    private val lock = Any()
    private val buffer = LinkedList<FlightEvent>()

    private val _events = MutableLiveData<List<FlightEvent>>(emptyList())
    val events: LiveData<List<FlightEvent>> = _events

    /** Currently focused application package name */
    private val _activeApp = MutableLiveData<String>("")
    val activeApp: LiveData<String> = _activeApp

    fun record(event: FlightEvent) {
        synchronized(lock) {
            buffer.addLast(event)
            if (buffer.size > MAX_EVENTS) {
                buffer.removeFirst()
            }
            _events.postValue(buffer.toList())

            // Update active app if it's not system or companion itself
            if (event.sourceApp.isNotBlank() &&
                event.sourceApp != "android" &&
                !event.sourceApp.startsWith("com.appsleuth.argus") &&
                !event.sourceApp.contains("launcher") &&
                !event.sourceApp.contains("systemui")
            ) {
                _activeApp.postValue(event.sourceApp)
            }
        }
    }

    fun getSnapshot(): List<FlightEvent> = synchronized(lock) { buffer.toList() }

    fun clear() {
        synchronized(lock) {
            buffer.clear()
            _events.postValue(emptyList())
        }
    }

    fun size(): Int = synchronized(lock) { buffer.size }
}
