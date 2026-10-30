/**
 * Argus: SystemSleuth — Browser Extension Popup Controller
 * Hybrid Behavioral Graph Generation & Interactive Canvas Visualizer
 */

// Application State
let activeTabInfo = null;
let extractedEvidence = null;
let currentGraph = null;
let selectedNodeId = null;
let hoveredNodeId = null;
let layoutNodes = [];
let layoutEdges = [];

// Fallback Model Candidate Hierarchy
const CANDIDATE_FLASH_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash-8b',
  'gemini-1.5-flash'
];

// DOM Elements
const pageTitleEl = document.getElementById('pageTitle');
const pageUrlEl = document.getElementById('pageUrl');
const btnCountEl = document.getElementById('btnCount');
const formCountEl = document.getElementById('formCount');
const endpointCountEl = document.getElementById('endpointCount');
const modelBadgeEl = document.getElementById('modelBadge');
const apiKeyInput = document.getElementById('apiKeyInput');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const synthesisModeSelect = document.getElementById('synthesisMode');
const apiStatusNotice = document.getElementById('apiStatusNotice');
const generateBtn = document.getElementById('generateBtn');
const genSpinner = document.getElementById('genSpinner');
const genBtnText = document.getElementById('genBtnText');
const resultsSection = document.getElementById('resultsSection');
const jsonOutputEl = document.getElementById('jsonOutput');
const evidenceListEl = document.getElementById('evidenceList');
const copyJsonBtn = document.getElementById('copyJsonBtn');
const downloadJsonBtn = document.getElementById('downloadJsonBtn');
const graphCanvas = document.getElementById('graphCanvas');
const nodeInfoTitle = document.getElementById('nodeInfoTitle');
const nodeInfoDesc = document.getElementById('nodeInfoDesc');

// Tab Buttons
const tabButtons = document.querySelectorAll('.tab-btn');
const tabVisualizer = document.getElementById('tabVisualizer');
const tabJson = document.getElementById('tabJson');
const tabEvidence = document.getElementById('tabEvidence');

// -------------------------------------------------------------
// 1. Initialization & Storage
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  // Load saved settings from chrome.storage
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['geminiApiKey', 'synthesisMode'], (res) => {
      if (res && res.geminiApiKey) {
        apiKeyInput.value = res.geminiApiKey;
        updateEngineBadge(true);
      } else {
        updateEngineBadge(false);
      }

      if (res && res.synthesisMode && synthesisModeSelect) {
        synthesisModeSelect.value = res.synthesisMode;
      }
    });
  }

  // Save API key handler
  saveKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    const mode = synthesisModeSelect ? synthesisModeSelect.value : 'single';
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ geminiApiKey: key, synthesisMode: mode }, () => {
        saveKeyBtn.innerText = '✓ Saved!';
        updateEngineBadge(!!key);
        hideApiNotice();
        setTimeout(() => { saveKeyBtn.innerText = 'Save'; }, 1500);
      });
    }
  });

  if (synthesisModeSelect) {
    synthesisModeSelect.addEventListener('change', () => {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ synthesisMode: synthesisModeSelect.value });
      }
    });
  }

  // Setup Tab Navigation
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const target = btn.dataset.tab;
      tabVisualizer.classList.toggle('hidden', target !== 'visualizer');
      tabJson.classList.toggle('hidden', target !== 'json');
      tabEvidence.classList.toggle('hidden', target !== 'evidence');

      if (target === 'visualizer') {
        renderCanvasGraph();
      }
    });
  });

  // Inspect Active Tab & Run Content Script
  await inspectActiveTab();

  // Setup Canvas Interaction
  setupCanvasInteraction();

  // Setup Generate Action
  generateBtn.addEventListener('click', onGenerateClicked);

  // Setup Export Handlers
  copyJsonBtn.addEventListener('click', onCopyJson);
  downloadJsonBtn.addEventListener('click', onDownloadJson);
});

function updateEngineBadge(hasKey) {
  if (hasKey) {
    modelBadgeEl.innerText = 'AI Hybrid Engine (Gemini)';
    modelBadgeEl.style.color = '#38bdf8';
    modelBadgeEl.style.borderColor = 'rgba(56, 189, 248, 0.4)';
    modelBadgeEl.style.background = 'rgba(56, 189, 248, 0.15)';
  } else {
    modelBadgeEl.innerText = 'Built-in Engine (Offline)';
    modelBadgeEl.style.color = '#10b981';
    modelBadgeEl.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    modelBadgeEl.style.background = 'rgba(16, 185, 129, 0.15)';
  }
}

function showApiNotice(msg, type = 'error') {
  if (!apiStatusNotice) return;
  apiStatusNotice.textContent = msg;
  apiStatusNotice.className = `status-notice ${type}`;
  apiStatusNotice.classList.remove('hidden');
}

function hideApiNotice() {
  if (!apiStatusNotice) return;
  apiStatusNotice.classList.add('hidden');
}

