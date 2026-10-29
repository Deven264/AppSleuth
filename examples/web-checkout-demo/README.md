# Argus — Web Checkout Demo Application

An interactive e-commerce checkout application instrumented with the **Argus Web Diagnostic SDK**.

---

## 🛍️ What This Demo Demonstrates

1. **Zero-Setup Web Instrumentation:** Uses `@argus/web` via a single `<script>` tag.
2. **Automatic Runtime Tracking:**
   - **Navigation & Page Views:** Auto-tracks entry point (`PageView:/checkout`).
   - **User Clicks:** Automatically records clicks on the "Pay Now" button.
   - **Network Interception:** Transparently captures `fetch()` calls to `/api/v1/charge`, including status codes, latency, and timeouts.
3. **Intentional Real-World Web Failure Modes:**
   - **Scenario 1 (Default):** Payment Gateway Timeout — The request hangs for 8 seconds and times out.
   - **Scenario 2:** CORS Preflight Rejection — The browser blocks the payment API call.
   - **Scenario 3:** Normal Happy Path — Payment succeeds with HTTP 200.
4. **In-Browser Diagnostic Pill:**
   - A floating pill on the bottom-right corner (`👁️ Argus`).
   - Turns red with a warning (`⚠️ 1 failure`) when the payment times out.
   - Click it to view the full graph, copy the JSON, or download `execution_graph.json` directly from the browser!

---

## 🏃‍♂️ How to Run

Zero build steps required! Simply open `index.html` in any browser:

```bash
# On Windows PowerShell:
Start-Process "examples\web-checkout-demo\index.html"

# Or on macOS:
open examples/web-checkout-demo/index.html

# Or serve locally using any static server:
npx serve examples/web-checkout-demo
```

### Try the Failure Flow:
1. Open the page in your browser.
2. Ensure the top dropdown is set to **"Simulate Payment Timeout"**.
3. Click **Pay $268.92**.
4. Watch the button spin for 8 seconds.
5. The payment fails with an error alert, and the **Argus floating pill** in the bottom-right turns red!
6. Click the pill to inspect the exact `ApiResult:TIMEOUT` node and copy the JSON!
