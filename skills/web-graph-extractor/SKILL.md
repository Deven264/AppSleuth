---
name: web-graph-extractor
description: Analyzes web application codebases (React, Next.js, Vue, vanilla JS) and E2E test suites (Playwright, Cypress) to generate an Argus Expected Behavioral Graph (expected_graph.json).
---

# Argus Web Graph Extractor Skill

This skill extracts an **Argus Expected Behavioral Graph** from web applications by analyzing **E2E tests (Playwright, Cypress, Vitest)** alongside router definitions and API clients.

---

## The 4 Web Architectural Pillars

```mermaid
flowchart TD
    P1["1. E2E & Component Tests\n(Playwright, Cypress, Testing Library)\nDocuments user journeys & mock responses"] --> Synthesizer
    P2["2. Web Routing & Pages\n(React Router, Next.js page.tsx, Vue Router)\nGenerates PAGE_VIEW nodes"] --> Synthesizer
    P3["3. UI Actions & State\n(Form submits, Redux, Zustand, Pinia)\nGenerates USER_ACTION & STATE_CHANGE"] --> Synthesizer
    P4["4. API Clients\n(Fetch, Axios, TanStack Query, TRPC)\nGenerates API_CALL & API_RESULT"] --> Synthesizer

    Synthesizer["Argus Web Synthesizer"] --> Output["expected_graph.json"]
```

---

## Web Node Mapping Rules

| Web Code Pattern | Argus Node Type | Example Label |
|---|---|---|
| `page.goto('/checkout')` or `<Route path="/checkout">` | `PAGE_VIEW` | `PageView:/checkout` |
| `page.click('button#pay')` or `<button onClick=...>` | `USER_ACTION` | `Click:PayNowButton` |
| `setIsLoading(true)` or `state.status = 'processing'` | `STATE_CHANGE` | `StateChange:ProcessingPayment` |
| `fetch('/api/v1/charge', { method: 'POST' })` | `API_CALL` | `ApiCall:/api/v1/charge` |
| HTTP 200 response | `API_RESULT` | `ApiResult:200:/api/v1/charge` |
| AbortController timeout / 504 Gateway Timeout | `API_RESULT` | `ApiResult:TIMEOUT:/api/v1/charge` |
| Browser CORS preflight error | `API_RESULT` | `ApiResult:FAILED:/api/v1/charge` |
| `window.onerror` or uncaught boundary | `ERROR` | `Error:ChunkLoadError` |
