# Argus Web Crawler — Black-Box Behavioral Reconstruction

Generate an **Argus Expected Behavioral Graph** (`expected_graph.json`) from any live website URL or HTML page without needing access to the original source code repository via **Black-Box Behavioral Reconstruction**.

---

## 🎯 White-Box vs. Black-Box in Argus

| Mode | Paradigm | Tool to Use | Input |
|---|---|---|---|
| **White-Box** | Code & Test Mining | [`skills/web-graph-extractor/`](../../skills/web-graph-extractor/) | Playwright/Cypress tests & routing code |
| **Black-Box** | Behavioral Reconstruction | [`tools/web-crawler/`](./) | Website URL (e.g. `https://myshop.com/checkout`) or raw DOM |

---

## 🚀 Usage

### 1. Crawl Any Live Web URL
```bash
python tools/web-crawler/crawler.py https://example.com/checkout -o expected_graph.json
```

### 2. Crawl a Local HTML Application
```bash
python tools/web-crawler/crawler.py examples/web-checkout-demo/index.html -o expected_graph.json
```

---

## 🔍 How the Crawler Works

1. **HTML & DOM Analysis (`html_analyzer.py`):**
   * Parses page title and meta attributes.
   * Discovers interactive buttons (`<button>`, `[role="button"]`, `[data-track]`).
   * Extracts forms and required inputs (`<form>`, `<input required>`).
   * Scans client-side scripts to discover outbound endpoints (`fetch('/api/...')`, `axios.post('...')`).
2. **Domain Classification:**
   * Automatically identifies the workflow type (`ECommerceCheckout`, `UserAuthentication`, `UserRegistration`, `SearchAndFilter`, `ContactSubmission`).
3. **Graph Synthesis (`graph_synthesizer.py`):**
   * Generates nodes conforming to the Argus schema (`SESSION_START`, `PAGE_VIEW`, `USER_ACTION`, `STATE_CHANGE`, `API_CALL`, `API_RESULT`).
   * Generates **Happy Path** (`happy_path`).
   * Generates **Known Failure Modes** (`timeout_failure_path`, `cors_error_path`) with divergence points (`divergesFromHappyPathAt`) and known root causes.

---

## 📋 CLI Options

```
usage: crawler.py [-h] [-o OUTPUT] [--app-version APP_VERSION] target

positional arguments:
  target                Website URL (e.g. https://example.com/checkout) or local HTML file path

options:
  -h, --help            show this help message and exit
  -o OUTPUT, --output OUTPUT
                        Output path for the generated expected_graph.json (default: expected_graph.json)
  --app-version APP_VERSION
                        Application version tag (default: 1.0.0)
```
