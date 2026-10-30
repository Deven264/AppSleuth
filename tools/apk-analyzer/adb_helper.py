"""
Argus ADB Helper

Provides on-device bridge functionality to inspect or pull installed applications
from connected Android devices/emulators via ADB without manual user commands.
"""

import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional

def find_adb() -> Optional[str]:
    """Auto-discovers adb executable across system PATH and Android SDK directories."""
    # 1. System PATH
    adb = shutil.which("adb") or shutil.which("adb.exe")
    if adb:
        return adb

    # 2. Android SDK standard locations
    candidate_roots = [
        os.environ.get("ANDROID_HOME"),
        os.environ.get("ANDROID_SDK_ROOT"),
        os.environ.get("LOCALAPPDATA", "") + "/Android/Sdk" if os.environ.get("LOCALAPPDATA") else None,
        os.path.expanduser("~/Library/Android/sdk") if os.name != "nt" else None,
    ]

    for root in candidate_roots:
        if not root:
            continue
        platform_tools = Path(root) / "platform-tools"
        if platform_tools.exists() and platform_tools.is_dir():
            cand = platform_tools / ("adb.exe" if os.name == "nt" else "adb")
            if cand.exists():
                return str(cand)
    return None

def run_adb_command(args: List[str]) -> tuple[int, str, str]:
    """Runs an adb command safely. Returns (returncode, stdout, stderr)."""
    adb_path = find_adb()
    if not adb_path:
        return -1, "", "ADB not found on system."

    try:
        proc = subprocess.run(
            [adb_path] + args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False
        )
        return proc.returncode, proc.stdout, proc.stderr
    except Exception as e:
        return -1, "", str(e)

def list_connected_devices() -> List[Dict[str, str]]:
    """Returns list of connected Android devices: [{'id': '...', 'state': 'device'}]"""
    code, stdout, _ = run_adb_command(["devices"])
    if code != 0:
        return []

    devices = []
    for line in stdout.splitlines()[1:]:
        parts = line.strip().split()
        if len(parts) >= 2:
            devices.append({"id": parts[0], "state": parts[1]})
    return devices

def list_installed_packages(third_party_only: bool = True) -> List[str]:
    """Queries package manager for installed packages on connected device."""
    flags = ["-3"] if third_party_only else []
    code, stdout, _ = run_adb_command(["shell", "pm", "list", "packages"] + flags)
    if code != 0:
        return []

    packages = []
    for line in stdout.splitlines():
        if line.startswith("package:"):
            pkg = line.replace("package:", "").strip()
            if pkg:
                packages.append(pkg)
    return sorted(packages)

def get_remote_apk_path(package_name: str) -> Optional[str]:
    """Finds remote filesystem path of the base.apk for an installed package."""
    code, stdout, _ = run_adb_command(["shell", "pm", "path", package_name])
    if code != 0 or not stdout:
        return None

    # Often returns: package:/data/app/~~.../base.apk
    for line in stdout.splitlines():
        if "base.apk" in line or line.startswith("package:"):
            return line.replace("package:", "").strip()
    return None

def pull_package_apk(package_name: str, dest_dir: str = ".") -> Optional[str]:
    """
    Pulls the APK of an installed package from a connected device.
    Returns the local path of the saved APK or None.
    """
    remote_path = get_remote_apk_path(package_name)
    if not remote_path:
        return None

    dest_path = Path(dest_dir).resolve() / f"{package_name}.apk"
    code, stdout, stderr = run_adb_command(["pull", remote_path, str(dest_path)])
    if code == 0 and dest_path.exists():
        return str(dest_path)
    return None