// -------------------------------------------------------------
// 2. Active Tab Inspection
// -------------------------------------------------------------
async function inspectActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      pageTitleEl.innerText = 'No active tab found';
      return;
    }

    activeTabInfo = tab;
    pageTitleEl.innerText = tab.title || 'Web Application';
    pageUrlEl.innerText = tab.url || 'Unknown URL';

    // Check if URL is inspectable
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
      pageTitleEl.innerText = 'Browser System Page';
      pageUrlEl.innerText = tab.url;
      pageUrlEl.style.color = '#f59e0b';
      nodeInfoTitle.innerText = 'System Page Detected';
      nodeInfoDesc.innerText = 'Browser system pages are restricted. Please navigate to any web application to inspect and synthesize its behavioral graph.';
      generateBtn.disabled = true;
      generateBtn.title = 'Cannot inspect internal browser system pages.';
      return;
    }

    // Execute content extractor script
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content_extractor.js']
    });

    if (results && results[0] && results[0].result) {
      extractedEvidence = results[0].result;
      updatePageCardWithEvidence(extractedEvidence);
    }
  } catch (err) {
    console.warn('Could not inject content script:', err);
    // Fallback evidence from tab info
    if (activeTabInfo) {
      extractedEvidence = {
        url: activeTabInfo.url,
        origin: new URL(activeTabInfo.url).origin,
        pathname: new URL(activeTabInfo.url).pathname,
        title: activeTabInfo.title || 'Web Application',
        headings: [activeTabInfo.title || 'Web Application'],
        buttons: [{ label: 'Primary Action' }],
        forms: [],
        scriptEndpoints: []
      };
      updatePageCardWithEvidence(extractedEvidence);
    }
  }
}

function updatePageCardWithEvidence(evidence) {
  pageTitleEl.innerText = evidence.title || 'Web Application';
  pageUrlEl.innerText = evidence.url;
  btnCountEl.innerText = evidence.buttons ? evidence.buttons.length : 0;
  formCountEl.innerText = evidence.forms ? evidence.forms.length : 0;
  endpointCountEl.innerText = evidence.scriptEndpoints ? evidence.scriptEndpoints.length : 0;
}

// -------------------------------------------------------------
// 3. Graph Generation (Hybrid: AI or Heuristic)
// -------------------------------------------------------------
async function onGenerateClicked() {
  if (!extractedEvidence) {
    await inspectActiveTab();
  }

  // Set loading UI
  generateBtn.disabled = true;
  genSpinner.style.display = 'inline-block';
  genBtnText.innerText = 'Synthesizing Behavioral Contract...';
  hideApiNotice();

  const apiKey = apiKeyInput.value.trim();
  const mode = synthesisModeSelect ? synthesisModeSelect.value : 'single';

  try {
    let graph = null;
    let modelUsed = null;

    if (apiKey) {
      try {
        genBtnText.innerText = mode === 'deep' 
          ? 'Initiating Multi-Stage AI Synthesis...' 
          : 'Consulting Gemini AI...';
        
        const synthesisResult = await synthesizeWithGemini(extractedEvidence, apiKey, mode);
        if (synthesisResult && synthesisResult.graph && synthesisResult.graph.workflows) {
          graph = synthesisResult.graph;
          modelUsed = synthesisResult.modelUsed;
          showApiNotice(`Successfully synthesized via ${modelUsed} (${mode === 'deep' ? '2 requests' : '1 request'})`, 'success');
        }
      } catch (llmErr) {
        console.warn('Gemini synthesis failed, falling back to heuristic synthesizer:', llmErr);
        showApiNotice(`AI Notice: ${llmErr.message} — used built-in offline engine.`, 'error');
      }
    }

    if (!graph) {
      genBtnText.innerText = 'Synthesizing with Heuristic Engine...';
      graph = synthesizeHeuristicGraph(extractedEvidence);
    }

    currentGraph = graph;

    // Display Results
    resultsSection.classList.remove('hidden');

    // Populate JSON Spec
    jsonOutputEl.querySelector('code').textContent = JSON.stringify(currentGraph, null, 2);

    // Populate Evidence Tab
    renderEvidenceList(extractedEvidence);

    // Layout and Render Canvas
    layoutGraph(currentGraph);
    renderCanvasGraph();

    // Select first node by default for inspector
    const firstNode = currentGraph.workflows[0]?.nodes[0];
    if (firstNode) {
      selectNode(firstNode.id);
    }

    if (modelUsed) {
      modelBadgeEl.innerText = `${modelUsed} ✨`;
      modelBadgeEl.style.color = '#38bdf8';
    } else if (apiKey) {
      modelBadgeEl.innerText = 'Built-in (Fallback from AI)';
      modelBadgeEl.style.color = '#f59e0b';
    } else {
      modelBadgeEl.innerText = 'Built-in Engine (Offline)';
      modelBadgeEl.style.color = '#10b981';
    }

  } catch (err) {
    console.error('Error during generation:', err);
    alert('Failed to generate graph: ' + err.message);
  } finally {
    generateBtn.disabled = false;
    genSpinner.style.display = 'none';
    genBtnText.innerText = '⚡ Re-generate Expected Graph';
  }
}

// -------------------------------------------------------------
// 4. Dynamic Model Discovery & Multi-Stage Gemini Synthesis
// -------------------------------------------------------------
async function discoverActiveModel(apiKey) {
  try {
    const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
    if (listRes.ok) {
      const data = await listRes.json();
      if (data && Array.isArray(data.models)) {
        const supported = data.models.filter(m => 
          Array.isArray(m.supportedGenerationMethods) && 
          m.supportedGenerationMethods.includes('generateContent')
        );

        // Find best flash model available on user's API key
        const preferred = supported.find(m => /2\.5-flash/i.test(m.name))
          || supported.find(m => /2\.0-flash/i.test(m.name))
          || supported.find(m => /1\.5-flash-latest/i.test(m.name))
          || supported.find(m => /1\.5-flash/i.test(m.name))
          || supported.find(m => /flash/i.test(m.name))
          || supported[0];

        if (preferred) {
          const modelId = preferred.name.replace(/^models\//, '');
          console.log('[Argus] Discovered active model for key:', modelId);
          return modelId;
        }
      }
    }
  } catch (err) {
    console.warn('[Argus] Dynamic model discovery skipped:', err);
  }
  return null;
}

async function callGeminiGenerate(modelName, prompt, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2
      }
    })
  });

  if (!response.ok) {
    let errorDetail = response.statusText;
    try {
      const errJson = await response.json();
      if (errJson && errJson.error && errJson.error.message) {
        errorDetail = errJson.error.message;
      }
    } catch (_) {}
    throw new Error(`Google API returned HTTP ${response.status} for ${modelName}: ${errorDetail}`);
  }

  const json = await response.json();
  const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error(`Empty response content from ${modelName}`);
  }

  return JSON.parse(rawText);
}

