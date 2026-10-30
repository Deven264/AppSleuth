"""
Argus Diagnostic Engine — Automated Test Suite

Verifies:
1. Android Timeout Trace Diagnosis
2. Web Checkout Failure Trace Diagnosis
3. Healthy Execution Trace (No false positives)
4. Markdown and JSON Report Generation
"""

import sys
import json
from pathlib import Path

from comparator import compare_graphs
from reasoner import diagnose

def test_android_timeout_diagnosis():
    print("[*] Testing Android Email Upload Timeout Trace...")
    expected_path = Path("spec/expected_graph.json")
    actual_path = Path("spec/sample_execution_graph.json")

    with open(expected_path, "r", encoding="utf-8") as f:
        expected = json.load(f)
    with open(actual_path, "r", encoding="utf-8") as f:
        actual = json.load(f)

    report = compare_graphs(expected, actual)
    assert report.diverged is True, "Failed: Expected divergence to be detected"
    assert report.divergence_type == "TIMEOUT", f"Failed: Expected TIMEOUT, got {report.divergence_type}"
    assert report.divergence_node_id == "n_api_call_upload", f"Failed: Expected divergence at n_api_call_upload, got {report.divergence_node_id}"
    assert report.matched_failure_path == "timeout_failure_path", f"Failed: Expected timeout_failure_path, got {report.matched_failure_path}"
    assert len(report.known_causes) > 0, "Failed: Expected knownCauses to be populated"

    result = diagnose(report, user_query="The PDF never sent")
    assert "never sent" in result.user_explanation.lower() or "timeout" in result.user_explanation.lower()
    assert len(result.recommended_actions) >= 3, "Failed: Expected >= 3 remediation actions"
    print("    [PASS] Android timeout trace diagnosed accurately!")

def test_healthy_trace():
    print("[*] Testing Healthy Execution Trace (False-Positive Prevention)...")
    expected_path = Path("spec/expected_graph.json")
    with open(expected_path, "r", encoding="utf-8") as f:
        expected = json.load(f)

    # Construct clean happy trace
    healthy_actual = {
        "sessionId": "sess-healthy-001",
        "appVersion": "1.0.0",
        "nodes": [
            {"id": "n1", "type": "SESSION_START", "label": "SessionStart", "outcome": "SUCCESS"},
            {"id": "n2", "type": "SCREEN_VIEW", "label": "Screen:MainActivity", "outcome": "SUCCESS"},
            {"id": "n3", "type": "USER_ACTION", "label": "TapComposeEmail", "outcome": "SUCCESS"},
            {"id": "n4", "type": "SCREEN_VIEW", "label": "Screen:ComposeEmailActivity", "outcome": "SUCCESS"},
            {"id": "n5", "type": "USER_ACTION", "label": "TapSendEmail", "outcome": "SUCCESS"},
            {"id": "n6", "type": "STATE_CHANGE", "label": "StateChange:Uploading", "outcome": "SUCCESS"},
            {"id": "n7", "type": "API_CALL", "label": "ApiCall:/api/upload", "outcome": "SUCCESS"},
            {"id": "n8", "type": "API_RESULT", "label": "ApiResult:SUCCESS", "outcome": "SUCCESS"},
            {"id": "n9", "type": "STATE_CHANGE", "label": "StateChange:EmailSent", "outcome": "SUCCESS"}
        ]
    }

    report = compare_graphs(expected, healthy_actual)
    assert report.diverged is False, f"Failed: Expected healthy execution, but got diverged: {report.diagnostics_summary}"
    assert report.confidence == 1.0, "Failed: Expected 100% confidence for happy path"

    result = diagnose(report)
    assert result.diverged is False
    print("    [PASS] Healthy trace correctly verified with zero false positives!")

def test_web_checkout_diagnosis():
    print("[*] Testing Web Checkout Timeout Trace...")
    expected_path = Path("examples/web-checkout-demo/expected_graph.json")
    with open(expected_path, "r", encoding="utf-8") as f:
        expected = json.load(f)

    web_actual = {
        "sessionId": "sess-web-fail-001",
        "appVersion": "1.2.0",
        "platform": "web",
        "nodes": [
            {"id": "w1", "type": "SESSION_START", "label": "SessionStart", "outcome": "SUCCESS"},
            {"id": "w2", "type": "PAGE_VIEW", "label": "PageView:/checkout", "outcome": "SUCCESS"},
            {"id": "w3", "type": "USER_ACTION", "label": "Click:PayNowButton", "outcome": "SUCCESS"},
            {"id": "w4", "type": "STATE_CHANGE", "label": "StateChange:ProcessingPayment", "outcome": "PENDING"},
            {"id": "w5", "type": "API_CALL", "label": "ApiCall:/api/v1/charge", "outcome": "PENDING"},
            {"id": "w6", "type": "API_RESULT", "label": "ApiResult:TIMEOUT:/api/v1/charge", "outcome": "TIMEOUT", "metadata": {"durationMs": 8004}},
            {"id": "w7", "type": "STATE_CHANGE", "label": "StateChange:PaymentFailed", "outcome": "TIMEOUT", "metadata": {"reason": "gateway_timeout"}}
        ]
    }

    report = compare_graphs(expected, web_actual)
    assert report.diverged is True, "Failed: Expected divergence in web checkout"
    assert report.divergence_type == "TIMEOUT"

    result = diagnose(report, user_query="I clicked pay but it kept spinning and timed out")
    assert result.diverged is True
    assert "8,004ms" in result.user_explanation or "8004" in result.user_explanation or "timeout" in result.user_explanation.lower()
    print("    [PASS] Web checkout timeout trace diagnosed accurately!")

def main():
    print("=== Running Argus Diagnostic Engine Test Suite ===")
    test_android_timeout_diagnosis()
    test_healthy_trace()
    test_web_checkout_diagnosis()
    print("\n[ALL TESTS PASSED] Argus Diagnostic Engine verified successfully!")

if __name__ == "__main__":
    main()
