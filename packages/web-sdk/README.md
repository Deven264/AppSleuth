# @argus/web — Argus Web Diagnostic SDK

The official JavaScript/TypeScript SDK for recording runtime execution graphs in web applications.

---

## 🌟 Features

* **Zero Heavy Dependencies:** Lightweight, vanilla JavaScript core compatible with React, Next.js, Vue, Svelte, and vanilla HTML/JS.
* **Auto-Interception:**
  * **Fetch / Network:** Intercepts `window.fetch` to record endpoints, status codes, request latency, CORS errors, and timeouts.
  * **Navigation & Routing:** Listens to `popstate`, `hashchange`, and patches `pushState`/`replaceState` for client-side SPA routers.
  * **User Actions:** Automatically records clicks on buttons, links, and forms.
  * **Errors:** Captures unhandled JavaScript exceptions and promise rejections.
* **In-Page Diagnostic Pill & Modal:** A floating UI widget (`👁️ Argus`) that allows users or QA engineers to inspect, copy, or download the recorded graph in 1 click with zero terminal tools.

---

## 🚀 Quickstart

### Option 1: Vanilla HTML / Direct Script Tag

Add the script tag before your application scripts:

```html
<script src="path/to/argus-web.js"></script>
<script>
  Argus.start({
    appVersion: '1.0.0',
    showWidget: true // Renders in-page diagnostic pill in bottom-right corner
  });
</script>
```

### Option 2: ES Module / NPM

```typescript
import { DiagnosticSession } from '@argus/web';

DiagnosticSession.start({
  appVersion: '1.0.0',
  autoTrackClicks: true,
  autoTrackFetch: true,
  autoTrackNavigation: true,
  autoTrackErrors: true,
  showWidget: true
});
```

---

## 🛠 Manual State & Action Tracking

```typescript
// Track internal state changes
Argus.trackStateChange('CheckoutStep:Payment', { cartTotal: 199.00 });

// Track specific custom user actions
Argus.trackAction('ApplyCouponCode', { code: 'DISCOUNT20' });

// Export or download recorded execution graph
const graphJson = Argus.exportJson();
Argus.downloadJson('my_execution_graph.json');
```
