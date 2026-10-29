# Argus Web Graph Extractor Skill

Specialized tool and agent skill for generating **Argus Expected Behavioral Graphs** from web applications (React, Next.js, Vue, vanilla JS) and E2E test suites (Playwright, Cypress, Vitest).

---

## 🚀 Quick Usage

### Step 1: Scan Your Web App
Run the context scanner to extract only tests, routes, state stores, and API clients:

```bash
python scripts/extract_web_context.py /path/to/your/web-app -o web_context.md
```

### Step 2: Synthesize with AI
Pass `web_context.md` alongside [`prompts/system_prompt.md`](prompts/system_prompt.md) to any LLM. The model will output the valid `expected_graph.json` ready for production diagnosis.

---

## 📂 Contents

| File | Description |
|---|---|
| [`SKILL.md`](SKILL.md) | Formal skill definition & web node mapping rules |
| [`prompts/system_prompt.md`](prompts/system_prompt.md) | Standardized system prompt for web graph generation |
| [`scripts/extract_web_context.py`](scripts/extract_web_context.py) | Python scanner for web frontend repositories |
| [`sample_extracted_web_context.md`](sample_extracted_web_context.md) | Sample output extracted from `examples/web-checkout-demo` |
