"""
AppSleuth Web Graph Synthesizer

Transforms black-box crawled web entities (DOM elements, buttons, forms, endpoints)
into a structured AppSleuth Expected Behavioral Graph conforming to the core schema.
"""

from typing import Dict, Any, List
from html_analyzer import WebPageAnalysis

def synthesize_web_graph(analysis: WebPageAnalysis, app_version: str = "1.0.0") -> Dict[str, Any]:
    workflow_name = analysis.detected_workflow
    workflow_id = f"wf_{workflow_name.lower()}"
    page_path = analysis.path or "/"

    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []

    # 1. Entry node: SessionStart
    n_session_start = {
        "id": "n_session_start",
        "type": "SESSION_START",
        "label": "SessionStart",
        "expectedOutcome": "SUCCESS",
        "description": "User loaded the web application. AppSleuth Web SDK initialized."
    }
    nodes.append(n_session_start)

    # 2. PageView node
    clean_path = page_path if page_path.startswith("/") else f"/{page_path}"
    n_page_view = {
        "id": "n_page_view",
        "type": "PAGE_VIEW",
        "label": f"PageView:{clean_path}",
        "expectedOutcome": "SUCCESS",
        "description": f"Page rendered: {analysis.title}",
        "expectedMetadata": {
            "path": clean_path,
            "title": analysis.title,
            "url": analysis.url
        }
    }
    nodes.append(n_page_view)
    edges.append({
        "from": "n_session_start",
        "to": "n_page_view",
        "label": "navigated_to",
        "path": "all"
    })

    # 3. Primary User Action (Button click)
    primary_btn = _select_primary_action(analysis.buttons, workflow_name)
    btn_label = primary_btn["label"] if primary_btn else "SubmitAction"
    btn_id = f"n_action_{_slugify(btn_label)}"

    n_user_action = {
        "id": btn_id,
        "type": "USER_ACTION",
        "label": f"Click:{btn_label}",
        "expectedOutcome": "SUCCESS",
        "description": f"User clicked '{btn_label}' to trigger the workflow action."
    }
    nodes.append(n_user_action)
    edges.append({
        "from": "n_page_view",
        "to": btn_id,
        "label": "user_triggered",
        "path": "all"
    })

    # 4. Processing State Change
    state_label = _get_processing_state_label(workflow_name)
    n_processing = {
        "id": "n_state_processing",
        "type": "STATE_CHANGE",
        "label": f"StateChange:{state_label}",
        "expectedOutcome": "PENDING",
        "description": f"Application enters '{state_label}' loading state.",
        "expectedMetadata": {
            "uiState": "loading"
        }
    }
    nodes.append(n_processing)
    edges.append({
        "from": btn_id,
        "to": "n_state_processing",
        "label": "state_changed",
        "path": "all"
    })

    # 5. Outbound API Call
    endpoint = analysis.api_endpoints[0] if analysis.api_endpoints else {"method": "POST", "path": f"/api/{_slugify(workflow_name)}"}
    endpoint_path = endpoint["path"]
    method = endpoint.get("method", "POST")

    n_api_call = {
        "id": "n_api_call",
        "type": "API_CALL",
        "label": f"ApiCall:{endpoint_path}",
        "expectedOutcome": "PENDING",
        "description": f"HTTP {method} to {endpoint_path} initiated.",
        "expectedMetadata": {
            "method": method,
            "endpoint": endpoint_path
        },
        "constraints": {
            "timeoutThresholdMs": 8000
        }
    }
    nodes.append(n_api_call)
    edges.append({
        "from": "n_state_processing",
        "to": "n_api_call",
        "label": "api_initiated",
        "path": "all"
    })

    # 6. Happy Path API Result (200 OK)
    n_api_success = {
        "id": "n_api_result_success",
        "type": "API_RESULT",
        "label": f"ApiResult:200:{endpoint_path}",
        "expectedOutcome": "SUCCESS",
        "description": f"Endpoint returned HTTP 200 OK response.",
        "expectedMetadata": {
            "httpCode": 200,
            "success": True
        },
        "happyPath": True
    }
    nodes.append(n_api_success)
    edges.append({
        "from": "n_api_call",
        "to": "n_api_result_success",
        "label": "api_responded",
        "path": "happy_path"
    })

    # 7. Completed Terminal State
    completed_state = _get_completed_state_label(workflow_name)
    n_completed = {
        "id": "n_state_completed",
        "type": "STATE_CHANGE",
        "label": f"StateChange:{completed_state}",
        "expectedOutcome": "SUCCESS",
        "description": f"Workflow successfully completed: {completed_state}.",
        "isTerminal": True,
        "happyPath": True
    }
    nodes.append(n_completed)
    edges.append({
        "from": "n_api_result_success",
        "to": "n_state_completed",
        "label": "state_changed",
        "path": "happy_path"
    })

    # 8. Known Failure Mode: Timeout
    n_api_timeout = {
        "id": "n_api_result_timeout",
        "type": "API_RESULT",
        "label": f"ApiResult:TIMEOUT:{endpoint_path}",
        "expectedOutcome": "TIMEOUT",
        "description": f"Network call to {endpoint_path} timed out after threshold elapsed.",
        "isKnownFailureMode": True,
        "knownCauses": [
            "Server backend high latency or overload",
            "Client connection dropped during request",
            "Gateway timeout (504 Gateway Timeout)"
        ]
    }
    nodes.append(n_api_timeout)
    edges.append({
        "from": "n_api_call",
        "to": "n_api_result_timeout",
        "label": "api_responded",
        "path": "timeout_failure_path"
    })

    n_state_timeout = {
        "id": "n_state_failed_timeout",
        "type": "STATE_CHANGE",
        "label": f"StateChange:{workflow_name}Failed",
        "expectedOutcome": "TIMEOUT",
        "description": "Workflow failed due to network timeout. UI displays error alert.",
        "isTerminal": True,
        "isKnownFailureMode": True
    }
    nodes.append(n_state_timeout)
    edges.append({
        "from": "n_api_result_timeout",
        "to": "n_state_failed_timeout",
        "label": "state_changed",
        "path": "timeout_failure_path"
    })

    # 9. Known Failure Mode: CORS / Network Error
    n_api_cors = {
        "id": "n_api_result_cors",
        "type": "API_RESULT",
        "label": f"ApiResult:FAILED:{endpoint_path}",
        "expectedOutcome": "FAILURE",
        "description": f"Browser blocked request to {endpoint_path} or connection refused.",
        "isKnownFailureMode": True,
        "knownCauses": [
            "Browser CORS preflight check failed",
            "Adblocker or content filter blocked request",
            "SSL/TLS certificate error or mixed content restriction"
        ]
    }
    nodes.append(n_api_cors)
    edges.append({
        "from": "n_api_call",
        "to": "n_api_result_cors",
        "label": "api_responded",
        "path": "cors_error_path"
    })

    n_state_cors = {
        "id": "n_state_failed_cors",
        "type": "STATE_CHANGE",
        "label": "StateChange:NetworkError",
        "expectedOutcome": "FAILURE",
        "description": "Workflow failed due to client CORS or network failure.",
        "isTerminal": True,
        "isKnownFailureMode": True
    }
    nodes.append(n_state_cors)
    edges.append({
        "from": "n_api_result_cors",
        "to": "n_state_failed_cors",
        "label": "state_changed",
        "path": "cors_error_path"
    })

    # Paths definitions
    terminal_nodes = ["n_state_completed", "n_state_failed_timeout", "n_state_failed_cors"]

    paths = {
        "happy_path": {
            "description": f"Normal successful completion of {workflow_name}",
            "sequence": [
                "n_session_start",
                "n_page_view",
                btn_id,
                "n_state_processing",
                "n_api_call",
                "n_api_result_success",
                "n_state_completed"
            ]
        },
        "timeout_failure_path": {
            "description": f"{workflow_name} times out on network call",
            "divergesFromHappyPathAt": "n_api_call",
            "sequence": [
                "n_session_start",
                "n_page_view",
                btn_id,
                "n_state_processing",
                "n_api_call",
                "n_api_result_timeout",
                "n_state_failed_timeout"
            ]
        },
        "cors_error_path": {
            "description": f"{workflow_name} blocked by CORS or network failure",
            "divergesFromHappyPathAt": "n_api_call",
            "sequence": [
                "n_session_start",
                "n_page_view",
                btn_id,
                "n_state_processing",
                "n_api_call",
                "n_api_result_cors",
                "n_state_failed_cors"
            ]
        }
    }

    return {
        "schemaVersion": "1.0",
        "appVersion": app_version,
        "platform": "web",
        "crawledUrl": analysis.url,
        "description": f"AppSleuth black-box expected behavioral graph synthesized for {analysis.url}",
        "workflows": [
            {
                "id": workflow_id,
                "name": workflow_name,
                "description": f"Synthesized behavioral workflow for {analysis.title}",
                "entryNode": "n_session_start",
                "terminalNodes": terminal_nodes,
                "nodes": nodes,
                "edges": edges,
                "paths": paths
            }
        ]
    }

