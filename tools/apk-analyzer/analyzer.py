#!/usr/bin/env python3
"""
Argus Android APK Analyzer — Black-Box Behavioral Reconstruction

Generates an Argus Expected Behavioral Graph (expected_graph.json) from an Android APK
or an installed on-device app package without needing access to the original source code.
"""

import sys
import os
import json
import argparse
import tempfile
from pathlib import Path

from manifest_parser import parse_apk_manifest
from dex_parser import parse_apk_dex
from graph_synthesizer import synthesize_android_graph
import adb_helper

def print_banner():
    banner = r"""
     _                              _    ____  _  __    _                _                     
    / \   _ __ __ _ _   _ ___      / \  |  _ \| |/ /   / \   _ __   __ _| |_   _ _______ _ __ 
   / _ \ | '__/ _` | | | / __|    / _ \ | |_) | ' /   / _ \ | '_ \ / _` | | | | |_  / _ \ '__|
  / ___ \| | | (_| | |_| \__ \   / ___ \|  __/| . \  / ___ \| | | | (_| | | |_| |/ /  __/ |   
 /_/   \_\_|  \__, |\__,_|___/  /_/   \_\_|   |_|\_\/_/   \_\_| |_|\__,_|_|\__, /___\___|_|   
              |___/                                                        |___/              
    Argus: SystemSleuth — Black-Box Android Behavioral Reconstruction
    """
    print(banner)

