/**
 * Argus: SystemSleuth — Browser Extension Popup Controller
 * Full-Stack Systems SRE Architecture Engine, Rolling Flight Recorder & Live Self-Diagnosis
 */

// Application State
let activeTabInfo = null;
let extractedEvidence = null;
let currentGraph = null;
let selectedNodeId = null;
let hoveredNodeId = null;
let divergedNodeId = null;
let layoutNodes = [];
let layoutEdges = [];
let flightRecorderTrace = [];
let latestIncidentReport = null;

// Fallback Model Candidate Hierarchy
const CANDIDATE_FLASH_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash-8b',
  'gemini-1.5-flash'
];

// DOM Elements: Header & Setup
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

// DOM Elements: Tabs & Panels
const tabButtons = document.querySelectorAll('.tab-btn');
const tabVisualizer = document.getElementById('tabVisualizer');
const tabDiagnose = document.getElementById('tabDiagnose');
const tabTrace = document.getElementById('tabTrace');
const tabSettings = document.getElementById('tabSettings');
const tabJson = document.getElementById('tabJson');
const tabEvidence = document.getElementById('tabEvidence');

// DOM Elements: Visualizer & Details
const graphCanvas = document.getElementById('graphCanvas');
const nodeInfoTitle = document.getElementById('nodeInfoTitle');
const nodeInfoDesc = document.getElementById('nodeInfoDesc');
const jsonOutputEl = document.getElementById('jsonOutput');
const evidenceListEl = document.getElementById('evidenceList');
const copyJsonBtn = document.getElementById('copyJsonBtn');
const downloadJsonBtn = document.getElementById('downloadJsonBtn');

// DOM Elements: Self-Diagnosis
const userProblemInput = document.getElementById('userProblemInput');
const runDiagnoseBtn = document.getElementById('runDiagnoseBtn');
const diagSpinner = document.getElementById('diagSpinner');
const diagBtnText = document.getElementById('diagBtnText');
const diagnosisReportCard = document.getElementById('diagnosisReportCard');
const diagStatusBadge = document.getElementById('diagStatusBadge');
const diagTimestamp = document.getElementById('diagTimestamp');
const diagUserExplanation = document.getElementById('diagUserExplanation');
const diagDevExplanation = document.getElementById('diagDevExplanation');
const diagRemediationList = document.getElementById('diagRemediationList');
const copyReportBtn = document.getElementById('copyReportBtn');

// DOM Elements: Flight Trace
const traceCountBadge = document.getElementById('traceCountBadge');
const flightTraceStream = document.getElementById('flightTraceStream');
const refreshTraceBtn = document.getElementById('refreshTraceBtn');

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
    const mode = synthesisModeSelect ? synthesisModeSelect.value : 'deep';
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
    btn.addEventListener('click', async () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const target = btn.dataset.tab;
      if (tabVisualizer) tabVisualizer.classList.toggle('hidden', target !== 'visualizer');
      if (tabDiagnose) tabDiagnose.classList.toggle('hidden', target !== 'diagnose');
      if (tabTrace) tabTrace.classList.toggle('hidden', target !== 'trace');
      if (tabSettings) tabSettings.classList.toggle('hidden', target !== 'settings');
      if (tabJson) tabJson.classList.toggle('hidden', target !== 'json');
      if (tabEvidence) tabEvidence.classList.toggle('hidden', target !== 'evidence');

      if (target === 'visualizer') {
        renderCanvasGraph();
      } else if (target === 'trace' || target === 'diagnose') {
        await updateFlightRecorderData();
      }
    });
  });

  // Inspect Active Tab & Run Content Scripts
  await inspectActiveTab();

  // Setup Canvas Interaction
  setupCanvasInteraction();

  // Setup Generate Action
  generateBtn.addEventListener('click', onGenerateClicked);

  // Setup Export Handlers
  copyJsonBtn.addEventListener('click', onCopyJson);
  downloadJsonBtn.addEventListener('click', onDownloadJson);

  // Setup Diagnosis Handlers
  if (runDiagnoseBtn) {
    runDiagnoseBtn.addEventListener('click', onRunDiagnoseClicked);
  }
  if (copyReportBtn) {
    copyReportBtn.addEventListener('click', onCopyReportClicked);
  }
  if (refreshTraceBtn) {
    refreshTraceBtn.addEventListener('click', updateFlightRecorderData);
  }

  // Fetch initial flight trace in background
  await updateFlightRecorderData();

  // Pre-synthesize initial heuristic graph so Visualizer and Diagnosis are instant
  if (extractedEvidence && !currentGraph && !isRestrictedUrl(activeTabInfo?.url)) {
    try {
      currentGraph = synthesizeHeuristicGraph(extractedEvidence);
      layoutGraph(currentGraph);
      if (jsonOutputEl && jsonOutputEl.querySelector('code')) {
        jsonOutputEl.querySelector('code').textContent = JSON.stringify(currentGraph, null, 2);
      }
      renderEvidenceList(extractedEvidence);
      const firstNode = currentGraph.workflows[0]?.nodes[0];
      if (firstNode) selectNode(firstNode.id);
    } catch (e) {
      console.warn('Pre-synthesis notice:', e);
    }
  }
});

