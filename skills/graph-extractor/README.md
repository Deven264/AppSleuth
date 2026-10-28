# AppSleuth Graph Extractor Skill

The **Graph Extractor Skill** enables any AI agent or LLM (Claude, Gemini, GPT-4o, etc.) to reverse-engineer an **Expected Behavioral Graph** (`expected_graph.json`) from an existing codebase by analyzing its tests, UI screens, navigation, and API contracts.

---

## Why Test-Driven Graph Extraction?

Instead of guessing app behavior, this skill treats **test suites as the executable specification**:
- **Happy Path Tests** (e.g. `testSendEmail_happyPath`) define the primary successful execution path.
- **Negative & Failure Tests** (e.g. `testSendEmail_timeout`, `testValidationFailure`) define exact divergence points (`divergesFromHappyPathAt`), failure modes, and known root causes.

---

## 🛠 Usage Options

### Option 1: Fast CLI Context Extractor + LLM

For larger codebases, use the helper script to scan and extract only the relevant architectural and test signals:

```bash
# 1. Extract relevant code signals into a compact markdown bundle
python scripts/extract_code_context.py /path/to/your/app -o codebase_context.md

# 2. Provide codebase_context.md + prompts/system_prompt.md to your LLM of choice
# The LLM outputs a valid expected_graph.json conforming to the AppSleuth schema.
```

### Option 2: Direct Agentic Extraction

If you are using an agentic environment (such as Google Antigravity, Claude Code, Cursor, or Aider):
1. Activate the `graph-extractor` skill.
2. Direct the agent:
   > *"Extract the AppSleuth Expected Behavioral Graph for the workflow tested in `ComposeEmailWorkflowTest.kt`."*
3. The agent reads the tests, traverses the navigation and network layers, and generates `expected_graph.json`.

---

## 📂 Skill Contents

| File | Purpose |
|---|---|
| [`SKILL.md`](SKILL.md) | The formal skill definition and 4-Pillar Analysis methodology |
| [`prompts/system_prompt.md`](prompts/system_prompt.md) | Standardized system prompt with strict schema validation rules |
| [`scripts/extract_code_context.py`](scripts/extract_code_context.py) | Python scanner for Android, iOS, and Web codebases |
| [`sample_extracted_context.md`](sample_extracted_context.md) | An example extracted context from `examples/android-email-demo` |