def main():
    parser = argparse.ArgumentParser(
        description="Argus Android APK Analyzer — Reconstruct expected behavioral graphs from compiled APKs."
    )
    parser.add_argument(
        "target",
        nargs="?",
        help="Path to an .apk file (e.g. app-debug.apk) or package name if using --device"
    )
    parser.add_argument(
        "-o", "--output",
        default="expected_graph.json",
        help="Output path for the generated expected_graph.json (default: expected_graph.json)"
    )
    parser.add_argument(
        "--device",
        action="store_true",
        help="Pull and analyze an installed app from a connected Android device via ADB"
    )
    parser.add_argument(
        "--list-packages",
        action="store_true",
        help="List third-party installed packages on connected Android device and exit"
    )
    parser.add_argument(
        "--app-version",
        help="Override the application version tag (defaults to version in APK manifest)"
    )
    parser.add_argument(
        "--workflow-name",
        help="Custom name for the synthesized workflow (e.g. SendEmailWorkflow)"
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print verbose details of discovered DEX tokens and classes"
    )

    args = parser.parse_args()

    # Handle --list-packages
    if args.list_packages:
        print("[*] Querying connected Android devices...")
        devices = adb_helper.list_connected_devices()
        if not devices:
            print("[!] No Android devices found via ADB. Ensure USB debugging is enabled.")
            sys.exit(1)

        print(f"[OK] Found device: {devices[0]['id']} ({devices[0]['state']})")
        print("[*] Retrieving third-party installed packages...")
        pkgs = adb_helper.list_installed_packages(third_party_only=True)
        if not pkgs:
            print("    (No third-party packages installed)")
        else:
            print(f"\nInstalled Applications ({len(pkgs)} found):")
            for p in pkgs:
                print(f"  - {p}")
            print("\nRun: python tools/apk-analyzer/analyzer.py <package_name> --device")
        sys.exit(0)

    if not args.target:
        parser.print_help()
        sys.exit(1)

    print_banner()

    apk_file_to_clean: str | None = None
    target_apk: str = ""

    # Handle --device (pull APK from phone)
    if args.device:
        pkg_name = args.target
        print(f"[*] Targeting on-device package: {pkg_name}")
        devices = adb_helper.list_connected_devices()
        if not devices:
            print("[!] Error: No Android device detected via ADB. Connect your device or run emulator.")
            sys.exit(1)

        print(f"[*] Device found: {devices[0]['id']}. Locating remote APK...")
        temp_dir = tempfile.mkdtemp(prefix="argus_apk_")
        pulled_path = adb_helper.pull_package_apk(pkg_name, dest_dir=temp_dir)
        if not pulled_path:
            print(f"[!] Failed to pull APK for package '{pkg_name}'. Is the package installed?")
            sys.exit(1)

        target_apk = pulled_path
        apk_file_to_clean = pulled_path
        print(f"[OK] Pulled APK to temporary location: {target_apk}")
    else:
        target_path = Path(args.target).resolve()
        if not target_path.exists():
            print(f"[!] Error: APK file not found: {target_path}")
            sys.exit(1)
        target_apk = str(target_path)

    try:
        # Step 1: Parse AndroidManifest.xml
        print(f"\n[1/3] Deconstructing AndroidManifest.xml...")
        manifest = parse_apk_manifest(target_apk)
        print(f"    - Package Name: {manifest.package_name}")
        print(f"    - Version: {manifest.version_name} (code: {manifest.version_code})")
        print(f"    - App Label: {manifest.app_label or manifest.package_name}")
        print(f"    - Launcher Activity: {manifest.launcher_activity or 'None'}")
        print(f"    - Total Activities: {len(manifest.activities)}")
        for act in manifest.activities:
            tag = " [LAUNCHER]" if act["is_launcher"] else ""
            print(f"      * {act['name']}{tag}")
        if manifest.deep_links:
            print(f"    - Discovered Deep Links: {len(manifest.deep_links)}")
            for dl in manifest.deep_links:
                print(f"      * {dl['url']} -> {dl['activity']}")

        # Step 2: Parse DEX string pool & bytecodes
        print(f"\n[2/3] Analyzing Dalvik Executable (classes*.dex) string pools...")
        dex_result = parse_apk_dex(target_apk, package_filter=manifest.package_name)
        print(f"    - Total Unique String Pool Constants: {dex_result.total_strings:,}")
        print(f"    - Discovered API Endpoints: {len(dex_result.endpoints)}")
        for ep in dex_result.endpoints:
            print(f"      * {ep}")
        print(f"    - Discovered User Actions / Buttons: {len(dex_result.buttons)}")
        for btn in dex_result.buttons[:6]:
            print(f"      * {btn}")
        if len(dex_result.buttons) > 6:
            print(f"      ... and {len(dex_result.buttons) - 6} more")
        print(f"    - Discovered State Machine Tokens: {dex_result.state_tokens}")
        print(f"    - Discovered Failure Signatures: {dex_result.exceptions}")

        if args.verbose and dex_result.app_classes:
            print(f"\n    [Verbose] Application Classes ({len(dex_result.app_classes)} found):")
            for c in dex_result.app_classes:
                print(f"      - {c}")

        # Step 3: Synthesize into Argus Expected Behavioral Graph
        print(f"\n[3/3] Synthesizing Argus Expected Behavioral Graph...")
        graph = synthesize_android_graph(
            manifest=manifest,
            dex=dex_result,
            app_version=args.app_version,
            workflow_name_override=args.workflow_name
        )

        output_path = Path(args.output).resolve()
        output_path.write_text(json.dumps(graph, indent=2), encoding="utf-8")

        workflow = graph["workflows"][0]
        print(f"\n[OK] Behavioral graph reconstructed successfully!")
        print(f"    - Saved To: {output_path}")
        print(f"    - Workflow ID: {workflow['id']} ({workflow['name']})")
        print(f"    - Total Nodes: {len(workflow['nodes'])}")
        print(f"    - Total Transitions (Edges): {len(workflow['edges'])}")
        print(f"    - Synthesized Paths: {', '.join(workflow['paths'].keys())}")
        print(f"    - Failure Divergence Node: {workflow['paths']['timeout_failure_path']['divergesFromHappyPathAt']}")

    finally:
        # Clean up temporary pulled APK if created
        if apk_file_to_clean and os.path.exists(apk_file_to_clean):
            try:
                os.remove(apk_file_to_clean)
                os.rmdir(os.path.dirname(apk_file_to_clean))
            except Exception:
                pass

if __name__ == "__main__":
    main()
