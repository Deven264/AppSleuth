#!/usr/bin/env python3
"""
Argus Web Context Extractor

Scans a web application directory and extracts:
1. E2E & Component Tests (Playwright, Cypress, Vitest, Jest)
2. Routing & Page definitions (React Router, Next.js page/route, Vue router)
3. API clients & endpoints (Fetch, Axios, TanStack Query)
4. State models (Redux, Zustand, Vuex, Context)

Outputs a consolidated markdown document ready for the Argus Web Extractor LLM.
"""

import os
import sys
import argparse
from pathlib import Path

IGNORE_DIRS = {
    ".git", "node_modules", ".next", ".turbo", "dist", "build",
    ".vscode", ".idea", "coverage", ".playwright"
}

TEST_PATTERNS = [".spec.", ".test.", ".cy.", "spec.js", "test.js", "test.ts", "spec.ts"]
ROUTER_PATTERNS = ["route", "router", "page", "app.", "index.html"]
API_PATTERNS = ["api", "service", "client", "fetch", "axios", "query"]
STATE_PATTERNS = ["store", "state", "reducer", "context", "slice"]

def should_ignore(path: Path) -> bool:
    for part in path.parts:
        if part in IGNORE_DIRS or part.startswith("."):
            return True
    return False

def matches_any(filename: str, patterns: list) -> bool:
    lower_name = filename.lower()
    return any(p in lower_name for p in patterns)

def scan_web_project(root_path: Path):
    categories = {
        "E2E & Component Tests": [],
        "Routes & Pages": [],
        "API Clients & Endpoints": [],
        "State & Stores": []
    }

    for dirpath, dirnames, filenames in os.walk(root_path):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS and not d.startswith(".")]

        for filename in filenames:
            file_path = Path(dirpath) / filename
            if should_ignore(file_path):
                continue

            if file_path.suffix.lower() not in {".ts", ".tsx", ".js", ".jsx", ".html", ".json"}:
                continue

            # Skip package.json and config files from deep analysis
            if filename in {"package-lock.json", "tsconfig.json"}:
                continue

            if matches_any(filename, TEST_PATTERNS):
                categories["E2E & Component Tests"].append(file_path)
            elif matches_any(filename, ROUTER_PATTERNS):
                categories["Routes & Pages"].append(file_path)
            elif matches_any(filename, API_PATTERNS):
                categories["API Clients & Endpoints"].append(file_path)
            elif matches_any(filename, STATE_PATTERNS):
                categories["State & Stores"].append(file_path)

    return categories

def generate_markdown(root_path: Path, categories: dict, output_file: Path):
    lines = []
    lines.append("# Argus Web Context Extraction")
    lines.append(f"\n**Root Project:** `{root_path.resolve()}`\n")
    lines.append("> Pass this to the Argus Web Graph Extractor LLM to generate `expected_graph.json`.\n")

    for category, files in categories.items():
        lines.append(f"## {category} ({len(files)} files found)\n")
        if not files:
            lines.append("*None found.*\n")
            continue

        for f in files:
            try:
                rel_path = f.relative_to(root_path)
            except ValueError:
                rel_path = f.name
            lines.append(f"### File: `{rel_path}`")
            lines.append("```" + (f.suffix.lstrip(".") or "text"))
            try:
                content = f.read_text(encoding="utf-8", errors="replace")
                lines.append(content)
            except Exception as e:
                lines.append(f"// Error reading file: {e}")
            lines.append("```\n")

    output_file.write_text("\n".join(lines), encoding="utf-8")
    print(f"[OK] Web context extraction complete. Saved to: {output_file.resolve()}")

def main():
    parser = argparse.ArgumentParser(description="Extract web codebase context for Argus behavioral graph generation.")
    parser.add_argument("project_dir", nargs="?", default=".", help="Path to web application directory")
    parser.add_argument("-o", "--output", default="web_codebase_context.md", help="Output file")
    args = parser.parse_args()

    project_path = Path(args.project_dir).resolve()
    output_path = Path(args.output).resolve()

    if not project_path.exists():
        print(f"Error: Path '{project_path}' does not exist.")
        sys.exit(1)

    print(f"[*] Scanning web project at: {project_path}")
    categories = scan_web_project(project_path)

    for cat, files in categories.items():
        print(f"    - {cat}: {len(files)} files")

    generate_markdown(project_path, categories, output_path)

if __name__ == "__main__":
    main()
