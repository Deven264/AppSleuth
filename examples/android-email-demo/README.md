# Argus — Android Demo Application

This is an example Android application instrumented with the **Argus Diagnostic SDK**.

## Overview

The demo simulates an email client where a user composes and sends an email with a 4.2 MB PDF attachment.
It contains an **intentional real-world failure mode**:
- The simulated backend server delays responding to the attachment upload by 60 seconds.
- The HTTP client (OkHttp) times out at 10 seconds (`SocketTimeoutException`).

## Built-In Instrumentation

The diagnostic layer records user interactions and system events into a local **Execution Graph**:
1. **Screen Navigation:** Auto-tracked via `ActivityTracker` (`Application.ActivityLifecycleCallbacks`).
2. **User Actions:** Recorded when buttons (e.g., *Compose Email*, *Send Email*) are tapped.
3. **Network Layer:** Transparently captured by `DiagnosticOkHttpInterceptor` (recording method, URL, status code, and `TIMEOUT` outcome).
4. **On-Device Storage:** Flushed directly to the device's public **Downloads** directory (`Downloads/execution_graph.json`) via `MediaStore` — no ADB commands needed!
5. **In-App Viewer & Share Sheet:** Tap *View Execution Graph* to inspect the nodes on-device or *Share Graph* to send via WhatsApp, Drive, Gmail, etc.

## How to Run

1. Open Android Studio.
2. Select **Open** and choose this directory: `examples/android-email-demo`.
3. Allow Gradle to sync dependencies.
4. Run the app on an Android device or emulator (API 24+).
5. Tap **Compose Email** → tap **Send Email**.
6. Wait 10 seconds for the upload to time out.
7. Inspect the generated graph via the in-app viewer or check your device's `Downloads/execution_graph.json`.
