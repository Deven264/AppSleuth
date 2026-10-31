# Argus: SystemSleuth — Browser Extension 👁️
> **AI-Powered Behavioral Self-Diagnosis for Modern Software**  
> *Generate, visualize, and export Expected Behavioral Graphs (`expected_graph.json`) directly from any website without opening a terminal.*

---

## 🌟 Overview

When building or testing a web application, developers and QA teams often want to quickly define the **formal behavioral contract** of a page (what user actions exist, what network requests should trigger, what timeout limits are enforced, and how failure modes like CORS or timeouts should be handled).

Instead of manually crafting JSON or running CLI crawlers, the **Argus Browser Extension** runs directly inside Google Chrome or Microsoft Edge. With a single click, it:
1. **Harvests DOM Evidence:** Inspects headings, interactive buttons, form structures, and embedded API fetch endpoints.
2. **Synthesizes Behavioral Contract:** Generates a formal Argus state machine using a **Hybrid AI Architecture**:
   - **Offline Heuristic Synthesizer:** Instant, runs 100% locally in-browser with zero configuration and zero API keys required.
   - **Google Gemini 1.5 Flash AI:** Optional deep semantic reasoning that maps complex multi-step user workflows and known failure modes.
3. **Interactive Visualizer:** Renders an interactive 2D canvas state machine right in the popup with color-coded pathways.
4. **1-Click Export:** Download `expected_graph.json` or copy the specification to paste directly into your project.

---

## 🚀 Key Features

| Feature | Description |
|---|---|
| **Zero-CLI Workflow** | No Node.js or Python CLI needed. Diagnose problems directly on the live website. |
| **📡 Rolling Flight Recorder** | In-page circular in-memory buffer (`recorder.js`) that captures clicks, native `fetch`, `XHR`, latencies, and HTTP status codes before you even open the extension. |
| **🔬 Live Self-Diagnosis** | When a problem happens, open the extension, type what went wrong, and get an instant plain-English answer + technical root cause. |
| **Canvas Red Divergence** | Pinpoints the exact failure node on the interactive Canvas visualizer in **pulsing red**! |
| **Hybrid AI Engine** | Instant offline generation by default; switches to Gemini Flash when an API key is supplied. |
| **1-Click Engineering Export** | Generates a senior-engineer-ready incident report formatted for Jira, Slack, or GitHub issues. |
| **100% Argus Compatible** | Output directly matches the schema required by `@argus/web-sdk` and `tools/diagnostic-engine/`. |

---

## 📦 Installation (Chrome / Edge / Brave / Opera)

The extension is built with **Manifest V3** and runs directly unpacked:

1. Open your browser and navigate to the Extensions management page:
   - **Chrome / Brave:** `chrome://extensions`
   - **Edge:** `edge://extensions`
2. Turn **ON** **Developer mode** (toggle switch in the top-right corner).
3. Click the **"Load unpacked"** button.
4. Browse to and select the folder:
   ```
   <Argus-Repo-Path>/tools/browser-extension
   ```
5. Pin the **Argus: SystemSleuth** extension to your browser toolbar for quick access.

---

## 💡 How to Use

1. **Open Any Web Application:** Navigate to any website or local dev server (e.g., `http://localhost:3000`, `https://example.com/checkout`).
2. **Open Argus Extension:** Click the Argus icon in your toolbar. The extension will automatically read page metadata and detect interactive buttons, forms, and network endpoints.
3. **(Optional) Configure Gemini AI:**
   - Expand `⚙️ AI Model Configuration`.
   - Paste your [Google Gemini API Key](https://aistudio.google.com/app/apikey).
   - Click **Save**. (Saved securely in your browser's local storage).
   - *If skipped, Argus will instantly use its built-in offline engine.*
4. **Generate Graph:** Click `⚡ Generate Expected Graph`.
5. **Inspect the Results:**
   - **📊 Visualizer Tab:** View the state machine graph. Click any node to inspect constraints and failure modes in the detail panel.
   - **📄 JSON Spec Tab:** View the formatted `expected_graph.json`.
   - **🔍 Discovered Evidence Tab:** Review all detected buttons, forms, and endpoints that informed the synthesis.
6. **Export:** Click `💾 Download expected_graph.json` or `📋 Copy JSON`.

---

## 📂 Architecture

```
tools/browser-extension/
├── manifest.json            # Manifest V3 extension configuration
├── popup.html               # Popup UI (Card layout, tabs, canvas, node inspector)
├── popup.css                # Dark theme styling, badges, canvas layout
├── popup.js                 # Controller: content injection, hybrid AI, canvas renderer
├── content_extractor.js     # Harvester script injected into target webpage
├── icons/                   # Extension icons (16px, 48px, 128px)
└── README.md                # Documentation & usage guide
```

---

## 🔗 Compatibility with Argus Ecosystem

The generated `expected_graph.json` can immediately be:
- Placed in your web app for the **Argus Web SDK** (`packages/web-sdk/`):
  ```typescript
  import { Argus } from '@argus/web-sdk';
  import expectedGraph from './expected_graph.json';

  Argus.init({
    projectId: 'my-web-app',
    expectedGraph: expectedGraph
  });
  ```
- Fed into the **Argus AI Diagnostic Engine** (`tools/diagnostic-engine/`):
  ```bash
  python tools/diagnostic-engine/diagnose.py \
    --expected expected_graph.json \
    --execution actual_session.json
  ```