function updateEngineBadge(hasKey) {
  if (hasKey) {
    modelBadgeEl.innerText = 'AI Systems Engine (Gemini)';
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

function isRestrictedUrl(url) {
  if (!url || typeof url !== 'string') return true;
  return url.startsWith('chrome://') ||
         url.startsWith('chrome-extension://') ||
         url.startsWith('edge://') ||
         url.startsWith('about:') ||
         url.startsWith('view-source:');
}

function safeParseUrl(rawUrl, fallback = 'https://example.com') {
  try {
    const parsed = new URL(rawUrl || fallback);
    return {
      url: parsed.href,
      origin: parsed.origin,
      pathname: parsed.pathname || '/'
    };
  } catch {
    return {
      url: fallback,
      origin: fallback,
      pathname: '/'
    };
  }
}

// -------------------------------------------------------------
// 2. Active Tab Inspection & Recorder Injection
// -------------------------------------------------------------
async function inspectActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab) {
      pageTitleEl.innerText = 'No active tab found';
      return;
    }

    activeTabInfo = tab;
    const tabUrl = tab.url || '';
    const tabTitle = tab.title || 'Web Application';

    pageTitleEl.innerText = tabTitle;
    pageUrlEl.innerText = tabUrl || 'chrome://extensions';

    if (isRestrictedUrl(tabUrl)) {
      pageTitleEl.innerText = 'Browser System Page';
      pageUrlEl.innerText = tabUrl || 'chrome://...';
      pageUrlEl.style.color = '#f59e0b';
      nodeInfoTitle.innerText = 'System Page Detected';
      nodeInfoDesc.innerText = 'Browser internal pages (like extensions or settings) are restricted by Chrome security. Open any web application to inspect and diagnose its behavioral graph.';
      generateBtn.disabled = true;
      generateBtn.title = 'Cannot inspect internal browser system pages.';
      return;
    }

    // In case recorder.js wasn't injected yet (tab was loaded before extension update)
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        files: ['recorder.js']
      });
    } catch (_) {}

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
    if (activeTabInfo && activeTabInfo.url && !isRestrictedUrl(activeTabInfo.url)) {
      const parsed = safeParseUrl(activeTabInfo.url);
      extractedEvidence = {
        url: parsed.url,
        origin: parsed.origin,
        pathname: parsed.pathname,
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
  if (!evidence) return;
  pageTitleEl.innerText = evidence.title || 'Web Application';
  pageUrlEl.innerText = evidence.url || '';
  btnCountEl.innerText = evidence.buttons ? evidence.buttons.length : 0;
  formCountEl.innerText = evidence.forms ? evidence.forms.length : 0;
  endpointCountEl.innerText = evidence.scriptEndpoints ? evidence.scriptEndpoints.length : 0;
}

// -------------------------------------------------------------
// 3. Rolling Flight Recorder Buffer Retriever & Stream Renderer
// -------------------------------------------------------------
async function updateFlightRecorderData() {
  if (!activeTabInfo || !activeTabInfo.id) return [];
  const tabUrl = activeTabInfo.url || '';
  if (isRestrictedUrl(tabUrl)) return [];

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTabInfo.id },
      world: 'MAIN',
      func: () => window.__ARGUS_FLIGHT_RECORDER_BUFFER__ || []
    });

    flightRecorderTrace = (results && results[0] && Array.isArray(results[0].result))
      ? results[0].result
      : [];

    if (traceCountBadge) {
      traceCountBadge.innerText = flightRecorderTrace.length;
    }

    renderFlightTraceStream(flightRecorderTrace);
    return flightRecorderTrace;
  } catch (err) {
    console.warn('[Argus] Could not retrieve flight recorder buffer:', err);
    return [];
  }
}

