"""
Argus APK Graph Synthesizer

Synthesizes an Argus Expected Behavioral Graph (expected_graph.json)
from black-box APK analysis results (manifest activities, launcher, DEX string pool endpoints,
buttons, state tokens, and exception signatures).
"""

import re
from typing import Dict, Any, List, Optional
from manifest_parser import ManifestData
from dex_parser import DexAnalysisResult

def simplify_class_name(full_name: str) -> str:
    """Extracts short class name, e.g. com.example.demo.MainActivity -> MainActivity"""
    return full_name.split(".")[-1] if "." in full_name else full_name

def synthesize_android_graph(
    manifest: ManifestData,
    dex: DexAnalysisResult,
    app_version: Optional[str] = None,
    workflow_name_override: Optional[str] = None
) -> Dict[str, Any]:
    """
    Transforms extracted manifest and DEX signals into an Argus Expected Behavioral Graph.
    """
    pkg = manifest.package_name or "com.application"
    version = app_version or manifest.version_name or "1.0.0"

    # Identify primary activities
    launcher_act = manifest.launcher_activity or (manifest.activities[0]["name"] if manifest.activities else "MainActivity")
    launcher_simple = simplify_class_name(launcher_act)

    secondary_acts = [a["name"] for a in manifest.activities if a["name"] != launcher_act]
    secondary_act = secondary_acts[0] if secondary_acts else None
    secondary_simple = simplify_class_name(secondary_act) if secondary_act else None

    # Determine workflow identity
    if workflow_name_override:
        workflow_name = workflow_name_override
    elif secondary_simple and "Email" in secondary_simple:
        workflow_name = "SendEmailWithAttachment"
    elif secondary_simple and any(k in secondary_simple for k in ["Checkout", "Payment", "Order"]):
        workflow_name = "ECommerceCheckout"
    elif secondary_simple and any(k in secondary_simple for k in ["Auth", "Login", "SignIn"]):
        workflow_name = "UserAuthentication"
    elif secondary_simple:
        workflow_name = f"{secondary_simple.replace('Activity', '')}Workflow"
    else:
        workflow_name = f"{launcher_simple.replace('Activity', '')}Workflow"

    workflow_id = f"wf_{re.sub(r'[^a-zA-Z0-9_]', '', workflow_name.lower())}"

    # Pick best action buttons
    # 1. Navigation button (e.g. TapComposeEmail, btnComposeEmail)
    nav_button_label = "TapOpen"
    if secondary_simple:
        short_sub = secondary_simple.replace("Activity", "")
        for btn in dex.buttons:
            if short_sub.lower() in btn.lower():
                nav_button_label = btn
                break
        if nav_button_label == "TapOpen":
            nav_button_label = f"Tap{short_sub}"

    # 2. Submit button (e.g. TapSendEmail, btnSend, btnPay, btnSubmit)
    submit_button_label = "TapSubmit"
    for btn in dex.buttons:
        if any(act in btn.lower() for act in ["send", "pay", "submit", "confirm", "upload", "checkout"]):
            submit_button_label = btn
            break

    # Pick best endpoint
    primary_endpoint = "/api/upload"
    for ep in dex.endpoints:
        if not ep.endswith("://") and any(k in ep.lower() for k in ["upload", "charge", "send", "submit", "order"]):
            primary_endpoint = ep
            break
    if primary_endpoint == "/api/upload" and dex.endpoints:
        # Pick first valid relative endpoint
        for ep in dex.endpoints:
            if not ep.endswith("://"):
                primary_endpoint = ep
                break

    # Pick state tokens
    processing_state = "Uploading"
    for st in dex.state_tokens:
        if any(k in st.lower() for k in ["uploading", "processing", "loading", "submitting"]):
            processing_state = st
            break

    success_state = "EmailSent" if "email" in workflow_name.lower() else "Completed"
    for st in dex.state_tokens:
        if any(k in st.lower() for k in ["sent", "confirmed", "success", "completed", "done"]):
            success_state = st
            break

    failure_state = "UploadFailed" if "email" in workflow_name.lower() else "OperationFailed"
    for st in dex.state_tokens:
        if any(k in st.lower() for k in ["failed", "error", "rejected"]):
            failure_state = st
            break

    # Nodes Construction
    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []

    # 1. SessionStart
    n_session_start = {
        "id": "n_session_start",
        "type": "SESSION_START",
        "label": "SessionStart",
        "expectedOutcome": "SUCCESS",
        "description": "Application process started. Argus Android Diagnostic SDK initialized.",
        "expectedMetadata": {
            "appVersion": version,
            "packageName": pkg,
            "platform": "android"
        }
    }
    nodes.append(n_session_start)

    # 2. Main / Launcher Activity
    n_screen_main = {
        "id": "n_screen_main",
        "type": "SCREEN_VIEW",
        "label": f"Screen:{launcher_simple}",
        "expectedOutcome": "SUCCESS",
        "description": f"User is on the {launcher_simple} screen.",
        "expectedMetadata": {
            "activityClass": launcher_act,
            "isLauncher": True
        }
    }
    nodes.append(n_screen_main)
    edges.append({"fromId": "n_session_start", "toId": "n_screen_main", "label": "navigated_to"})

    prev_node_id = "n_screen_main"

    # 3. If secondary activity exists, add transition user action & screen
    if secondary_act:
        n_nav_action = {
            "id": "n_action_nav",
            "type": "USER_ACTION",
            "label": nav_button_label,
            "expectedOutcome": "SUCCESS",
            "description": f"User taps {nav_button_label} to transition to {secondary_simple}."
        }
        nodes.append(n_nav_action)
        edges.append({"fromId": prev_node_id, "toId": "n_action_nav", "label": "user_triggered"})

        n_screen_sub = {
            "id": "n_screen_sub",
            "type": "SCREEN_VIEW",
            "label": f"Screen:{secondary_simple}",
            "expectedOutcome": "SUCCESS",
            "description": f"User is on the {secondary_simple} screen.",
            "expectedMetadata": {
                "activityClass": secondary_act
            }
        }
        nodes.append(n_screen_sub)
        edges.append({"fromId": "n_action_nav", "toId": "n_screen_sub", "label": "navigated_to"})
        prev_node_id = "n_screen_sub"

    # 4. Action to trigger workflow
    n_submit_action = {
        "id": "n_action_submit",
        "type": "USER_ACTION",
        "label": submit_button_label,
        "expectedOutcome": "SUCCESS",
        "description": f"User interacts with {submit_button_label} to initiate workflow."
    }
    nodes.append(n_submit_action)
    edges.append({"fromId": prev_node_id, "toId": "n_action_submit", "label": "user_triggered"})

    # 5. State change: Processing / Uploading
    n_state_processing = {
        "id": "n_state_processing",
        "type": "STATE_CHANGE",
        "label": f"StateChange:{processing_state}",
        "expectedOutcome": "SUCCESS",
        "description": f"Application enters {processing_state} state."
    }
    nodes.append(n_state_processing)
    edges.append({"fromId": "n_action_submit", "toId": "n_state_processing", "label": "state_changed"})

    # 6. API Call
    n_api_call = {
        "id": "n_api_call",
        "type": "API_CALL",
        "label": f"ApiCall:{primary_endpoint}",
        "expectedOutcome": "SUCCESS",
        "description": f"Outbound HTTP request to {primary_endpoint}.",
        "expectedMetadata": {
            "endpoint": primary_endpoint,
            "method": "POST"
        }
    }
    nodes.append(n_api_call)
    edges.append({"fromId": "n_state_processing", "toId": "n_api_call", "label": "api_initiated"})

    # 7. Happy Path: API Result SUCCESS
    n_api_success = {
        "id": "n_api_result_success",
        "type": "API_RESULT",
        "label": "ApiResult:SUCCESS",
        "expectedOutcome": "SUCCESS",
        "description": "Server returned HTTP 200 OK successfully.",
        "expectedMetadata": {
            "statusCode": 200
        }
    }
    nodes.append(n_api_success)
    edges.append({"fromId": "n_api_call", "toId": "n_api_result_success", "label": "api_responded"})

    # 8. Terminal Happy State
    n_terminal_success = {
        "id": "n_terminal_success",
        "type": "STATE_CHANGE",
        "label": f"StateChange:{success_state}",
        "expectedOutcome": "SUCCESS",
        "description": f"Workflow completed successfully ({success_state})."
    }
    nodes.append(n_terminal_success)
    edges.append({"fromId": "n_api_result_success", "toId": "n_terminal_success", "label": "state_changed"})

    # 9. Failure Path 1: Timeout (SocketTimeoutException)
    n_api_timeout = {
        "id": "n_api_result_timeout",
        "type": "API_RESULT",
        "label": "ApiResult:TIMEOUT",
        "expectedOutcome": "TIMEOUT",
        "description": "SocketTimeoutException: Network connection or read headers timed out.",
        "expectedMetadata": {
            "exception": "java.net.SocketTimeoutException",
            "timeoutMs": 10000
        }
    }
    nodes.append(n_api_timeout)
    edges.append({"fromId": "n_api_call", "toId": "n_api_result_timeout", "label": "timeout_occurred"})

    # 10. Terminal Timeout State
    n_terminal_timeout = {
        "id": "n_terminal_timeout",
        "type": "STATE_CHANGE",
        "label": f"StateChange:{failure_state}",
        "expectedOutcome": "FAILURE",
        "description": f"Workflow ended in failure due to network timeout ({failure_state})."
    }
    nodes.append(n_terminal_timeout)
    edges.append({"fromId": "n_api_result_timeout", "toId": "n_terminal_timeout", "label": "state_changed"})

    # 11. Failure Path 2: HTTP Error / Network Failure
    n_api_error = {
        "id": "n_api_result_error",
        "type": "API_RESULT",
        "label": "ApiResult:HTTP_ERROR",
        "expectedOutcome": "FAILURE",
        "description": "Server responded with HTTP 500 Internal Server Error or connectivity dropped.",
        "expectedMetadata": {
            "statusCode": 500
        }
    }
    nodes.append(n_api_error)
    edges.append({"fromId": "n_api_call", "toId": "n_api_result_error", "label": "api_responded"})

    n_terminal_error = {
        "id": "n_terminal_error",
        "type": "STATE_CHANGE",
        "label": "StateChange:ErrorOccurred",
        "expectedOutcome": "FAILURE",
        "description": "Workflow failed due to server error or network exception."
    }
    nodes.append(n_terminal_error)
    edges.append({"fromId": "n_api_result_error", "toId": "n_terminal_error", "label": "state_changed"})

    # Paths Definition
    happy_node_ids = [
        "n_session_start", "n_screen_main"
    ]
    if secondary_act:
        happy_node_ids.extend(["n_action_nav", "n_screen_sub"])
    happy_node_ids.extend([
        "n_action_submit", "n_state_processing", "n_api_call", "n_api_result_success", "n_terminal_success"
    ])

    timeout_node_ids = [
        "n_session_start", "n_screen_main"
    ]
    if secondary_act:
        timeout_node_ids.extend(["n_action_nav", "n_screen_sub"])
    timeout_node_ids.extend([
        "n_action_submit", "n_state_processing", "n_api_call", "n_api_result_timeout", "n_terminal_timeout"
    ])

    error_node_ids = [
        "n_session_start", "n_screen_main"
    ]
    if secondary_act:
        error_node_ids.extend(["n_action_nav", "n_screen_sub"])
    error_node_ids.extend([
        "n_action_submit", "n_state_processing", "n_api_call", "n_api_result_error", "n_terminal_error"
    ])

    paths = {
        "happy_path": {
            "name": "Happy Path",
            "nodeIds": happy_node_ids,
            "description": f"Standard uninterrupted user journey through {workflow_name}."
        },
        "timeout_failure_path": {
            "name": "Network Timeout Failure",
            "nodeIds": timeout_node_ids,
            "divergesFromHappyPathAt": "n_api_call",
            "isKnownFailureMode": True,
            "knownCauses": [
                "Server response headers delayed beyond OkHttp client timeout threshold",
                "Mobile cellular latency or carrier socket drop during large payload upload",
                "Backend gateway proxy timed out before upstream service replied"
            ]
        },
        "http_error_path": {
            "name": "HTTP 500 Server Error",
            "nodeIds": error_node_ids,
            "divergesFromHappyPathAt": "n_api_call",
            "isKnownFailureMode": True,
            "knownCauses": [
                "Backend service threw uncaught exception during request processing",
                "Payload size exceeded server maximum limits (HTTP 413)",
                "Authentication token expired or rejected by remote API"
            ]
        }
    }

    return {
        "schemaVersion": "1.0",
        "appVersion": version,
        "platform": "android",
        "apkPackage": pkg,
        "description": f"Argus black-box behavioral graph reconstructed from APK: {pkg} (v{version})",
        "workflows": [
            {
                "id": workflow_id,
                "name": workflow_name,
                "description": f"Black-box reconstructed workflow for {manifest.app_label or pkg}",
                "entryNode": "n_session_start",
                "terminalNodes": ["n_terminal_success", "n_terminal_timeout", "n_terminal_error"],
                "nodes": nodes,
                "edges": edges,
                "paths": paths
            }
        ]
    }
