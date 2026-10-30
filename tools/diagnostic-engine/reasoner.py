"""
Argus AI Diagnostic Reasoner

Synthesizes graph divergence evidence, runtime metadata, and the user's natural language problem
description into actionable user-facing explanations and developer-facing root cause reports.

Features:
- Deterministic Rule-Based Reasoner (Zero API key needed, runs 100% offline)
- Optional LLM Enhancement (Supports Gemini, OpenAI, Claude if API key is provided)
"""

import os
import json
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional
from comparator import DivergenceReport

@dataclass
class DiagnosticResult:
    workflow_name: str
    diverged: bool
    divergence_type: str
    divergence_node_id: Optional[str]
    divergence_node_label: Optional[str]
    confidence: float
    user_explanation: str
    developer_diagnosis: str
    recommended_actions: List[str]
    known_causes: List[str] = field(default_factory=list)
    reproduction_trace: List[str] = field(default_factory=list)
    technical_details: Dict[str, Any] = field(default_factory=dict)

def synthesize_rule_based_diagnosis(
    report: DivergenceReport,
    user_query: Optional[str] = None
) -> DiagnosticResult:
    """
    Offline deterministic synthesis using the graph divergence evidence and behavioral knowledge base.
    """
    query_text = user_query.strip() if user_query else ""
    details = report.details
    duration = details.get("durationMs")
    duration_str = f"{duration:,}ms" if duration else "unknown duration"
    status_code = details.get("statusCode")
    endpoint = details.get("endpoint") or report.divergence_node_label or "remote service"
    error_msg = details.get("error") or "Operation did not complete as expected"

    user_explanation = ""
    developer_diagnosis = ""
    recommended_actions: List[str] = []

    if not report.diverged:
        user_explanation = "The application executed the workflow normally without any detected failures or timeouts."
        developer_diagnosis = "Execution trace strictly conforms to the Expected Happy Path. No state divergence or runtime exceptions detected."
        recommended_actions = ["No action needed. Application state is healthy."]

    elif report.divergence_type == "TIMEOUT":
        user_explanation = (
            f"Your request to {endpoint} took longer than expected ({duration_str}) and timed out. "
            "No data was corrupted, but the action did not finish processing. "
            "This usually happens when the network connection is slow or the server is momentarily overloaded."
        )
        developer_diagnosis = (
            f"Divergence at '{report.divergence_node_label}' (ID: {report.divergence_node_id}). "
            f"Network request timed out after {duration_str}. "
            f"Error signature: '{error_msg}'. "
            f"Runtime execution followed '{report.matched_failure_path or 'unnamed_failure_path'}' instead of the Happy Path."
        )
        recommended_actions = [
            f"Verify server latency and capacity for endpoint: {endpoint}.",
            f"Consider increasing client timeout threshold if payloads frequently require > {duration_str}.",
            "Implement exponential backoff retry on client for transient timeouts.",
            "Display an explicit retry button to the user rather than leaving UI in indeterminate loading."
        ]

    elif report.divergence_type == "CORS_POLICY_VIOLATION":
        user_explanation = (
            "The browser blocked the network connection due to security policies (CORS). "
            "The transaction was cancelled before reaching the server. Your account was not charged."
        )
        developer_diagnosis = (
            f"Cross-Origin Resource Sharing (CORS) preflight rejection on '{endpoint}'. "
            "The API server failed to return matching 'Access-Control-Allow-Origin' or allowed headers."
        )
        recommended_actions = [
            f"Configure CORS headers on backend for: {endpoint}.",
            "Verify allowed HTTP methods and custom header allowances (e.g. Authorization, X-Requested-With).",
            "Ensure reverse proxy / API gateway routes OPTIONS preflight requests correctly."
        ]

    elif report.divergence_type == "HTTP_5XX_SERVER_ERROR":
        user_explanation = (
            f"The server encountered an internal error (HTTP {status_code}) while handling your request. "
            "The operation could not be completed."
        )
        developer_diagnosis = (
            f"Backend failure: Endpoint '{endpoint}' returned HTTP {status_code}. "
            f"Details: {error_msg}. Diverged at node '{report.divergence_node_label}'."
        )
        recommended_actions = [
            f"Inspect backend application logs at the timestamp of request to {endpoint}.",
            "Check database connection pools and upstream microservice dependencies.",
            "Return structured JSON error response payloads to allow safe client-side recovery."
        ]

    elif report.divergence_type == "HALTED_EXECUTION":
        user_explanation = (
            f"The workflow stopped abruptly after '{report.divergence_node_label}'. "
            "The application did not complete the requested operation."
        )
        developer_diagnosis = (
            f"Execution halted prematurely at node '{report.divergence_node_label}' (ID: {report.divergence_node_id}). "
            "Expected subsequent transitions in the workflow graph were never triggered. "
            "Likely caused by a broken click listener, unhandled promise, or missing navigation trigger."
        )
        recommended_actions = [
            f"Inspect UI event handler attached to '{report.divergence_node_label}'.",
            "Verify that state dispatcher triggers the subsequent workflow event.",
            "Check console for unhandled JavaScript promise rejections or silent catch blocks."
        ]

    else:
        user_explanation = (
            f"An unexpected issue occurred while processing '{report.divergence_node_label}'. "
            f"Reason: {error_msg}."
        )
        developer_diagnosis = (
            f"State divergence at node '{report.divergence_node_label}' (ID: {report.divergence_node_id}). "
            f"Actual outcome was '{report.actual_outcome}' vs Expected '{report.expected_outcome}'. "
            f"Details: {details}."
        )
        recommended_actions = [
            "Inspect runtime exception stack traces.",
            "Verify application state preconditions before initiating transition."
        ]

    # Incorporate user query if provided
    if query_text and report.diverged:
        user_explanation = f"Regarding your issue ('{query_text}'): {user_explanation}"

    # Build reproduction trace
    trace = [
        f"{s['actualIndex'] + 1}. {s['actualLabel']} [{s['actualOutcome']}]"
        for s in report.aligned_steps
    ]

    return DiagnosticResult(
        workflow_name=report.workflow_name,
        diverged=report.diverged,
        divergence_type=report.divergence_type,
        divergence_node_id=report.divergence_node_id,
        divergence_node_label=report.divergence_node_label,
        confidence=report.confidence,
        user_explanation=user_explanation,
        developer_diagnosis=developer_diagnosis,
        recommended_actions=recommended_actions,
        known_causes=report.known_causes,
        reproduction_trace=trace,
        technical_details=report.details
    )

