"""
Argus Graph Divergence Comparator

Performs deterministic topological and chronological alignment between an Expected Behavioral Graph
(expected_graph.json) and an observed Runtime Execution Graph (execution_graph.json).

Identifies:
1. Exact divergence node and transition
2. Divergence classification (TIMEOUT, HTTP_ERROR, LATENCY_ANOMALY, MISSING_STEP, EXCEPTION)
3. Matched failure path & known root causes from the behavioral model
4. Alignment timeline
"""

from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional, Tuple

@dataclass
class DivergenceReport:
    workflow_id: str = ""
    workflow_name: str = ""
    diverged: bool = False
    divergence_type: str = "NONE"  # TIMEOUT, HTTP_ERROR, STATUS_MISMATCH, LATENCY_ANOMALY, MISSING_STEP, EXCEPTION, HALTED
    divergence_node_id: Optional[str] = None
    divergence_node_label: Optional[str] = None
    divergence_node_type: Optional[str] = None
    actual_node_id: Optional[str] = None
    actual_node_label: Optional[str] = None
    expected_outcome: str = "SUCCESS"
    actual_outcome: str = "SUCCESS"
    matched_failure_path: Optional[str] = None
    confidence: float = 0.0
    known_causes: List[str] = field(default_factory=list)
    aligned_steps: List[Dict[str, Any]] = field(default_factory=list)
    diagnostics_summary: str = ""
    details: Dict[str, Any] = field(default_factory=dict)

def normalize_label(label: str) -> str:
    """Normalizes labels for loose comparison (e.g. ApiCall:/api/v1/charge?token=... -> ApiCall:/api/v1/charge)"""
    if "?" in label:
        label = label.split("?")[0]
    return label.strip().lower()

def match_node(expected_node: Dict[str, Any], actual_node: Dict[str, Any]) -> bool:
    """Checks if an actual execution node corresponds to an expected node."""
    if expected_node.get("type") != actual_node.get("type"):
        return False

    exp_label = normalize_label(expected_node.get("label", ""))
    act_label = normalize_label(actual_node.get("label", ""))

    # Exact or prefix match
    if exp_label == act_label or exp_label in act_label or act_label in exp_label:
        return True

    # Type-specific matching
    node_type = expected_node.get("type")
    exp_meta = expected_node.get("expectedMetadata", {})
    act_meta = actual_node.get("metadata", {})

    if node_type == "SCREEN_VIEW":
        exp_cls = exp_meta.get("activityClass") or exp_meta.get("screen")
        act_cls = act_meta.get("activityClass") or act_meta.get("screen")
        if exp_cls and act_cls and (exp_cls == act_cls or exp_cls.endswith(act_cls) or act_cls.endswith(exp_cls)):
            return True

    if node_type == "API_CALL":
        exp_end = exp_meta.get("endpoint")
        act_end = act_meta.get("endpoint") or act_meta.get("url")
        if exp_end and act_end and (exp_end in act_end):
            return True

    return False

