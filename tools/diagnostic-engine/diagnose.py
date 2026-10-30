#!/usr/bin/env python3
"""
Argus AI Diagnostic Engine — CLI

Accepts an Expected Behavioral Graph (expected_graph.json), an observed Runtime Trace (execution_graph.json),
and an optional user natural language complaint, and outputs an actionable diagnostic report.
"""

import sys
import os
import json
import argparse
from pathlib import Path
from dataclasses import asdict

from comparator import compare_graphs
from reasoner import diagnose, DiagnosticResult

def print_banner():
    banner = r"""
     _                              _    ____  _                               _   _      
    / \   _ __ __ _ _   _ ___      / \  |  _ \(_) __ _  __ _ _ __   ___  ___(_) |_ ___  
   / _ \ | '__/ _` | | | / __|    / _ \ | | | | |/ _` |/ _` | '_ \ / _ \/ __| | __/ _ \ 
  / ___ \| | | (_| | |_| \__ \   / ___ \| |_| | | (_| | (_| | | | | (_) \__ \ | ||  __/ 
 /_/   \_\_|  \__, |\__,_|___/  /_/   \_\____/|_|\__,_|\__, |_| |_|\___/|___/_|\__\___| 
              |___/                                   |___/                             
    Argus: SystemSleuth — Automated Graph Divergence & Root-Cause Diagnosis
    """
    print(banner)

def format_markdown_report(result: DiagnosticResult, expected_path: str, actual_path: str, user_query: str = "") -> str:
    """Formats the diagnosis into a GitHub-style Markdown report."""
    verdict_emoji = "🚨" if result.diverged else "✅"
    verdict_text = f"**DIVERGENCE DETECTED ({result.divergence_type})**" if result.diverged else "**HEALTHY EXECUTION**"

    lines = [
        f"# {verdict_emoji} Argus Diagnostic Report: {result.workflow_name}",
        f"\n**Status:** {verdict_text}  ",
        f"**Confidence:** `{result.confidence * 100:.1f}%`  ",
        f"**Expected Model:** `{expected_path}`  ",
        f"**Observed Trace:** `{actual_path}`  ",
    ]

    if user_query:
        lines.append(f"\n> **User Report:** \"{user_query}\"\n")

    lines.extend([
        "---",
        "\n## 👤 Plain-English Explanation (For End Users)",
        f"\n{result.user_explanation}\n",
        "---",
        "\n## 🛠 Developer Root-Cause Analysis (For Engineers)",
        f"\n{result.developer_diagnosis}\n",
    ])

    if result.diverged:
        lines.append(f"**Divergence Point:** Node `{result.divergence_node_id}` (`{result.divergence_node_label}`)\n")
        if result.known_causes:
            lines.append("### Known Potential Causes (from Behavioral Model):")
            for c in result.known_causes:
                lines.append(f"- {c}")
            lines.append("")

    if result.recommended_actions:
        lines.append("## 💡 Actionable Remediation Steps")
        for act in result.recommended_actions:
            lines.append(f"- [ ] {act}")
        lines.append("")

    lines.extend([
        "## 🧭 Execution Step Trace",
        "```text",
    ])
    for step in result.reproduction_trace:
        is_div = result.divergence_node_label and result.divergence_node_label in step
        marker = " ➔ [DIVERGENCE POINT]" if is_div else ""
        lines.append(f"{step}{marker}")
    lines.append("```\n")

    if result.technical_details:
        lines.extend([
            "## 🔬 Technical Metadata",
            "```json",
            json.dumps(result.technical_details, indent=2),
            "```"
        ])

    return "\n".join(lines)

def main():
    parser = argparse.ArgumentParser(
        description="Argus AI Diagnostic Engine — Automated divergence detection & root-cause analysis."
    )
    parser.add_argument(
        "-e", "--expected",
        required=True,
        help="Path to expected_graph.json (the behavioral contract)"
    )
    parser.add_argument(
        "-a", "--actual",
        required=True,
        help="Path to execution_graph.json (the recorded runtime trace)"
    )
    parser.add_argument(
        "-q", "--query", "--issue",
        default="",
        help="Optional natural language complaint from user (e.g. 'I clicked pay but it timed out')"
    )
    parser.add_argument(
        "-o", "--output",
        help="File path to save the diagnostic report (supports .md or .json)"
    )
    parser.add_argument(
        "--api-key",
        help="Optional Gemini or Google AI API key for enhanced LLM synthesis (default: offline rule engine)"
    )
    args = parser.parse_args()

    expected_path = Path(args.expected).resolve()
    actual_path = Path(args.actual).resolve()

    if not expected_path.exists():
        print(f"[!] Error: Expected graph not found: {expected_path}")
        sys.exit(1)
    if not actual_path.exists():
        print(f"[!] Error: Execution trace not found: {actual_path}")
        sys.exit(1)

    print_banner()

    print(f"[*] Loading Expected Graph: {expected_path.name}")
    with open(expected_path, "r", encoding="utf-8") as f:
        expected_graph = json.load(f)

    print(f"[*] Loading Recorded Trace: {actual_path.name}")
    with open(actual_path, "r", encoding="utf-8") as f:
        actual_graph = json.load(f)

    if args.query:
        print(f"[*] User Complaint: \"{args.query}\"")

    # Step 1: Detect Divergence
    print(f"\n[1/2] Comparing Graphs & Detecting Divergence...")
    report = compare_graphs(expected_graph, actual_graph)

    # Step 2: Synthesize Diagnosis
    print(f"[2/2] Synthesizing Root-Cause Diagnosis...")
    result = diagnose(report, user_query=args.query, api_key=args.api_key)

    # Print Summary to Terminal
    verdict_tag = "[DIVERGENCE DETECTED]" if result.diverged else "[HEALTHY]"
    print(f"\n=======================================================")
    print(f" DIAGNOSIS VERDICT: {verdict_tag} ({result.divergence_type})")
    print(f" Confidence: {result.confidence * 100:.1f}%")
    print(f"=======================================================\n")

    if result.diverged:
        print(f"[*] Divergence Node: {result.divergence_node_label} (ID: {result.divergence_node_id})")
        print(f"[!] Reason:          {result.divergence_type}")

    print(f"\n[USER-FACING EXPLANATION]:")
    print(f"   {result.user_explanation}")

    print(f"\n[DEVELOPER ROOT CAUSE]:")
    print(f"   {result.developer_diagnosis}")

    if result.recommended_actions:
        print(f"\n[RECOMMENDED REMEDIATION ACTIONS]:")
        for i, act in enumerate(result.recommended_actions, 1):
            print(f"   {i}. {act}")

    print(f"\n[EXECUTION TRACE]:")
    for step in result.reproduction_trace:
        is_div = result.divergence_node_label and result.divergence_node_label in step
        tag = " <=== [DIVERGENCE POINT]" if is_div else ""
        print(f"   {step}{tag}")

    # Save to file if requested
    if args.output:
        out_path = Path(args.output).resolve()
        if out_path.suffix.lower() == ".json":
            out_path.write_text(json.dumps(asdict(result), indent=2), encoding="utf-8")
        else:
            # Markdown default
            md_content = format_markdown_report(result, expected_path.name, actual_path.name, args.query)
            out_path.write_text(md_content, encoding="utf-8")
        print(f"\n[OK] Diagnostic report saved to: {out_path}")

if __name__ == "__main__":
    main()