def _select_primary_action(buttons: List[Dict[str, Any]], workflow: str) -> Dict[str, Any]:
    if not buttons:
        return {"label": "Submit"}

    # Keyword priority
    keywords = ["pay", "checkout", "send", "submit", "login", "sign in", "continue", "order", "buy", "save"]
    for kw in keywords:
        for btn in buttons:
            if kw in btn["label"].lower():
                return btn

    return buttons[0]

def _get_processing_state_label(workflow: str) -> str:
    mapping = {
        "ECommerceCheckout": "ProcessingPayment",
        "UserAuthentication": "AuthenticatingUser",
        "UserRegistration": "RegisteringAccount",
        "SearchAndFilter": "SearchingResults",
        "ContactSubmission": "SubmittingMessage"
    }
    return mapping.get(workflow, "ProcessingAction")

def _get_completed_state_label(workflow: str) -> str:
    mapping = {
        "ECommerceCheckout": "OrderConfirmed",
        "UserAuthentication": "AuthenticationSuccess",
        "UserRegistration": "AccountCreated",
        "SearchAndFilter": "ResultsRendered",
        "ContactSubmission": "MessageDelivered"
    }
    return mapping.get(workflow, "ActionCompleted")

def _slugify(text: str) -> str:
    import re
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_")
    return cleaned.lower() or "action"
