#!/usr/bin/env python3
"""
Argus Codebase Context Extractor

Scans an application repository (Android, iOS, Web) and extracts:
1. Test files (The primary ground truth for behavioral scenarios)
2. Navigation / Manifest / Routing files (Structural screen skeleton)
3. UI Screens & ViewModels (Actions & state transitions)
4. Network & API contracts (Endpoints, status codes, timeouts)

Outputs a consolidated markdown file that can be passed directly to an LLM
along with the Argus System Prompt to generate expected_graph.json.
"""

import os
import sys
import argparse
from pathlib import Path

# Directories to ignore
IGNORE_DIRS = {
    ".git", ".gradle", ".idea", "build", "node_modules", "dist",
    ".vscode", "out", "target", "bin", "obj", ".next", ".turbo"
}

# File patterns of interest
TEST_PATTERNS = ["*test*.", "*spec*."]
NAV_PATTERNS = ["*manifest*.xml", "*nav*.xml", "*navhost*.", "*route*.", "*router*."]
UI_PATTERNS = ["*activity*.", "*fragment*.", "*screen*.", "*page*.", "*controller*."]
STATE_PATTERNS = ["*viewmodel*.", "*state*.", "*store*.", "*reducer*."]
API_PATTERNS = ["*repository*.", "*api*.", "*service*.", "*client*.", "*endpoint*."]

def should_ignore(path: Path) -> bool:
    for part in path.parts:
        if part in IGNORE_DIRS or part.startswith("."):
            return True
    return False

def matches_any(filename: str, patterns: list) -> bool:
    lower_name = filename.lower()
    for pat in patterns:
        pat_clean = pat.replace("*", "").lower()
        if pat_clean in lower_name:
            return True
    return False

def scan_project(root_path: Path):
    categories = {
        "Tests": [],
        "Navigation & Routes": [],
        "UI Screens & Controllers": [],
        "State & ViewModels": [],
        "Network & APIs": []
    }

    for dirpath, dirnames, filenames in os.walk(root_path):
        # Filter in-place to avoid descending into ignored directories
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS and not d.startswith(".")]

        for filename in filenames:
            file_path = Path(dirpath) / filename
            if should_ignore(file_path):
                continue

            # Only inspect source code files
            if file_path.suffix.lower() not in {".kt", ".java", ".swift", ".ts", ".tsx", ".js", ".jsx", ".xml", ".json"}:
                continue

            if matches_any(filename, TEST_PATTERNS):
                categories["Tests"].append(file_path)
            elif matches_any(filename, NAV_PATTERNS):
                categories["Navigation & Routes"].append(file_path)
            elif matches_any(filename, UI_PATTERNS):
                # Ignore diagnostic SDK internal activities if any
                if "diagnostic" not in str(file_path).lower():
                    categories["UI Screens & Controllers"].append(file_path)
            elif matches_any(filename, STATE_PATTERNS):
                categories["State & ViewModels"].append(file_path)
            elif matches_any(filename, API_PATTERNS):
                if "diagnostic" not in str(file_path).lower():
                    categories["Network & APIs"].append(file_path)

    return categories

def generate_markdown(root_path: Path, categories: dict, output_file: Path):
    lines = []
    lines.append("# Argus Codebase Context Extraction")
    lines.append(f"\n**Root Project:** `{root_path.resolve()}`\n")
    lines.append("> Provide this document to the Argus Graph Extractor LLM to generate `expected_graph.json`.\n")

    for category, files in categories.items():
        lines.append(f"## {category} ({len(files)} files found)\n")
        if not files:
            lines.append("*None found.*\n")
            continue

        for f in files:
            rel_path = f.relative_to(root_path)
            lines.append(f"### File: `{rel_path}`")
            lines.append("```" + (f.suffix.lstrip(".") or "text"))
            try:
                content = f.read_text(encoding="utf-8", errors="replace")
                lines.append(content)
            except Exception as e:
                lines.append(f"// Error reading file: {e}")
            lines.append("```\n")

    output_file.write_text("\n".join(lines), encoding="utf-8")
    print(f"[OK] Context extraction complete. Saved to: {output_file.resolve()}")

def main():
    parser = argparse.ArgumentParser(description="Extract relevant code context for Argus behavioral graph generation.")
    parser.add_argument("project_dir", nargs="?", default=".", help="Path to the application root directory")
    parser.add_argument("-o", "--output", default="codebase_context.md", help="Output markdown file path")
    args = parser.parse_args()

    project_path = Path(args.project_dir).resolve()
    output_path = Path(args.output).resolve()

    if not project_path.exists():
        print(f"Error: Path '{project_path}' does not exist.")
        sys.exit(1)

    print(f"[*] Scanning project at: {project_path}")
    categories = scan_project(project_path)

    for cat, files in categories.items():
        print(f"    - {cat}: {len(files)} relevant files")

    generate_markdown(project_path, categories, output_path)

if __name__ == "__main__":
    main()
