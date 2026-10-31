# Argus Companion — Zero-SDK Android Self-Diagnosis App

A standalone Android diagnostic companion app powered by **Approach C (Hybrid Accessibility + Local Loopback VPN)**. Argus Companion monitors UI interactions, screen transitions, and network endpoint outcomes across **ANY application** installed on your Android device — without modifying APKs, adding Gradle dependencies, or needing source code access.

---

## 🎯 Architecture & How It Works

```
┌────────────────────────────────────────────────────────┐
│ Target Application (e.g., E-Commerce, Banking, Food)   │
└───────────────┬────────────────────────┬───────────────┘
                │ UI Events              │ Network Calls
                ▼                        ▼
┌───────────────────────────┐ ┌───────────────────────────┐
│ ArgusAccessibilityService │ │      ArgusVpnService      │
│ (Screens, Taps, Switches) │ │ (DNS Sniffing, TLS SNI,   │
│                           │ │  Latency, Status Codes)   │
└───────────────┬───────────┘ └──────────┬────────────────┘
                │                        │
                └───────────┬────────────┘
                            ▼
              ┌───────────────────────────┐
              │  In-Memory FlightRecorder │
              │   (150-event circular)    │
              └─────────────┬─────────────┘
                            ▼
              ┌───────────────────────────┐
              │   JourneyGraphBuilder     │
              │  (Cumulative Session DAG) │
              └─────────────┬─────────────┘
                            ▼
              ┌───────────────────────────┐
              │  GeminiDiagnosticEngine   │
              │ (AI Root Cause Reasoning) │
              └───────────────────────────┘
```

### 1. Non-Invasive UI Interception (`ArgusAccessibilityService`)
* Uses Android's `AccessibilityService` API.
* Intercepts `TYPE_WINDOW_STATE_CHANGED` to detect screen and Activity transitions (`Screen:CheckoutActivity`).
* Intercepts `TYPE_VIEW_CLICKED` to extract clicked view resource IDs, content descriptions, and button labels (`Tap:btnPlaceOrder`).
* Detects foreground package transitions (`Switch → com.example.shop`).

### 2. Zero-Root Network Interception (`ArgusVpnService`)
* Uses Android's native `VpnService` API to establish a local TUN loopback interface.
* **DNS Sniffing:** Intercepts UDP port 53 queries to dynamically build an IP-to-Hostname cache without inspecting HTTPS payloads.
* **TLS SNI Inspection:** Parses the plaintext Server Name Indication header in TLS ClientHello packets on port 443 to identify which domains are called.
* **HTTP Status & Latency:** Measures round-trip connection latency and detects HTTP error codes (401, 403, 429, 500) and socket timeouts.

### 3. Cumulative Session Journey DAG (`JourneyGraphBuilder`)
* Synthesizes a chronological session journey:
  `ScreenView` ➔ `UserAction (Tap)` ➔ `ApiCall` ➔ `ApiResult`
* Correlates which specific button tap triggered which API call.
* Pins fault nodes (e.g. `TIMEOUT: api.example.com after 5000ms`, `HTTP 401 Unauthorized`) directly onto the divergence point where execution derailed.

### 4. Dual-Audience AI Diagnostician (`GeminiDiagnosticEngine`)
* Correlates the user's natural language symptom (e.g. *"I clicked pay, the spinner spun forever and failed"*) with the observed Journey DAG.
* **User-Facing Plain-English Report:** Non-technical, empathetic explanation (max 2 sentences).
* **Technical Root Cause:** Pinpoints endpoint, HTTP status, and timeout metrics for software engineers.
* **Offline Fallback:** If no Gemini API key is provided, the built-in deterministic heuristic correlator isolates faults locally.

---

## 📱 User Interface Tabs

1. **📡 Live Flight Trace:** Real-time stream of intercepted screens, taps, and network outcomes with latency and success badges.
2. **🔬 Self-Diagnosis:** Input field for user complaint, 1-tap "Diagnose My Problem" button, and behavioral diagnosis report card.
3. **⚙️ Settings:** Subsystem toggles for UI Monitor (Accessibility) and Network Monitor (VPN), plus Gemini API key management.

---

## 🛠️ Building & Installing

### Requirements
* Android SDK 34 (compileSdk: 34, minSdk: 26)
* JDK 17
* Gradle 8.2+

### Run on Device or Emulator
```bash
cd tools/argus-companion
./gradlew installDebug
```

1. Open **Argus Companion** on your phone.
2. Go to **Settings** and tap **Enable UI Monitor** (turns on Accessibility service).
3. Tap **Enable Network Monitor** (accepts the VPN prompt).
4. Switch to the target application you wish to diagnose and reproduce your problem.
5. Return to **Argus Companion** ➔ tap **Diagnose My Problem**.