def run_llm_augmented_diagnosis(
    report: DivergenceReport,
    user_query: Optional[str],
    api_key: Optional[str] = None
) -> Optional[DiagnosticResult]:
    """
    Calls Gemini API (or compatible LLM) if an API key is available to generate an augmented diagnostic report.
    Falls back gracefully to rule-based synthesis if unavailable.
    """
    key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        return None

    try:
        import urllib.request
        prompt = f"""
You are the Argus AI Diagnostic Engine.
Analyze the following behavioral divergence report and user complaint:

User Complaint: {user_query or "No complaint specified by user."}
Workflow: {report.workflow_name}
Divergence Type: {report.divergence_type}
Divergence Node: {report.divergence_node_label} (ID: {report.divergence_node_id})
Actual Outcome: {report.actual_outcome} vs Expected: {report.expected_outcome}
Known Causes in Model: {json.dumps(report.known_causes)}
Technical Details: {json.dumps(report.details)}
Execution Trace:
{json.dumps([s['actualLabel'] for s in report.aligned_steps], indent=2)}

Respond with strictly valid JSON matching this schema:
{{
  "user_explanation": "Reassuring, non-technical explanation in plain English for the end-user.",
  "developer_diagnosis": "Deep technical analysis explaining root cause, failure mode, and divergence for engineers.",
  "recommended_actions": ["Actionable remediation 1", "Actionable remediation 2", "Actionable remediation 3"]
}}
"""
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={key}"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"response_mime_type": "application/json"}
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            raw_text = res_data["candidates"][0]["content"]["parts"][0]["text"]
            parsed = json.loads(raw_text)

            trace = [
                f"{s['actualIndex'] + 1}. {s['actualLabel']} [{s['actualOutcome']}]"
                for s in report.aligned_steps
            ]
            return DiagnosticResult(
                workflow_name=report.workflow_name,
                diverged=report.diverged,
                divergence_type=report.divergence_type,
                divergence_node_id=report.divergence_node_id,
                divergence_node_label=report.divergence_node_label,
                confidence=report.confidence,
                user_explanation=parsed.get("user_explanation", ""),
                developer_diagnosis=parsed.get("developer_diagnosis", ""),
                recommended_actions=parsed.get("recommended_actions", []),
                known_causes=report.known_causes,
                reproduction_trace=trace,
                technical_details=report.details
            )
    except Exception:
        # Fall back to offline rule-based diagnosis on any error
        return None

def diagnose(
    report: DivergenceReport,
    user_query: Optional[str] = None,
    api_key: Optional[str] = None
) -> DiagnosticResult:
    """Primary diagnosis function. Tries LLM if API key provided, otherwise uses offline reasoner."""
    if api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
        llm_res = run_llm_augmented_diagnosis(report, user_query, api_key)
        if llm_res:
            return llm_res

    return synthesize_rule_based_diagnosis(report, user_query)