async function synthesizeWithGemini(evidence, apiKey, mode = 'single') {
  // Discover active model on this API key or build candidate chain
  const discovered = await discoverActiveModel(apiKey);
  const modelsToTry = discovered 
    ? [discovered, ...CANDIDATE_FLASH_MODELS.filter(m => m !== discovered)]
    : CANDIDATE_FLASH_MODELS;

  let successfulModel = null;
  let lastError = null;
  let finalGraph = null;

  if (mode === 'deep') {
    // -------------------------------------------------------------
    // MULTI-STAGE REASONING (2 Requests)
    // -------------------------------------------------------------
    // Request 1: Identify semantic user workflows and primary intent
    genBtnText.innerText = 'Pass 1/2: Discovering User Workflows...';
    const stage1Prompt = `You are Argus: SystemSleuth's AI Behavioral Architect.
Analyze the following webpage evidence and identify the primary user workflow:
URL: ${evidence.url}
Title: ${evidence.title}
Headings: ${JSON.stringify(evidence.headings || [])}
Buttons: ${JSON.stringify(evidence.buttons || [])}
Forms: ${JSON.stringify(evidence.forms || [])}
Discovered Endpoints: ${JSON.stringify(evidence.scriptEndpoints || [])}

Return JSON with structure:
{
  "workflowName": "string",
  "workflowDescription": "string",
  "primaryAction": "string",
  "primaryEndpoint": "string",
  "keyIntents": ["string"]
}`;

    let stage1Result = null;
    for (const model of modelsToTry) {
      try {
        stage1Result = await callGeminiGenerate(model, stage1Prompt, apiKey);
        successfulModel = model;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!stage1Result) {
      throw lastError || new Error('Failed to complete Pass 1');
    }

    // Request 2: Synthesize failure modes, timeouts, CORS errors, and state machine
    genBtnText.innerText = `Pass 2/2 (${successfulModel}): Synthesizing Failure Modes & SLA Boundaries...`;
    const stage2Prompt = `You are Argus: SystemSleuth's AI Behavioral Architect.
We have identified the core workflow architecture:
${JSON.stringify(stage1Result, null, 2)}

Webpage Evidence:
URL: ${evidence.url}
Title: ${evidence.title}
Buttons: ${JSON.stringify(evidence.buttons || [])}
Forms: ${JSON.stringify(evidence.forms || [])}
Discovered Script Endpoints: ${JSON.stringify(evidence.scriptEndpoints || [])}

Synthesize a complete, production-ready Argus Expected Behavioral Graph in JSON.
Strictly adhere to this Argus JSON schema:
{
  "schemaVersion": "1.0",
  "appVersion": "1.0.0",
  "platform": "web",
  "description": "Expected behavioral contract synthesized for ${evidence.title}",
  "workflows": [
    {
      "id": "wf_${evidence.title.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 16) || 'web'}_workflow",
      "name": "${stage1Result.workflowName || 'WebWorkflow'}",
      "description": "${stage1Result.workflowDescription || 'Primary user interaction flow'}",
      "entryNode": "n_session_start",
      "terminalNodes": ["n_terminal_success", "n_terminal_timeout", "n_terminal_failure"],
      "nodes": [
        { "id": "n_session_start", "type": "SESSION_START", "label": "SessionStart", "expectedOutcome": "SUCCESS", "description": "User launched web application." },
        { "id": "n_page_view", "type": "PAGE_VIEW", "label": "PageView:${new URL(evidence.url || 'https://example.com').pathname}", "expectedOutcome": "SUCCESS", "description": "Page loaded and interactive." },
        { "id": "n_user_action", "type": "USER_ACTION", "label": "Click:${stage1Result.primaryAction || 'Submit'}", "expectedOutcome": "SUCCESS", "description": "User clicked primary action trigger." },
        { "id": "n_state_processing", "type": "STATE_CHANGE", "label": "StateChange:Processing", "expectedOutcome": "PENDING", "description": "UI entered loading state." },
        { "id": "n_api_call", "type": "API_CALL", "label": "ApiCall:${stage1Result.primaryEndpoint || '/api/v1/action'}", "expectedOutcome": "PENDING", "description": "Client dispatched network request.", "constraints": { "timeoutThresholdMs": 8000 } },
        { "id": "n_api_result_success", "type": "API_RESULT", "label": "ApiResult:200:${stage1Result.primaryEndpoint || '/api/v1/action'}", "expectedOutcome": "SUCCESS", "description": "Server responded with HTTP 200 OK." },
        { "id": "n_terminal_success", "type": "STATE_CHANGE", "label": "StateChange:Completed", "expectedOutcome": "SUCCESS", "description": "Workflow completed successfully.", "isTerminal": true },
        { "id": "n_api_result_timeout", "type": "API_RESULT", "label": "ApiResult:TIMEOUT:${stage1Result.primaryEndpoint || '/api/v1/action'}", "expectedOutcome": "TIMEOUT", "description": "Request exceeded timeout threshold.", "isKnownFailureMode": true, "knownCauses": ["Backend latency spike", "Network packet drop"] },
        { "id": "n_terminal_timeout", "type": "STATE_CHANGE", "label": "StateChange:TimeoutNotice", "expectedOutcome": "TIMEOUT", "description": "Timeout retry dialog shown.", "isTerminal": true, "isKnownFailureMode": true },
        { "id": "n_api_result_failure", "type": "API_RESULT", "label": "ApiResult:FAILED:${stage1Result.primaryEndpoint || '/api/v1/action'}", "expectedOutcome": "FAILURE", "description": "Network request failed or CORS rejected.", "isKnownFailureMode": true, "knownCauses": ["CORS origin header missing", "HTTP 500 error"] },
        { "id": "n_terminal_failure", "type": "STATE_CHANGE", "label": "StateChange:ErrorNotice", "expectedOutcome": "FAILURE", "description": "Error banner displayed.", "isTerminal": true, "isKnownFailureMode": true }
      ],
      "edges": [
        { "from": "n_session_start", "to": "n_page_view", "label": "navigated_to", "path": "all" },
        { "from": "n_page_view", "to": "n_user_action", "label": "user_triggered", "path": "all" },
        { "from": "n_user_action", "to": "n_state_processing", "label": "state_changed", "path": "all" },
        { "from": "n_state_processing", "to": "n_api_call", "label": "api_initiated", "path": "all" },
        { "from": "n_api_call", "to": "n_api_result_success", "label": "api_responded", "path": "happy_path" },
        { "from": "n_api_result_success", "to": "n_terminal_success", "label": "state_changed", "path": "happy_path" },
        { "from": "n_api_call", "to": "n_api_result_timeout", "label": "api_responded", "path": "timeout_failure_path" },
        { "from": "n_api_result_timeout", "to": "n_terminal_timeout", "label": "state_changed", "path": "timeout_failure_path" },
        { "from": "n_api_call", "to": "n_api_result_failure", "label": "api_responded", "path": "network_failure_path" },
        { "from": "n_api_result_failure", "to": "n_terminal_failure", "label": "state_changed", "path": "network_failure_path" }
      ],
      "paths": {
        "happy_path": { "description": "Successful execution", "sequence": ["n_session_start", "n_page_view", "n_user_action", "n_state_processing", "n_api_call", "n_api_result_success", "n_terminal_success"] },
        "timeout_failure_path": { "description": "Network timeout failure", "divergesFromHappyPathAt": "n_api_call", "sequence": ["n_session_start", "n_page_view", "n_user_action", "n_state_processing", "n_api_call", "n_api_result_timeout", "n_terminal_timeout"] },
        "network_failure_path": { "description": "Network error or CORS rejection", "divergesFromHappyPathAt": "n_api_call", "sequence": ["n_session_start", "n_page_view", "n_user_action", "n_state_processing", "n_api_call", "n_api_result_failure", "n_terminal_failure"] }
      }
    }
  ]
}
Return strictly JSON.`;

    finalGraph = await callGeminiGenerate(successfulModel, stage2Prompt, apiKey);

  } else {
    // -------------------------------------------------------------
    // STANDARD SINGLE-PASS SYNTHESIS (1 Request)
    // -------------------------------------------------------------
    genBtnText.innerText = 'Consulting Gemini AI...';
    const singlePrompt = `You are Argus: SystemSleuth's AI Behavioral Architect.
Argus is an automated behavioral diagnosis system that uses formal behavioral graphs (expected_graph.json) to detect and diagnose regressions, latency spikes, CORS/network failures, and UI state divergences.

Analyze the following harvested webpage structural evidence and synthesize a complete, rigorous Argus Expected Behavioral Graph in JSON.

Webpage Evidence:
URL: ${evidence.url}
Title: ${evidence.title}
Headings: ${JSON.stringify(evidence.headings || [])}
Buttons: ${JSON.stringify(evidence.buttons || [])}
Forms: ${JSON.stringify(evidence.forms || [])}
Discovered Script Endpoints: ${JSON.stringify(evidence.scriptEndpoints || [])}

Requirements:
1. Return strictly valid JSON with no markdown formatting.
2. The JSON MUST follow the Argus schema:
{
  "schemaVersion": "1.0",
  "appVersion": "1.0.0",
  "platform": "web",
  "description": "Expected behavioral contract synthesized for ${evidence.title}",
  "workflows": [
    {
      "id": "wf_primary_workflow",
      "name": "PrimaryWorkflow",
      "description": "Detailed workflow description",
      "entryNode": "n_session_start",
      "terminalNodes": ["n_terminal_success", "n_terminal_timeout", "n_terminal_failure"],
      "nodes": [
        { "id": "n_session_start", "type": "SESSION_START", "label": "SessionStart", "expectedOutcome": "SUCCESS", "description": "..." },
        { "id": "n_page_view", "type": "PAGE_VIEW", "label": "PageView:/...", "expectedOutcome": "SUCCESS", "description": "..." },
        { "id": "n_user_action", "type": "USER_ACTION", "label": "Click:...", "expectedOutcome": "SUCCESS", "description": "..." },
        { "id": "n_state_processing", "type": "STATE_CHANGE", "label": "StateChange:Processing", "expectedOutcome": "PENDING", "description": "..." },
        { "id": "n_api_call", "type": "API_CALL", "label": "ApiCall:...", "expectedOutcome": "PENDING", "description": "...", "constraints": { "timeoutThresholdMs": 8000 } },
        { "id": "n_api_result_success", "type": "API_RESULT", "label": "ApiResult:200:...", "expectedOutcome": "SUCCESS", "description": "..." },
        { "id": "n_terminal_success", "type": "STATE_CHANGE", "label": "StateChange:Success", "expectedOutcome": "SUCCESS", "description": "...", "isTerminal": true },
        { "id": "n_api_result_timeout", "type": "API_RESULT", "label": "ApiResult:TIMEOUT:...", "expectedOutcome": "TIMEOUT", "description": "...", "isKnownFailureMode": true, "knownCauses": ["..."] },
        { "id": "n_terminal_timeout", "type": "STATE_CHANGE", "label": "StateChange:TimeoutError", "expectedOutcome": "TIMEOUT", "description": "...", "isTerminal": true, "isKnownFailureMode": true },
        { "id": "n_api_result_failure", "type": "API_RESULT", "label": "ApiResult:FAILED:...", "expectedOutcome": "FAILURE", "description": "...", "isKnownFailureMode": true, "knownCauses": ["..."] },
        { "id": "n_terminal_failure", "type": "STATE_CHANGE", "label": "StateChange:ErrorAlert", "expectedOutcome": "FAILURE", "description": "...", "isTerminal": true, "isKnownFailureMode": true }
      ],
      "edges": [
        { "from": "...", "to": "...", "label": "...", "path": "all" | "happy_path" | "timeout_failure_path" | "network_failure_path" }
      ],
      "paths": {
        "happy_path": { "description": "...", "sequence": [...] },
        "timeout_failure_path": { "description": "...", "divergesFromHappyPathAt": "n_api_call", "sequence": [...] },
        "network_failure_path": { "description": "...", "divergesFromHappyPathAt": "n_api_call", "sequence": [...] }
      }
    }
  ]
}
Synthesize accurate node IDs, meaningful user action labels from the buttons, and relevant API endpoints.`;

    for (const model of modelsToTry) {
      try {
        finalGraph = await callGeminiGenerate(model, singlePrompt, apiKey);
        successfulModel = model;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!finalGraph) {
      throw lastError || new Error('All candidate models failed');
    }
  }

  return { graph: finalGraph, modelUsed: successfulModel };
}

// -------------------------------------------------------------
// 5. Built-in Heuristic Synthesizer (100% Offline)
// -------------------------------------------------------------
function synthesizeHeuristicGraph(evidence) {
  const url = new URL(evidence.url || 'https://example.com');
  const pathname = url.pathname === '/' ? '/home' : url.pathname;
  const cleanTitle = (evidence.title || 'WebApp').replace(/[^a-zA-Z0-9]/g, '');

  // Extract most representative action
  let primaryAction = 'Submit';
  if (evidence.buttons && evidence.buttons.length > 0) {
    const candidate = evidence.buttons.find(b =>
      /pay|checkout|order|submit|login|sign|search|send|save|confirm/i.test(b.label)
    );
    primaryAction = candidate ? candidate.label : evidence.buttons[0].label;
  }
  primaryAction = primaryAction.slice(0, 24);

  // Extract or derive representative API endpoint
  let primaryEndpoint = '/api/v1/action';
  if (evidence.scriptEndpoints && evidence.scriptEndpoints.length > 0) {
    primaryEndpoint = evidence.scriptEndpoints[0];
  } else if (evidence.forms && evidence.forms.length > 0 && evidence.forms[0].action) {
    try {
      const actUrl = new URL(evidence.forms[0].action, url.origin);
      primaryEndpoint = actUrl.pathname;
    } catch {
      primaryEndpoint = evidence.forms[0].action;
    }
  } else if (pathname !== '/home') {
    primaryEndpoint = `/api${pathname}`;
  }

  const workflowId = `wf_${cleanTitle.toLowerCase().slice(0, 16) || 'web'}_workflow`;
  const workflowName = `${cleanTitle || 'Web'}ActionWorkflow`;

  return {
    schemaVersion: '1.0',
    appVersion: '1.0.0',
    platform: 'web',
    description: `Expected behavioral contract synthesized for ${evidence.title || url.hostname}.`,
    workflows: [
      {
        id: workflowId,
        name: workflowName,
        description: `User opens ${pathname}, triggers ${primaryAction}, and server handles request at ${primaryEndpoint}.`,
        entryNode: 'n_session_start',
        terminalNodes: ['n_terminal_success', 'n_terminal_timeout', 'n_terminal_cors'],
        nodes: [
          {
            id: 'n_session_start',
            type: 'SESSION_START',
            label: 'SessionStart',
            expectedOutcome: 'SUCCESS',
            description: `User loaded ${url.origin}. Argus client telemetry initialized.`
          },
          {
            id: 'n_page_view',
            type: 'PAGE_VIEW',
            label: `PageView:${pathname}`,
            expectedOutcome: 'SUCCESS',
            description: `Page ${evidence.title || pathname} rendered. Interactive elements ready.`
          },
          {
            id: 'n_user_action',
            type: 'USER_ACTION',
            label: `Click:${primaryAction}`,
            expectedOutcome: 'SUCCESS',
            description: `User clicked on primary interaction element '${primaryAction}'.`
          },
          {
            id: 'n_state_processing',
            type: 'STATE_CHANGE',
            label: 'StateChange:Processing',
            expectedOutcome: 'PENDING',
            description: 'UI enters loading state: interactive trigger disabled, activity spinner displayed.'
          },
          {
            id: 'n_api_call',
            type: 'API_CALL',
            label: `ApiCall:${primaryEndpoint}`,
            expectedOutcome: 'PENDING',
            description: `Client dispatches network request to ${primaryEndpoint}.`,
            constraints: {
              timeoutThresholdMs: 8000
            }
          },
          {
            id: 'n_api_result_success',
            type: 'API_RESULT',
            label: `ApiResult:200:${primaryEndpoint}`,
            expectedOutcome: 'SUCCESS',
            description: `Server completed processing and returned HTTP 200 OK.`
          },
          {
            id: 'n_terminal_success',
            type: 'STATE_CHANGE',
            label: 'StateChange:SuccessConfirmed',
            expectedOutcome: 'SUCCESS',
            description: 'Transaction confirmed. Success feedback rendered to user.',
            isTerminal: true
          },
          {
            id: 'n_api_result_timeout',
            type: 'API_RESULT',
            label: `ApiResult:TIMEOUT:${primaryEndpoint}`,
            expectedOutcome: 'TIMEOUT',
            description: `Network request exceeded 8,000ms threshold without a response.`,
            isKnownFailureMode: true,
            knownCauses: [
              'Backend service cold start or high latency',
              'Client network degradation or dropped packet sequence',
              'Database query lock on backend resource'
            ]
          },
          {
            id: 'n_terminal_timeout',
            type: 'STATE_CHANGE',
            label: 'StateChange:TimeoutAlert',
            expectedOutcome: 'TIMEOUT',
            description: 'UI rendered timeout alert banner. Primary trigger re-enabled for user retry.',
            isTerminal: true,
            isKnownFailureMode: true
          },
          {
            id: 'n_api_result_cors',
            type: 'API_RESULT',
            label: `ApiResult:FAILED:${primaryEndpoint}`,
            expectedOutcome: 'FAILURE',
            description: 'Network request aborted due to CORS preflight failure or 502/500 Bad Gateway.',
            isKnownFailureMode: true,
            knownCauses: [
              'Missing Access-Control-Allow-Origin header in response',
              'Content-Security-Policy (CSP) blocking external origin',
              'Adblocker or privacy filter intercepting request'
            ]
          },
          {
            id: 'n_terminal_cors',
            type: 'STATE_CHANGE',
            label: 'StateChange:FailureDialog',
            expectedOutcome: 'FAILURE',
            description: 'UI presented error dialog explaining the network failure.',
            isTerminal: true,
            isKnownFailureMode: true
          }
        ],
        edges: [
          { from: 'n_session_start', to: 'n_page_view', label: 'navigated_to', path: 'all' },
          { from: 'n_page_view', to: 'n_user_action', label: 'user_triggered', path: 'all' },
          { from: 'n_user_action', to: 'n_state_processing', label: 'state_changed', path: 'all' },
          { from: 'n_state_processing', to: 'n_api_call', label: 'api_initiated', path: 'all' },
          { from: 'n_api_call', to: 'n_api_result_success', label: 'api_responded', path: 'happy_path' },
          { from: 'n_api_result_success', to: 'n_terminal_success', label: 'state_changed', path: 'happy_path' },
          { from: 'n_api_call', to: 'n_api_result_timeout', label: 'api_responded', path: 'timeout_failure_path' },
          { from: 'n_api_result_timeout', to: 'n_terminal_timeout', label: 'state_changed', path: 'timeout_failure_path' },
          { from: 'n_api_call', to: 'n_api_result_cors', label: 'api_responded', path: 'cors_error_path' },
          { from: 'n_api_result_cors', to: 'n_terminal_cors', label: 'state_changed', path: 'cors_error_path' }
        ],
        paths: {
          happy_path: {
            description: 'User successfully completes primary workflow',
            sequence: [
              'n_session_start',
              'n_page_view',
              'n_user_action',
              'n_state_processing',
              'n_api_call',
              'n_api_result_success',
              'n_terminal_success'
            ]
          },
          timeout_failure_path: {
            description: 'Request times out after 8,000ms threshold',
            divergesFromHappyPathAt: 'n_api_call',
            sequence: [
              'n_session_start',
              'n_page_view',
              'n_user_action',
              'n_state_processing',
              'n_api_call',
              'n_api_result_timeout',
              'n_terminal_timeout'
            ]
          },
          cors_error_path: {
            description: 'Request fails due to network drop or CORS preflight rejection',
            divergesFromHappyPathAt: 'n_api_call',
            sequence: [
              'n_session_start',
              'n_page_view',
              'n_user_action',
              'n_state_processing',
              'n_api_call',
              'n_api_result_cors',
              'n_terminal_cors'
            ]
          }
        }
      }
    ]
  };
}

// -------------------------------------------------------------
// 6. Interactive Canvas Visualizer
// -------------------------------------------------------------
function layoutGraph(graph) {
  layoutNodes = [];
  layoutEdges = [];

  const wf = graph?.workflows?.[0];
  if (!wf || !wf.nodes) return;

  const width = graphCanvas.width;
  const height = graphCanvas.height;

  // Identify happy path nodes
  const happySeq = wf.paths?.happy_path?.sequence || [];

  // Determine branch classification
  const nodeMap = new Map();
  wf.nodes.forEach(n => nodeMap.set(n.id, n));

  // Custom positioning based on Argus graph structure
  // Main sequence: 5 stages left-to-right (x: 40 to 280)
  // Branches: 3 rows (Happy=Top y:70, Timeout=Mid y:170, Fail=Bottom y:270)
  const branchX1 = 345;
  const branchX2 = 425;

  wf.nodes.forEach(node => {
    let x = 40;
    let y = 170;

    // Check specific node types and IDs
    if (node.type === 'SESSION_START') {
      x = 35;
      y = 170;
    } else if (node.type === 'PAGE_VIEW') {
      x = 95;
      y = 170;
    } else if (node.type === 'USER_ACTION') {
      x = 160;
      y = 170;
    } else if (node.type === 'STATE_CHANGE' && !node.isTerminal) {
      x = 225;
      y = 170;
    } else if (node.type === 'API_CALL') {
      x = 285;
      y = 170;
    } else {
      // Branch nodes
      const isSuccess = node.expectedOutcome === 'SUCCESS' || happySeq.includes(node.id);
      const isTimeout = node.expectedOutcome === 'TIMEOUT';
      const isFail = node.expectedOutcome === 'FAILURE' || (!isSuccess && !isTimeout);

      if (isSuccess) {
        y = 70;
        x = node.type === 'API_RESULT' ? branchX1 : branchX2;
      } else if (isTimeout) {
        y = 170;
        x = node.type === 'API_RESULT' ? branchX1 : branchX2;
      } else {
        y = 270;
        x = node.type === 'API_RESULT' ? branchX1 : branchX2;
      }
    }

    layoutNodes.push({
      id: node.id,
      label: formatNodeLabel(node),
      type: node.type,
      outcome: node.expectedOutcome,
      x,
      y,
      radius: 18,
      raw: node
    });
  });

  // Layout Edges
  if (wf.edges) {
    wf.edges.forEach(edge => {
      const source = layoutNodes.find(n => n.id === edge.from);
      const target = layoutNodes.find(n => n.id === edge.to);
      if (source && target) {
        layoutEdges.push({
          from: source,
          to: target,
          label: edge.label,
          path: edge.path,
          raw: edge
        });
      }
    });
  }
}

function formatNodeLabel(node) {
  if (node.type === 'SESSION_START') return 'START';
  if (node.type === 'PAGE_VIEW') return 'PAGE';
  if (node.type === 'USER_ACTION') return 'CLICK';
  if (node.type === 'API_CALL') return 'API';
  if (node.type === 'API_RESULT') {
    if (node.expectedOutcome === 'SUCCESS') return '200 OK';
    if (node.expectedOutcome === 'TIMEOUT') return 'TIMEOUT';
    return 'ERR';
  }
  if (node.isTerminal) {
    if (node.expectedOutcome === 'SUCCESS') return 'DONE';
    if (node.expectedOutcome === 'TIMEOUT') return 'RETRY';
    return 'ALERT';
  }
  return 'STATE';
}

function renderCanvasGraph() {
  const ctx = graphCanvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = graphCanvas.clientWidth || 480;
  const height = graphCanvas.clientHeight || 340;

  // Match canvas dimensions to display size
  if (graphCanvas.width !== width * dpr || graphCanvas.height !== height * dpr) {
    graphCanvas.width = width * dpr;
    graphCanvas.height = height * dpr;
  }

  ctx.save();
  ctx.scale(dpr, dpr);

  // Clear background
  ctx.fillStyle = '#0b1120';
  ctx.fillRect(0, 0, width, height);

  // Draw background grid dots
  ctx.fillStyle = '#1e293b';
  for (let gx = 15; gx < width; gx += 25) {
    for (let gy = 15; gy < height; gy += 25) {
      ctx.beginPath();
      ctx.arc(gx, gy, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Draw Edges
  layoutEdges.forEach(edge => {
    drawEdge(ctx, edge);
  });

  // Draw Nodes
  layoutNodes.forEach(node => {
    drawNode(ctx, node);
  });

  ctx.restore();
}

function drawEdge(ctx, edge) {
  const { from, to, path } = edge;

  // Determine line color
  let strokeColor = '#475569';
  if (path === 'happy_path') strokeColor = '#10b981';
  else if (path === 'timeout_failure_path') strokeColor = '#f59e0b';
  else if (path === 'cors_error_path' || path === 'network_failure_path') strokeColor = '#ef4444';

  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;

  // Curved or straight arrow
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (Math.abs(dy) > 10) {
    // Bezier curve
    const cp1x = from.x + dx * 0.5;
    const cp1y = from.y;
    const cp2x = from.x + dx * 0.5;
    const cp2y = to.y;

    ctx.moveTo(from.x, from.y);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, to.x, to.y);
    ctx.stroke();

    // Arrow head
    drawArrowHead(ctx, cp2x, cp2y, to.x, to.y, strokeColor);
  } else {
    // Straight line
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    drawArrowHead(ctx, from.x, from.y, to.x, to.y, strokeColor);
  }

  ctx.restore();
}

function drawArrowHead(ctx, fromX, fromY, toX, toY, color) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const headLen = 8;
  const targetX = toX - Math.cos(angle) * 19;
  const targetY = toY - Math.sin(angle) * 19;

  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.moveTo(targetX, targetY);
  ctx.lineTo(targetX - headLen * Math.cos(angle - Math.PI / 6), targetY - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(targetX - headLen * Math.cos(angle + Math.PI / 6), targetY - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawNode(ctx, node) {
  const isSelected = node.id === selectedNodeId;
  const isHovered = node.id === hoveredNodeId;

  // Node Color by Type & Outcome
  let fillColor = '#1e293b';
  let strokeColor = '#64748b';
  let textColor = '#ffffff';

  if (node.type === 'SESSION_START') {
    fillColor = '#312e81';
    strokeColor = '#6366f1';
  } else if (node.type === 'PAGE_VIEW') {
    fillColor = '#0c4a6e';
    strokeColor = '#0ea5e9';
  } else if (node.type === 'USER_ACTION') {
    fillColor = '#78350f';
    strokeColor = '#f59e0b';
  } else if (node.type === 'API_CALL') {
    fillColor = '#164e63';
    strokeColor = '#06b6d4';
  } else if (node.outcome === 'SUCCESS') {
    fillColor = '#064e3b';
    strokeColor = '#10b981';
  } else if (node.outcome === 'TIMEOUT') {
    fillColor = '#78350f';
    strokeColor = '#f59e0b';
  } else if (node.outcome === 'FAILURE') {
    fillColor = '#7f1d1d';
    strokeColor = '#ef4444';
  }

  ctx.save();

  // Highlight glow if selected or hovered
  if (isSelected || isHovered) {
    ctx.shadowColor = isSelected ? '#38bdf8' : '#94a3b8';
    ctx.shadowBlur = isSelected ? 12 : 6;
  }

  // Draw Circle Node
  ctx.beginPath();
  ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();

  ctx.lineWidth = isSelected ? 3 : 2;
  ctx.strokeStyle = isSelected ? '#ffffff' : strokeColor;
  ctx.stroke();

  // Reset shadow for text
  ctx.shadowBlur = 0;

  // Draw Node Label text
  ctx.font = 'bold 8px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(node.label, node.x, node.y);

  ctx.restore();
}

function setupCanvasInteraction() {
  graphCanvas.addEventListener('mousemove', (e) => {
    const rect = graphCanvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const hit = layoutNodes.find(node => {
      const dist = Math.hypot(node.x - mouseX, node.y - mouseY);
      return dist <= node.radius + 4;
    });

    if (hit) {
      hoveredNodeId = hit.id;
      graphCanvas.style.cursor = 'pointer';
    } else {
      hoveredNodeId = null;
      graphCanvas.style.cursor = 'default';
    }

    renderCanvasGraph();
  });

  graphCanvas.addEventListener('click', (e) => {
    const rect = graphCanvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const hit = layoutNodes.find(node => {
      const dist = Math.hypot(node.x - mouseX, node.y - mouseY);
      return dist <= node.radius + 4;
    });

    if (hit) {
      selectNode(hit.id);
    }
  });
}

function selectNode(nodeId) {
  selectedNodeId = nodeId;
  renderCanvasGraph();

  const nodeObj = layoutNodes.find(n => n.id === nodeId)?.raw;
  if (!nodeObj) return;

  nodeInfoTitle.innerText = `${nodeObj.label} (${nodeObj.type})`;

  let desc = nodeObj.description || '';
  if (nodeObj.constraints && nodeObj.constraints.timeoutThresholdMs) {
    desc += ` | Timeout threshold: ${nodeObj.constraints.timeoutThresholdMs}ms`;
  }
  if (nodeObj.knownCauses && nodeObj.knownCauses.length > 0) {
    desc += ` | Known causes: ${nodeObj.knownCauses.join(', ')}`;
  }
  nodeInfoDesc.innerText = desc;
}

// -------------------------------------------------------------
// 7. Evidence Tab Rendering
// -------------------------------------------------------------
function renderEvidenceList(evidence) {
  evidenceListEl.innerHTML = '';

  const addSection = (title, items) => {
    const sec = document.createElement('div');
    sec.style.marginBottom = '12px';

    const h = document.createElement('div');
    h.style.fontWeight = '700';
    h.style.color = '#38bdf8';
    h.style.marginBottom = '4px';
    h.innerText = `${title} (${items.length})`;
    sec.appendChild(h);

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.style.color = '#64748b';
      empty.innerText = 'None detected';
      sec.appendChild(empty);
    } else {
      items.forEach(it => {
        const itemEl = document.createElement('div');
        itemEl.className = 'evidence-item';
        if (typeof it === 'string') {
          itemEl.innerText = it;
        } else if (it.label) {
          itemEl.innerHTML = `<strong>${it.label}</strong> ${it.id ? `(#${it.id})` : ''}`;
        } else if (it.action) {
          itemEl.innerHTML = `<strong>${it.method}</strong> ${it.action} (${it.fieldsCount} fields)`;
        }
        sec.appendChild(itemEl);
      });
    }

    evidenceListEl.appendChild(sec);
  };

  addSection('Discovered Headings', evidence.headings || []);
  addSection('Discovered Buttons & Triggers', evidence.buttons || []);
  addSection('Discovered Forms', evidence.forms || []);
  addSection('Discovered Script Endpoints', evidence.scriptEndpoints || []);
}

// -------------------------------------------------------------
// 8. Copy & Download Handlers
// -------------------------------------------------------------
function onCopyJson() {
  if (!currentGraph) return;
  const text = JSON.stringify(currentGraph, null, 2);
  navigator.clipboard.writeText(text).then(() => {
    copyJsonBtn.innerText = '✓ Copied!';
    setTimeout(() => { copyJsonBtn.innerText = '📋 Copy JSON'; }, 1500);
  }).catch(err => {
    alert('Copy failed: ' + err);
  });
}

function onDownloadJson() {
  if (!currentGraph) return;
  const text = JSON.stringify(currentGraph, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'expected_graph.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  downloadJsonBtn.innerText = '✓ Downloaded!';
  setTimeout(() => { downloadJsonBtn.innerText = '💾 Download expected_graph.json'; }, 1500);
}