def compare_graphs(expected_graph: Dict[str, Any], actual_graph: Dict[str, Any]) -> DivergenceReport:
    """
    Compares expected behavioral graph against observed runtime execution graph.
    """
    report = DivergenceReport()

    workflows = expected_graph.get("workflows", [])
    if not workflows:
        report.diagnostics_summary = "Error: Expected graph contains no workflows."
        return report

    actual_nodes = actual_graph.get("nodes", [])
    if not actual_nodes:
        report.diverged = True
        report.divergence_type = "EMPTY_TRACE"
        report.diagnostics_summary = "Execution trace contains no recorded events."
        return report

    # 1. Select the relevant workflow
    workflow = workflows[0]
    report.workflow_id = workflow.get("id", "wf_unknown")
    report.workflow_name = workflow.get("name", "Unknown Workflow")

    expected_nodes_map = {n["id"]: n for n in workflow.get("nodes", [])}
    paths = workflow.get("paths", {})
    happy_path_def = paths.get("happy_path", {})
    happy_node_ids = (
        happy_path_def.get("nodeIds")
        or happy_path_def.get("sequence")
        or [n["id"] for n in workflow.get("nodes", [])]
    )
    happy_node_set = set(happy_node_ids)

    aligned_steps = []
    exp_idx = 0
    divergence_found = False
    last_happy_node_id: Optional[str] = happy_node_ids[0] if happy_node_ids else None

    for act_idx, act_node in enumerate(actual_nodes):
        matched_exp_id: Optional[str] = None
        matched_exp_node: Optional[Dict[str, Any]] = None

        # 1. First look ahead in the happy path
        for lookahead in range(exp_idx, min(exp_idx + 3, len(happy_node_ids))):
            cand_id = happy_node_ids[lookahead]
            cand_node = expected_nodes_map.get(cand_id)
            if cand_node and match_node(cand_node, act_node):
                matched_exp_id = cand_id
                matched_exp_node = cand_node
                exp_idx = lookahead + 1
                last_happy_node_id = cand_id
                break

        # 2. If not matched on happy path, search all workflow nodes (to catch known failure nodes)
        if not matched_exp_id:
            for cand_id, cand_node in expected_nodes_map.items():
                if match_node(cand_node, act_node):
                    matched_exp_id = cand_id
                    matched_exp_node = cand_node
                    break

        act_outcome = act_node.get("outcome", "SUCCESS").upper()
        is_on_happy = matched_exp_id in happy_node_set if matched_exp_id else True

        step_record = {
            "actualIndex": act_idx,
            "actualNodeId": act_node.get("id"),
            "actualLabel": act_node.get("label"),
            "actualType": act_node.get("type"),
            "actualOutcome": act_outcome,
            "expectedNodeId": matched_exp_id,
            "expectedLabel": matched_exp_node.get("label") if matched_exp_node else None,
            "isOnHappyPath": is_on_happy,
            "status": "ALIGNED" if (matched_exp_id and is_on_happy) else ("FAILURE_BRANCH" if (matched_exp_id and not is_on_happy) else "UNEXPECTED")
        }

        # 3. Detect divergence
        if not divergence_found and (act_outcome in ["TIMEOUT", "FAILURE"] or act_node.get("type") == "ERROR" or (matched_exp_id and not is_on_happy)):
            divergence_found = True
            report.diverged = True
            report.actual_node_id = act_node.get("id")
            report.actual_node_label = act_node.get("label")
            report.actual_outcome = act_outcome

            # The divergence node in the expected model is the last aligned happy path node
            report.divergence_node_id = last_happy_node_id
            last_happy_node = expected_nodes_map.get(last_happy_node_id, {})
            report.divergence_node_label = last_happy_node.get("label")
            report.divergence_node_type = last_happy_node.get("type")

            # Classify divergence type
            meta = act_node.get("metadata", {})
            if act_outcome == "TIMEOUT" or "timeout" in act_node.get("label", "").lower() or "timeout" in str(meta).lower():
                report.divergence_type = "TIMEOUT"
            elif act_node.get("type") == "ERROR" or "exception" in str(meta).lower():
                report.divergence_type = "EXCEPTION"
            elif "cors" in str(meta).lower():
                report.divergence_type = "CORS_POLICY_VIOLATION"
            elif meta.get("statusCode") and meta.get("statusCode") >= 500:
                report.divergence_type = "HTTP_5XX_SERVER_ERROR"
            elif meta.get("statusCode") and meta.get("statusCode") >= 400:
                report.divergence_type = "HTTP_4XX_CLIENT_ERROR"
            else:
                report.divergence_type = "STATE_FAILURE"

            report.details = {
                "statusCode": meta.get("statusCode"),
                "durationMs": meta.get("durationMs"),
                "error": meta.get("error") or meta.get("message") or meta.get("errorMessage"),
                "endpoint": meta.get("endpoint") or meta.get("url")
            }

        aligned_steps.append(step_record)

    report.aligned_steps = aligned_steps

    # 4. Check for premature halt (execution stopped before terminal state)
    if not report.diverged:
        terminal_nodes = workflow.get("terminalNodes", [])
        last_step = aligned_steps[-1] if aligned_steps else {}
        last_matched_exp = last_step.get("expectedNodeId")

        if last_matched_exp not in terminal_nodes:
            report.diverged = True
            report.divergence_type = "HALTED_EXECUTION"
            report.divergence_node_id = last_matched_exp
            report.divergence_node_label = last_step.get("expectedLabel")
            report.divergence_node_type = last_step.get("actualType")
            report.actual_node_id = last_step.get("actualNodeId")
            report.actual_node_label = last_step.get("actualLabel")
            report.details = {
                "message": f"Execution halted at {last_step.get('actualLabel')} before reaching expected terminal completion."
            }

    # 5. Match against Known Failure Modes in the Expected Graph
    if report.diverged:
        best_match_path = None
        best_confidence = 0.0

        for path_key, path_info in paths.items():
            if path_key == "happy_path":
                continue

            div_at = path_info.get("divergesFromHappyPathAt")
            if div_at and (div_at == report.divergence_node_id or div_at in str(report.divergence_node_id)):
                confidence = 0.85
                if report.divergence_type == "TIMEOUT" and "timeout" in path_key.lower():
                    confidence = 0.98
                elif "cors" in report.divergence_type.lower() and "cors" in path_key.lower():
                    confidence = 0.98
                elif "error" in report.divergence_type.lower() and ("error" in path_key.lower() or "500" in path_key):
                    confidence = 0.95

                if confidence > best_confidence:
                    best_confidence = confidence
                    best_match_path = path_key
                    # Retrieve known causes from path
                    causes = list(path_info.get("knownCauses", []))
                    # Also collect known causes from nodes in this failure path
                    path_seq = path_info.get("nodeIds") or path_info.get("sequence") or []
                    for nid in path_seq:
                        node_causes = expected_nodes_map.get(nid, {}).get("knownCauses", [])
                        for c in node_causes:
                            if c not in causes:
                                causes.append(c)
                    report.known_causes = causes

        report.matched_failure_path = best_match_path
        report.confidence = best_confidence if best_match_path else 0.70

    # 6. Build Diagnostic Summary
    if report.diverged:
        report.diagnostics_summary = (
            f"Divergence detected at '{report.divergence_node_label}' (ID: {report.divergence_node_id}) "
            f"due to {report.divergence_type}. "
            f"Actual outcome was '{report.actual_outcome}' vs Expected '{report.expected_outcome}'."
        )
    else:
        report.diagnostics_summary = "Execution strictly adhered to Expected Happy Path with zero divergences."
        report.confidence = 1.0

    return report