function renderFlightTraceStream(events) {
  if (!flightTraceStream) return;
  flightTraceStream.innerHTML = '';

  if (!events || events.length === 0) {
    flightTraceStream.innerHTML = '<div class="trace-empty">No events recorded yet. Interact with the webpage to capture clicks and network calls.</div>';
    return;
  }

  // Render events in reverse chronological order (newest first)
  const reversed = [...events].reverse();

  reversed.forEach(evt => {
    const itemEl = document.createElement('div');
    const timeStr = evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString() : '';

    let badgeClass = 'action';
    let itemClass = 'action';
    let badgeText = 'CLICK';
    let detailText = evt.label || '';

    if (evt.type === 'PAGE_VIEW') {
      badgeClass = 'page';
      itemClass = 'page';
      badgeText = 'PAGE';
      detailText = evt.pathname || evt.url || '';
    } else if (evt.type === 'USER_ACTION') {
      badgeClass = 'action';
      itemClass = 'action';
      badgeText = 'CLICK';
      detailText = evt.label || 'User Click';
    } else if (evt.type === 'API_CALL') {
      badgeClass = 'page';
      itemClass = 'api-ok';
      badgeText = evt.method || 'REQ';
      detailText = evt.url || '';
    } else if (evt.type === 'API_RESULT') {
      const dur = evt.durationMs ? `${evt.durationMs}ms` : '';
      if (evt.outcome === 'TIMEOUT') {
        badgeClass = 'api-timeout';
        itemClass = 'api-timeout';
        badgeText = `⏱️ TIMEOUT (${dur})`;
      } else if (evt.outcome === 'SUCCESS') {
        badgeClass = 'api-ok';
        itemClass = 'api-ok';
        badgeText = `✅ ${evt.status} (${dur})`;
      } else {
        badgeClass = 'api-fail';
        itemClass = 'api-fail';
        badgeText = `❌ ${evt.status || 'ERR'} (${dur})`;
      }
      detailText = `${evt.method || 'API'} ${evt.url || ''} ${evt.error ? `[${evt.error}]` : ''}`;
    } else if (evt.type === 'ERROR') {
      badgeClass = 'error';
      itemClass = 'error';
      badgeText = '❌ ERROR';
      detailText = evt.message || 'Script fault';
    }

    itemEl.className = `trace-item ${itemClass}`;
    itemEl.innerHTML = `
      <span class="trace-badge ${badgeClass}">${badgeText}</span>
      <span class="trace-details">${escapeHtml(detailText)}</span>
      <span class="trace-meta">${timeStr}</span>
    `;

    flightTraceStream.appendChild(itemEl);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// -------------------------------------------------------------
// 4. Live Self-Diagnosis Controller
// -------------------------------------------------------------
async function onRunDiagnoseClicked() {
  const userComplaint = userProblemInput.value.trim();
  if (!userComplaint) {
    alert('Please briefly describe what problem you encountered on the page.');
    userProblemInput.focus();
    return;
  }

  // Set loading UI
  runDiagnoseBtn.disabled = true;
  diagSpinner.style.display = 'inline-block';
  diagBtnText.innerText = 'Analyzing Session Trace against Expected Graph...';

  try {
    // 1. Refresh latest flight recorder trace
    const trace = await updateFlightRecorderData();

    // 2. Ensure we have an expected graph
    if (!currentGraph) {
      currentGraph = synthesizeHeuristicGraph(extractedEvidence || {
        url: activeTabInfo?.url || 'https://example.com',
        title: activeTabInfo?.title || 'Web Application'
      });
      layoutGraph(currentGraph);
    }

    // 3. Inspect Flight Recorder for Failures & Timeouts
    const failEvent = trace.slice().reverse().find(e =>
      e.type === 'API_RESULT' && (e.outcome === 'TIMEOUT' || e.outcome === 'FAILURE' || e.status >= 400 || e.status === 0)
    ) || trace.slice().reverse().find(e => e.type === 'ERROR');

    const wf = currentGraph.workflows[0];

    if (failEvent) {
      // Divergence detected!
      const isTimeout = failEvent.outcome === 'TIMEOUT' || failEvent.status === 504 || failEvent.status === 408;
      const isAuth = failEvent.status === 401 || failEvent.status === 403;
      const isRateLimit = failEvent.status === 429;
      const dur = failEvent.durationMs ? `${failEvent.durationMs}ms` : 'several seconds';
      const endpoint = failEvent.url || failEvent.label || 'network endpoint';

      // Match with graph node
      let matchedNode = null;
      if (isTimeout) {
        matchedNode = wf.nodes.find(n => n.expectedOutcome === 'TIMEOUT') || wf.nodes.find(n => n.type === 'API_RESULT');
      } else if (isAuth) {
        matchedNode = wf.nodes.find(n => n.label.includes('403') || n.label.includes('401')) || wf.nodes.find(n => n.type === 'API_RESULT');
      } else if (isRateLimit) {
        matchedNode = wf.nodes.find(n => n.label.includes('429')) || wf.nodes.find(n => n.type === 'API_RESULT');
      } else {
        matchedNode = wf.nodes.find(n => n.expectedOutcome === 'FAILURE') || wf.nodes.find(n => n.type === 'API_RESULT');
      }

      divergedNodeId = matchedNode ? matchedNode.id : wf.terminalNodes[1] || null;

      // Update Diagnosis Report Card
      diagnosisReportCard.className = 'card diagnosis-report';
      diagStatusBadge.className = 'diag-badge';
      diagStatusBadge.innerText = 'DIVERGENCE DETECTED ⚠️';
      diagTimestamp.innerText = new Date().toLocaleTimeString();

      // Plain English Explanation
      if (isTimeout) {
        diagUserExplanation.innerText = `Regarding "${userComplaint}": The request to ${endpoint} exceeded the server timeout threshold (${dur}). No transaction was corrupted, but the server failed to send a confirmation.`;
      } else if (isAuth) {
        diagUserExplanation.innerText = `Regarding "${userComplaint}": The request was rejected due to permission or session expiration (HTTP ${failEvent.status}). Your user account lacks active entitlement for this action.`;
      } else if (isRateLimit) {
        diagUserExplanation.innerText = `Regarding "${userComplaint}": You have exceeded the active request rate limit or token quota (HTTP 429). The system temporarily paused new submissions.`;
      } else {
        diagUserExplanation.innerText = `Regarding "${userComplaint}": The server encountered a fault while processing ${endpoint} (HTTP ${failEvent.status || 'Network Error'}). The action was interrupted.`;
      }

      // Technical Developer Diagnosis
      diagDevExplanation.innerText = `Divergence at node '${matchedNode ? matchedNode.label : endpoint}' (Diverged from happy_path).
Observed: ${failEvent.method || 'CALL'} ${endpoint} ➔ Status ${failEvent.status || 'ERR'} (Elapsed: ${dur}).
Expected: HTTP 200 OK within 8,000ms SLA.`;

      // Remediation Actions
      diagRemediationList.innerHTML = `
        <li>Verify backend microservice status and network latency for <code>${escapeHtml(endpoint)}</code>.</li>
        <li>Implement automatic idempotent retry with backoff for transient network timeouts.</li>
        <li>Check authentication token freshness and entitlement grants.</li>
      `;

      // Store incident report for 1-click clipboard export
      latestIncidentReport = `### 🚨 Argus Behavioral Self-Diagnosis Incident Report
- **URL:** ${activeTabInfo?.url || 'N/A'}
- **User Complaint:** "${userComplaint}"
- **Status:** DIVERGENCE DETECTED
- **Divergence Node:** ${matchedNode ? matchedNode.label : 'API Boundary'}
- **Fault Details:** ${failEvent.method || 'CALL'} ${endpoint} (Status: ${failEvent.status}, Latency: ${dur})
- **Root Cause:** Upstream service latency / error interrupted happy path.
- **Client:** Chrome Extension / Argus SystemSleuth 1.0`;

    } else {
      // Normal / Healthy Trace
      divergedNodeId = null;
      diagnosisReportCard.className = 'card diagnosis-report healthy';
      diagStatusBadge.className = 'diag-badge healthy';
      diagStatusBadge.innerText = 'HEALTHY EXECUTION ✅';
      diagTimestamp.innerText = new Date().toLocaleTimeString();

      diagUserExplanation.innerText = `Regarding "${userComplaint}": All recent network calls in the flight recorder returned HTTP 200 OK with normal latency. The application appears to be operating within expected operational parameters.`;
      diagDevExplanation.innerText = `Zero HTTP errors or timeouts detected across the last ${trace.length} recorded session events.`;
      diagRemediationList.innerHTML = `
        <li>No infrastructure anomalies observed. Check frontend UI state assertions or input validation.</li>
      `;

      latestIncidentReport = `### ℹ️ Argus Behavioral Self-Diagnosis Report
- **URL:** ${activeTabInfo?.url || 'N/A'}
- **User Query:** "${userComplaint}"
- **Status:** HEALTHY (Zero failures in flight buffer across ${trace.length} events)`;
    }

    diagnosisReportCard.classList.remove('hidden');

    // Re-render visualizer canvas to reflect the red diverged node highlight!
    renderCanvasGraph();

  } catch (err) {
    console.error('[Argus] Diagnosis error:', err);
    alert('Diagnosis failed: ' + err.message);
  } finally {
    runDiagnoseBtn.disabled = false;
    diagSpinner.style.display = 'none';
    diagBtnText.innerText = '⚡ Diagnose My Problem';
  }
}

function onCopyReportClicked() {
  if (!latestIncidentReport) return;
  navigator.clipboard.writeText(latestIncidentReport).then(() => {
    copyReportBtn.innerText = '✓ Copied Incident Report!';
    setTimeout(() => { copyReportBtn.innerText = '📋 Copy Incident Report for Engineering'; }, 1500);
  }).catch(err => {
    alert('Copy failed: ' + err);
  });
}

// -------------------------------------------------------------
// 5. Graph Generation Controller (Expected Graph)
// -------------------------------------------------------------
async function onGenerateClicked() {
  if (!extractedEvidence) {
    await inspectActiveTab();
  }

  generateBtn.disabled = true;
  genSpinner.style.display = 'inline-block';
  genBtnText.innerText = 'Deconstructing Full-Stack Architecture...';
  hideApiNotice();

  const apiKey = apiKeyInput.value.trim();
  const mode = synthesisModeSelect ? synthesisModeSelect.value : 'deep';

  try {
    let graph = null;
    let modelUsed = null;

    if (apiKey) {
      try {
        genBtnText.innerText = mode === 'deep' 
          ? 'Pass 1/2: Deconstructing Backend Microservices & Edge Cases...' 
          : 'Consulting Gemini Systems Architect...';
        
        const synthesisResult = await synthesizeWithGemini(extractedEvidence, apiKey, mode);
        if (synthesisResult && synthesisResult.graph && synthesisResult.graph.workflows) {
          graph = synthesisResult.graph;
          modelUsed = synthesisResult.modelUsed;
          showApiNotice(`Synthesized via ${modelUsed} with full distributed edge-case coverage (${mode === 'deep' ? '2 Passes' : '1 Pass'})`, 'success');
        }
      } catch (llmErr) {
        console.warn('Gemini synthesis failed, falling back to heuristic synthesizer:', llmErr);
        showApiNotice(`AI Notice: ${llmErr.message} — used built-in edge-case engine.`, 'error');
      }
    }

    if (!graph) {
      genBtnText.innerText = 'Synthesizing with Offline Heuristic Engine...';
      graph = synthesizeHeuristicGraph(extractedEvidence);
    }

    currentGraph = graph;

    // Display Results
    if (resultsSection) {
      resultsSection.classList.remove('hidden');
    }

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
// 6. Dynamic Model Discovery & Full-Stack SRE Gemini Synthesis
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
        temperature: 0.15
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

async function synthesizeWithGemini(evidence, apiKey, mode = 'deep') {
  const discovered = await discoverActiveModel(apiKey);
  const modelsToTry = discovered 
    ? [discovered, ...CANDIDATE_FLASH_MODELS.filter(m => m !== discovered)]
    : CANDIDATE_FLASH_MODELS;

  let successfulModel = null;
  let lastError = null;
  let finalGraph = null;

  if (mode === 'deep') {
    genBtnText.innerText = 'Pass 1/2: Deconstructing Backend Microservices & Edge Cases...';
    const stage1Prompt = `You are Argus: SystemSleuth's Principal Distributed Systems SRE and Behavioral Architect.
Argus performs automated behavioral self-diagnosis by modeling web applications as formal state machines with deep failure-mode coverage.

Analyze the webpage evidence and deconstruct the real-world distributed system behind the user's primary action on this page:
URL: ${evidence.url}
Title: ${evidence.title}
Headings: ${JSON.stringify(evidence.headings || [])}
Buttons: ${JSON.stringify(evidence.buttons || [])}
Forms: ${JSON.stringify(evidence.forms || [])}
Discovered Script Endpoints: ${JSON.stringify(evidence.scriptEndpoints || [])}

CRITICAL RULES:
1. DO NOT generate toy templates with generic home-page URLs (like "${evidence.url}").
2. INFER REALISTIC PRODUCTION-GRADE BACKEND ENDPOINTS matching the domain.
3. Deconstruct the interaction into a multi-step pipeline (Step 1: Auth/Entitlement pre-flight, Step 2: Primary execution).
4. Define critical edge cases (401/403 Auth, 429 RateLimit, 504 Gateway Timeout, 422 Validation).

Return strictly JSON matching this structure:
{
  "featureId": "string",
  "featureName": "string",
  "featureDescription": "string",
  "primaryUserAction": "string",
  "apiPipeline": [
    { "step": 1, "name": "AuthCheck", "method": "GET", "endpoint": "string", "timeoutMs": 3000 },
    { "step": 2, "name": "PrimaryExecution", "method": "POST", "endpoint": "string", "timeoutMs": 10000 }
  ],
  "edgeCases": [
    { "id": "auth_failure", "code": 403, "label": "ApiResult:403:Forbidden", "cause": "string", "stateResult": "StateChange:AuthError" },
    { "id": "rate_limit", "code": 429, "label": "ApiResult:429:TooManyRequests", "cause": "string", "stateResult": "StateChange:RateLimitBanner" },
    { "id": "timeout", "code": 504, "label": "ApiResult:504:GatewayTimeout", "cause": "string", "stateResult": "StateChange:TimeoutNotice" },
    { "id": "validation_error", "code": 422, "label": "ApiResult:422:UnprocessableEntity", "cause": "string", "stateResult": "StateChange:ValidationError" }
  ]
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

    genBtnText.innerText = `Pass 2/2 (${successfulModel}): Synthesizing Full State Machine & Edge-Case Matrix...`;
    const stage2Prompt = `You are Argus: SystemSleuth's Principal Distributed Systems Architect.
Synthesize a formal Argus Expected Behavioral Graph (expected_graph.json) that directly implements this distributed systems blueprint:

Blueprint:
${JSON.stringify(stage1Result, null, 2)}

Webpage Context:
URL: ${evidence.url}
Title: ${evidence.title}

Graph Requirements:
1. Model full-stack sequence: "n_session_start" ➔ "n_page_view" ➔ user action ➔ pre-flight API call ➔ primary execution API call.
2. Every API step in the pipeline must be an API_CALL node with its realistic endpoint.
3. Every API call must have explicit branches for Happy Path (200 OK) and distinct failure paths for the defined edge cases (401/403, 429, 504/Timeout, 422/Error).
4. Annotate edges with "path": "happy_path", "auth_failure_path", "rate_limit_path", "timeout_failure_path", etc.

Return strictly JSON matching the Argus 1.0 schema:
{
  "schemaVersion": "1.0",
  "appVersion": "1.0.0",
  "platform": "web",
  "description": "Expected behavioral contract synthesized for ${evidence.title}",
  "workflows": [
    {
      "id": "wf_${stage1Result.featureId || 'feature'}",
      "name": "${stage1Result.featureName || 'FeatureWorkflow'}",
      "description": "${stage1Result.featureDescription || 'Primary workflow'}",
      "entryNode": "n_session_start",
      "terminalNodes": ["n_terminal_success", "n_terminal_auth_fail", "n_terminal_rate_limit", "n_terminal_timeout", "n_terminal_error"],
      "nodes": [...],
      "edges": [...],
      "paths": {
        "happy_path": { "description": "Successful execution", "sequence": [...] },
        "auth_failure_path": { "description": "Auth or seat entitlement rejected", "divergesFromHappyPathAt": "...", "sequence": [...] },
        "rate_limit_path": { "description": "Rate limit quota exhausted", "divergesFromHappyPathAt": "...", "sequence": [...] },
        "timeout_failure_path": { "description": "Gateway or upstream inference timeout", "divergesFromHappyPathAt": "...", "sequence": [...] }
      }
    }
  ]
}`;

    finalGraph = await callGeminiGenerate(successfulModel, stage2Prompt, apiKey);

  } else {
    genBtnText.innerText = 'Consulting Gemini Systems Architect...';
    const singlePrompt = `You are Argus: SystemSleuth's Principal Distributed Systems SRE and Behavioral Architect.
Analyze the following webpage evidence and synthesize a realistic, production-grade Expected Behavioral Graph.

Webpage Evidence:
URL: ${evidence.url}
Title: ${evidence.title}
Headings: ${JSON.stringify(evidence.headings || [])}
Buttons: ${JSON.stringify(evidence.buttons || [])}
Forms: ${JSON.stringify(evidence.forms || [])}
Discovered Script Endpoints: ${JSON.stringify(evidence.scriptEndpoints || [])}

Rules:
1. In-depth full-stack modeling with realistic endpoints (not "${evidence.url}").
2. Include at least 3 distinct production edge cases: 401/403 Auth, 429 RateLimit, 504 Gateway Timeout.
3. Model distinct failure paths in "paths": "happy_path", "auth_failure_path", "rate_limit_path", "timeout_failure_path".

Return strictly valid JSON matching Argus schema.`;

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
// 7. Built-in Offline Heuristic Synthesizer (Edge-Case Ready)
// -------------------------------------------------------------
function synthesizeHeuristicGraph(evidence) {
  const url = new URL(evidence.url || 'https://example.com');
  const pathname = url.pathname === '/' ? '/home' : url.pathname;
  const cleanTitle = (evidence.title || 'WebApp').replace(/[^a-zA-Z0-9]/g, '');

  let primaryAction = 'Submit';
  if (evidence.buttons && evidence.buttons.length > 0) {
    const candidate = evidence.buttons.find(b =>
      /copilot|pay|checkout|order|submit|login|sign|search|send|save|confirm/i.test(b.label)
    );
    primaryAction = candidate ? candidate.label : evidence.buttons[0].label;
  }
  primaryAction = primaryAction.slice(0, 24);

  let authEndpoint = `/api/v1/auth/entitlement`;
  let execEndpoint = `/api/v1/action/execute`;

  if (evidence.scriptEndpoints && evidence.scriptEndpoints.length >= 2) {
    authEndpoint = evidence.scriptEndpoints[0];
    execEndpoint = evidence.scriptEndpoints[1];
  } else if (evidence.scriptEndpoints && evidence.scriptEndpoints.length === 1) {
    execEndpoint = evidence.scriptEndpoints[0];
  } else if (url.hostname.includes('github.com')) {
    authEndpoint = '/api/v3/user/copilot/entitlement';
    execEndpoint = '/github-copilot/v1/chat/completions';
  } else if (pathname !== '/home') {
    authEndpoint = `/api${pathname}/status`;
    execEndpoint = `/api${pathname}/submit`;
  }

  const workflowId = `wf_${cleanTitle.toLowerCase().slice(0, 16) || 'web'}_workflow`;
  const workflowName = `${cleanTitle || 'Web'}ActionWorkflow`;

  return {
    schemaVersion: '1.0',
    appVersion: '1.0.0',
    platform: 'web',
    description: `Full-stack behavioral contract synthesized for ${evidence.title || url.hostname}.`,
    workflows: [
      {
        id: workflowId,
        name: workflowName,
        description: `User triggers ${primaryAction}. Client verifies entitlement at ${authEndpoint} and executes at ${execEndpoint}.`,
        entryNode: 'n_session_start',
        terminalNodes: ['n_terminal_success', 'n_terminal_auth_fail', 'n_terminal_rate_limit', 'n_terminal_timeout', 'n_terminal_cors'],
        nodes: [
          {
            id: 'n_session_start',
            type: 'SESSION_START',
            label: 'SessionStart',
            expectedOutcome: 'SUCCESS',
            description: `Session initialized on ${url.origin}. Argus telemetry active.`
          },
          {
            id: 'n_page_view',
            type: 'PAGE_VIEW',
            label: `PageView:${pathname}`,
            expectedOutcome: 'SUCCESS',
            description: `Page ${evidence.title || pathname} rendered.`
          },
          {
            id: 'n_user_action',
            type: 'USER_ACTION',
            label: `Click:${primaryAction}`,
            expectedOutcome: 'SUCCESS',
            description: `User triggered primary action '${primaryAction}'.`
          },
          {
            id: 'n_api_auth_check',
            type: 'API_CALL',
            label: `ApiCall:${authEndpoint}`,
            expectedOutcome: 'PENDING',
            description: `Pre-flight entitlement check to ${authEndpoint}.`,
            constraints: { timeoutThresholdMs: 3000 }
          },
          {
            id: 'n_api_auth_success',
            type: 'API_RESULT',
            label: `ApiResult:200:${authEndpoint}`,
            expectedOutcome: 'SUCCESS',
            description: 'User entitlement & permissions confirmed.'
          },
          {
            id: 'n_api_auth_403',
            type: 'API_RESULT',
            label: `ApiResult:403:${authEndpoint}`,
            expectedOutcome: 'FAILURE',
            description: 'License expired, seat revoked, or organization SSO policy blocked access.',
            isKnownFailureMode: true,
            knownCauses: [
              'License expired or user seat revoked',
              'Organization SAML/SSO enforcement policy expired',
              'Missing required RBAC permissions for target resource'
            ]
          },
          {
            id: 'n_terminal_auth_fail',
            type: 'STATE_CHANGE',
            label: 'StateChange:EntitlementRequired',
            expectedOutcome: 'FAILURE',
            description: 'UI rendered re-authorization or license upgrade dialog.',
            isTerminal: true,
            isKnownFailureMode: true
          },
          {
            id: 'n_state_processing',
            type: 'STATE_CHANGE',
            label: 'StateChange:Processing',
            expectedOutcome: 'PENDING',
            description: 'UI enters loading state for primary execution.'
          },
          {
            id: 'n_api_execute',
            type: 'API_CALL',
            label: `ApiCall:${execEndpoint}`,
            expectedOutcome: 'PENDING',
            description: `Primary dispatch to ${execEndpoint}.`,
            constraints: { timeoutThresholdMs: 8000 }
          },
          {
            id: 'n_api_exec_200',
            type: 'API_RESULT',
            label: `ApiResult:200:${execEndpoint}`,
            expectedOutcome: 'SUCCESS',
            description: 'Server processed request successfully.'
          },
          {
            id: 'n_terminal_success',
            type: 'STATE_CHANGE',
            label: 'StateChange:Completed',
            expectedOutcome: 'SUCCESS',
            description: 'Operation completed successfully.',
            isTerminal: true
          },
          {
            id: 'n_api_exec_429',
            type: 'API_RESULT',
            label: `ApiResult:429:${execEndpoint}`,
            expectedOutcome: 'FAILURE',
            description: 'API rate limit or monthly token quota exhausted.',
            isKnownFailureMode: true,
            knownCauses: [
              'Hourly or monthly API quota depleted',
              'Burst request rate exceeded threshold'
            ]
          },
          {
            id: 'n_terminal_rate_limit',
            type: 'STATE_CHANGE',
            label: 'StateChange:RateLimitBanner',
            expectedOutcome: 'FAILURE',
            description: 'UI displayed rate limit cooldown banner with retry timer.',
            isTerminal: true,
            isKnownFailureMode: true
          },
          {
            id: 'n_api_exec_timeout',
            type: 'API_RESULT',
            label: `ApiResult:504:${execEndpoint}`,
            expectedOutcome: 'TIMEOUT',
            description: 'Gateway timeout: upstream microservice or inference engine exceeded 8,000ms SLA.',
            isKnownFailureMode: true,
            knownCauses: [
              'Upstream microservice cold start or queue saturation',
              'LLM inference model gateway high latency spike'
            ]
          },
          {
            id: 'n_terminal_timeout',
            type: 'STATE_CHANGE',
            label: 'StateChange:TimeoutNotice',
            expectedOutcome: 'TIMEOUT',
            description: 'UI presented retry dialog with exponential backoff option.',
            isTerminal: true,
            isKnownFailureMode: true
          },
          {
            id: 'n_api_exec_cors',
            type: 'API_RESULT',
            label: `ApiResult:FAILED:${execEndpoint}`,
            expectedOutcome: 'FAILURE',
            description: 'Network request aborted due to CORS preflight failure or 500 error.',
            isKnownFailureMode: true,
            knownCauses: [
              'Missing Access-Control-Allow-Origin header in response',
              'Network disconnect or client offline'
            ]
          },
          {
            id: 'n_terminal_cors',
            type: 'STATE_CHANGE',
            label: 'StateChange:FailureAlert',
            expectedOutcome: 'FAILURE',
            description: 'UI displayed error notification banner.',
            isTerminal: true,
            isKnownFailureMode: true
          }
        ],
        edges: [
          { from: 'n_session_start', to: 'n_page_view', label: 'navigated_to', path: 'all' },
          { from: 'n_page_view', to: 'n_user_action', label: 'user_triggered', path: 'all' },
          { from: 'n_user_action', to: 'n_api_auth_check', label: 'api_initiated', path: 'all' },
          { from: 'n_api_auth_check', to: 'n_api_auth_success', label: 'api_responded', path: 'happy_path' },
          { from: 'n_api_auth_check', to: 'n_api_auth_403', label: 'api_responded', path: 'auth_failure_path' },
          { from: 'n_api_auth_403', to: 'n_terminal_auth_fail', label: 'state_changed', path: 'auth_failure_path' },
          { from: 'n_api_auth_success', to: 'n_state_processing', label: 'state_changed', path: 'happy_path' },
          { from: 'n_state_processing', to: 'n_api_execute', label: 'api_initiated', path: 'happy_path' },
          { from: 'n_api_execute', to: 'n_api_exec_200', label: 'api_responded', path: 'happy_path' },
          { from: 'n_api_exec_200', to: 'n_terminal_success', label: 'state_changed', path: 'happy_path' },
          { from: 'n_api_execute', to: 'n_api_exec_429', label: 'api_responded', path: 'rate_limit_path' },
          { from: 'n_api_execute', to: 'n_api_exec_429', label: 'state_changed', path: 'rate_limit_path' },
          { from: 'n_api_execute', to: 'n_api_exec_timeout', label: 'api_responded', path: 'timeout_failure_path' },
          { from: 'n_api_exec_timeout', to: 'n_terminal_timeout', label: 'state_changed', path: 'timeout_failure_path' },
          { from: 'n_api_execute', to: 'n_api_exec_cors', label: 'api_responded', path: 'cors_error_path' },
          { from: 'n_api_exec_cors', to: 'n_terminal_cors', label: 'state_changed', path: 'cors_error_path' }
        ],
        paths: {
          happy_path: {
            description: 'User successfully completes verified workflow',
            sequence: [
              'n_session_start',
              'n_page_view',
              'n_user_action',
              'n_api_auth_check',
              'n_api_auth_success',
              'n_state_processing',
              'n_api_execute',
              'n_api_exec_200',
              'n_terminal_success'
            ]
          },
          auth_failure_path: {
            description: 'User license expired or seat revoked at entitlement check',
            divergesFromHappyPathAt: 'n_api_auth_check',
            sequence: [
              'n_session_start',
              'n_page_view',
              'n_user_action',
              'n_api_auth_check',
              'n_api_auth_403',
              'n_terminal_auth_fail'
            ]
          },
          rate_limit_path: {
            description: 'API rate limit or monthly token quota exhausted',
            divergesFromHappyPathAt: 'n_api_execute',
            sequence: [
              'n_session_start',
              'n_page_view',
              'n_user_action',
              'n_api_auth_check',
              'n_api_auth_success',
              'n_state_processing',
              'n_api_execute',
              'n_api_exec_429',
              'n_terminal_rate_limit'
            ]
          },
          timeout_failure_path: {
            description: 'Gateway timeout: upstream microservice exceeded 8,000ms SLA',
            divergesFromHappyPathAt: 'n_api_execute',
            sequence: [
              'n_session_start',
              'n_page_view',
              'n_user_action',
              'n_api_auth_check',
              'n_api_auth_success',
              'n_state_processing',
              'n_api_execute',
              'n_api_exec_timeout',
              'n_terminal_timeout'
            ]
          },
          cors_error_path: {
            description: 'Network failure or server error',
            divergesFromHappyPathAt: 'n_api_execute',
            sequence: [
              'n_session_start',
              'n_page_view',
              'n_user_action',
              'n_api_auth_check',
              'n_api_auth_success',
              'n_state_processing',
              'n_api_execute',
              'n_api_exec_cors',
              'n_terminal_cors'
            ]
          }
        }
      }
    ]
  };
}

// -------------------------------------------------------------
// 8. Dynamic Topological Canvas Layout Engine
// -------------------------------------------------------------
function layoutGraph(graph) {
  layoutNodes = [];
  layoutEdges = [];

  const wf = graph?.workflows?.[0];
  if (!wf || !wf.nodes) return;

  const happySeq = wf.paths?.happy_path?.sequence || [];

  const nodeMap = new Map();
  wf.nodes.forEach(n => nodeMap.set(n.id, n));

  const incoming = new Map();
  const outgoing = new Map();
  wf.nodes.forEach(n => {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  });

  if (wf.edges) {
    wf.edges.forEach(e => {
      if (outgoing.has(e.from)) outgoing.get(e.from).push(e.to);
      if (incoming.has(e.to)) incoming.get(e.to).push(e.from);
    });
  }

  // Determine node depths via BFS from entryNode
  const depths = new Map();
  const entryId = wf.entryNode || wf.nodes[0]?.id;
  depths.set(entryId, 0);

  const queue = [entryId];
  while (queue.length > 0) {
    const curr = queue.shift();
    const currDepth = depths.get(curr) || 0;
    const neighbors = outgoing.get(curr) || [];
    neighbors.forEach(nextId => {
      const existing = depths.get(nextId);
      if (existing === undefined || existing < currDepth + 1) {
        depths.set(nextId, currDepth + 1);
        queue.push(nextId);
      }
    });
  }

  // Fallback depth mapping
  wf.nodes.forEach(node => {
    if (!depths.has(node.id)) {
      if (node.type === 'SESSION_START') depths.set(node.id, 0);
      else if (node.type === 'PAGE_VIEW') depths.set(node.id, 1);
      else if (node.type === 'USER_ACTION') depths.set(node.id, 2);
      else if (node.type === 'STATE_CHANGE' && !node.isTerminal) depths.set(node.id, 3);
      else if (node.type === 'API_CALL') depths.set(node.id, 4);
      else if (node.type === 'API_RESULT') depths.set(node.id, 5);
      else depths.set(node.id, 6);
    }
  });

  // Group nodes by depth column
  const depthColumns = new Map();
  let maxDepth = 0;
  depths.forEach((d, id) => {
    if (d > maxDepth) maxDepth = d;
    if (!depthColumns.has(d)) depthColumns.set(d, []);
    depthColumns.get(d).push(id);
  });

  const colWidth = Math.max(65, Math.min(95, 460 / Math.max(maxDepth, 5)));
  const totalWidth = Math.max(480, (maxDepth + 1) * colWidth + 50);
  graphCanvas.width = totalWidth;

  // Place nodes on canvas
  depthColumns.forEach((nodeIds, colDepth) => {
    const colX = 35 + colDepth * colWidth;

    const happyNodeId = nodeIds.find(id => happySeq.includes(id));
    const branchNodes = nodeIds.filter(id => id !== happyNodeId);

    // Place happy path node on center line (y = 170)
    if (happyNodeId) {
      const node = nodeMap.get(happyNodeId);
      layoutNodes.push({
        id: node.id,
        label: formatNodeLabel(node),
        type: node.type,
        outcome: node.expectedOutcome,
        x: colX,
        y: 170,
        radius: 18,
        raw: node
      });
    }

    // Place branch nodes symmetrically
    const totalBranches = branchNodes.length;
    if (totalBranches === 1) {
      const node = nodeMap.get(branchNodes[0]);
      const isAuthOrQuota = /auth|permission|rate|quota/i.test(node.id) || (node.label && /401|403|429/.test(node.label));
      const branchY = isAuthOrQuota ? 75 : 265;
      layoutNodes.push({
        id: node.id,
        label: formatNodeLabel(node),
        type: node.type,
        outcome: node.expectedOutcome,
        x: colX,
        y: branchY,
        radius: 18,
        raw: node
      });
    } else if (totalBranches > 1) {
      const branchYSlots = [55, 285, 110, 230, 310, 30];
      branchNodes.forEach((nodeId, idx) => {
        const node = nodeMap.get(nodeId);
        const branchY = branchYSlots[idx % branchYSlots.length];
        layoutNodes.push({
          id: node.id,
          label: formatNodeLabel(node),
          type: node.type,
          outcome: node.expectedOutcome,
          x: colX,
          y: branchY,
          radius: 18,
          raw: node
        });
      });
    }
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
  if (node.type === 'USER_ACTION') {
    const lbl = (node.label || '').replace(/^Click:/i, '');
    return lbl.length > 7 ? lbl.slice(0, 6) + '…' : lbl || 'CLICK';
  }
  if (node.type === 'API_CALL') {
    const lbl = (node.label || '').replace(/^ApiCall:/i, '');
    const segments = lbl.split('/').filter(Boolean);
    const lastSeg = segments[segments.length - 1] || 'API';
    return lastSeg.length > 8 ? lastSeg.slice(0, 7) + '…' : lastSeg;
  }
  if (node.type === 'API_RESULT') {
    const lbl = node.label || '';
    if (lbl.includes('200') || lbl.includes('201')) return '200 OK';
    if (lbl.includes('401')) return '401 AUTH';
    if (lbl.includes('403')) return '403 FORBID';
    if (lbl.includes('429')) return '429 LIMIT';
    if (lbl.includes('422')) return '422 VALID';
    if (lbl.includes('504') || lbl.includes('TIMEOUT') || node.expectedOutcome === 'TIMEOUT') return '504 T/O';
    if (lbl.includes('500') || lbl.includes('502')) return '500 ERR';
    if (node.expectedOutcome === 'SUCCESS') return '200 OK';
    return 'ERR';
  }
  if (node.isTerminal) {
    if (node.expectedOutcome === 'SUCCESS') return 'DONE ✅';
    if (node.id.includes('auth') || node.id.includes('permission')) return 'REAUTH 🔒';
    if (node.id.includes('rate') || node.id.includes('quota')) return 'LIMIT ⏳';
    if (node.expectedOutcome === 'TIMEOUT') return 'RETRY ⏱️';
    return 'ALERT ❌';
  }
  return 'STATE';
}

function renderCanvasGraph() {
  const ctx = graphCanvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = graphCanvas.width;
  const height = 340;

  ctx.save();
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#0b1120';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#1e293b';
  for (let gx = 15; gx < width; gx += 25) {
    for (let gy = 15; gy < height; gy += 25) {
      ctx.beginPath();
      ctx.arc(gx, gy, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  layoutEdges.forEach(edge => {
    drawEdge(ctx, edge);
  });

  layoutNodes.forEach(node => {
    drawNode(ctx, node);
  });

  ctx.restore();
}

function drawEdge(ctx, edge) {
  const { from, to, path } = edge;

  let strokeColor = '#475569';
  if (path === 'happy_path') strokeColor = '#10b981';
  else if (path.includes('auth') || path.includes('permission')) strokeColor = '#a855f7';
  else if (path.includes('rate') || path.includes('quota')) strokeColor = '#fb923c';
  else if (path.includes('timeout') || path.includes('latency')) strokeColor = '#f59e0b';
  else if (path.includes('fail') || path.includes('error') || path.includes('cors') || path.includes('validation')) strokeColor = '#ef4444';

  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;

  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (Math.abs(dy) > 10) {
    const cp1x = from.x + dx * 0.5;
    const cp1y = from.y;
    const cp2x = from.x + dx * 0.5;
    const cp2y = to.y;

    ctx.moveTo(from.x, from.y);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, to.x, to.y);
    ctx.stroke();

    drawArrowHead(ctx, cp2x, cp2y, to.x, to.y, strokeColor);
  } else {
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
  const isDiverged = node.id === divergedNodeId;

  let fillColor = '#1e293b';
  let strokeColor = '#64748b';
  let textColor = '#ffffff';

  const isAuth = (node.label && (node.label.includes('401') || node.label.includes('403'))) ||
                 (node.id && (node.id.includes('auth') || node.id.includes('permission')));
  const isRateLimit = (node.label && (node.label.includes('429'))) ||
                      (node.id && (node.id.includes('rate') || node.id.includes('quota')));

  if (isDiverged) {
    fillColor = '#7f1d1d';
    strokeColor = '#ef4444';
  } else if (node.type === 'SESSION_START') {
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
  } else if (isAuth) {
    fillColor = '#4a044e';
    strokeColor = '#a855f7';
  } else if (isRateLimit) {
    fillColor = '#7c2d12';
    strokeColor = '#fb923c';
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

  if (isDiverged) {
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = 18;
  } else if (isSelected || isHovered) {
    ctx.shadowColor = isSelected ? '#38bdf8' : '#94a3b8';
    ctx.shadowBlur = isSelected ? 12 : 6;
  }

  ctx.beginPath();
  ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();

  ctx.lineWidth = isDiverged ? 3.5 : (isSelected ? 3 : 2);
  ctx.strokeStyle = isDiverged ? '#ffffff' : (isSelected ? '#ffffff' : strokeColor);
  ctx.stroke();

  ctx.shadowBlur = 0;

  ctx.font = 'bold 8px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(isDiverged ? 'FAULT ❌' : node.label, node.x, node.y);

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
    desc += ` | Timeout SLA: ${nodeObj.constraints.timeoutThresholdMs}ms`;
  }
  if (nodeObj.knownCauses && nodeObj.knownCauses.length > 0) {
    desc += ` | Known Root Causes: ${nodeObj.knownCauses.join(', ')}`;
  }
  nodeInfoDesc.innerText = desc;
}

// -------------------------------------------------------------
// 9. Evidence Tab Rendering
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
// 10. Copy & Download Handlers
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
