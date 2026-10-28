#!/usr/bin/env python3
"""
AppSleuth Web Crawler & Behavioral Graph Generator

Takes any website URL or local HTML file and generates an AppSleuth Expected Behavioral Graph
(expected_graph.json) without requiring access to the application source code.
"""

import sys
import os
import json
import argparse
from pathlib import Path
from urllib.parse import urlparse
import requests

from html_analyzer import WebPageAnalysis
from graph_synthesizer import synthesize_web_graph

def fetch_page_content(target: str) -> tuple[str, str]:
    """
    Fetches raw HTML from a web URL or reads from a local file.
    Returns (raw_html, resolved_url).
    """
    if target.startswith("http://") or target.startswith("https://"):
        print(f"[*] Crawling remote web target: {target}")
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 AppSleuth/1.0"
        }
        resp = requests.get(target, headers=headers, timeout=12)
        resp.raise_for_status()
        return resp.text, target

    elif target.startswith("file://") or os.path.exists(target):
        file_path = target.replace("file:///", "").replace("file://", "")
        path_obj = Path(file_path).resolve()
        if not path_obj.exists():
            raise FileNotFoundError(f"Local file does not exist: {path_obj}")

        print(f"[*] Reading local web file: {path_obj}")
        content = path_obj.read_text(encoding="utf-8", errors="replace")
        resolved_url = f"file:///{path_obj.as_posix()}"
        return content, resolved_url

    else:
        # Default try prepend https://
        alt_target = "https://" + target
        print(f"[*] Attempting HTTPS fetch: {alt_target}")
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 AppSleuth/1.0"
        }
        resp = requests.get(alt_target, headers=headers, timeout=12)
        resp.raise_for_status()
        return resp.text, alt_target

def main():
    parser = argparse.ArgumentParser(
        description="AppSleuth Web Crawler — Generate an expected behavioral graph from any website URL or HTML file."
    )
    parser.add_argument("target", help="Website URL (e.g. https://example.com/checkout) or local HTML file path")
    parser.add_argument("-o", "--output", default="expected_graph.json", help="Output path for the generated expected_graph.json")
    parser.add_argument("--app-version", default="1.0.0", help="Application version tag (default: 1.0.0)")
    args = parser.parse_args()

    try:
        raw_html, resolved_url = fetch_page_content(args.target)
    except Exception as e:
        print(f"[!] Error fetching target: {e}")
        sys.exit(1)

    print(f"[*] Analyzing DOM, forms, buttons, and endpoints...")
    analysis = WebPageAnalysis(raw_html, resolved_url)

    print(f"    - Title: {analysis.title}")
    print(f"    - Detected Workflow: {analysis.detected_workflow}")
    print(f"    - Interactive Buttons: {len(analysis.buttons)}")
    print(f"    - Forms Discovered: {len(analysis.forms)}")
    print(f"    - Discovered Endpoints: {len(analysis.api_endpoints)}")
    for ep in analysis.api_endpoints:
        print(f"      * {ep['method']} {ep['path']} ({ep['source']})")

    print(f"[*] Synthesizing AppSleuth Expected Behavioral Graph...")
    graph = synthesize_web_graph(analysis, app_version=args.app_version)

    output_path = Path(args.output).resolve()
    output_path.write_text(json.dumps(graph, indent=2), encoding="utf-8")

    workflow = graph["workflows"][0]
    print(f"\n[OK] Behavioral graph generated successfully!")
    print(f"    - Saved to: {output_path}")
    print(f"    - Total Nodes: {len(workflow['nodes'])}")
    print(f"    - Total Transitions (Edges): {len(workflow['edges'])}")
    print(f"    - Synthesized Paths: {', '.join(workflow['paths'].keys())}")

if __name__ == "__main__":
    main()
