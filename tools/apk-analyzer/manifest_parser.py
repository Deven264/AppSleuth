"""
Argus APK Manifest Parser

Extracts package metadata, activities, launcher entrypoints, deep links, and permissions
from an Android APK's AndroidManifest.xml.

Supports both:
1. Fast high-fidelity extraction using auto-discovered `aapt2` (if Android SDK is installed)
2. Pure-Python Binary AXML parser fallback (zero dependencies, works on any environment)
"""

import os
import re
import shutil
import struct
import subprocess
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Dict, Any, Optional

@dataclass
class ManifestData:
    package_name: str = ""
    version_code: str = "1"
    version_name: str = "1.0.0"
    app_label: str = ""
    permissions: List[str] = field(default_factory=list)
    launcher_activity: Optional[str] = None
    activities: List[Dict[str, Any]] = field(default_factory=list)
    deep_links: List[Dict[str, str]] = field(default_factory=list)

def find_aapt2() -> Optional[str]:
    """Auto-discovers aapt2 executable across system PATH and Android SDK directories."""
    # 1. System PATH
    aapt2 = shutil.which("aapt2") or shutil.which("aapt2.exe")
    if aapt2:
        return aapt2

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
        build_tools = Path(root) / "build-tools"
        if build_tools.exists() and build_tools.is_dir():
            for version_dir in sorted(build_tools.iterdir(), reverse=True):
                cand = version_dir / ("aapt2.exe" if os.name == "nt" else "aapt2")
                if cand.exists():
                    return str(cand)
    return None

def parse_manifest_aapt2(apk_path: str, aapt2_path: str) -> ManifestData:
    """Parses manifest information using aapt2 dump."""
    manifest = ManifestData()

    # Step A: aapt2 dump badging
    try:
        proc = subprocess.run(
            [aapt2_path, "dump", "badging", apk_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False
        )
        output = proc.stdout
        for line in output.splitlines():
            # package: name='com.appsleuth' versionCode='1' versionName='1.0.0'
            if line.startswith("package:"):
                m_pkg = re.search(r"name='([^']+)'", line)
                if m_pkg:
                    manifest.package_name = m_pkg.group(1)
                m_ver = re.search(r"versionName='([^']+)'", line)
                if m_ver:
                    manifest.version_name = m_ver.group(1)
                m_code = re.search(r"versionCode='([^']+)'", line)
                if m_code:
                    manifest.version_code = m_code.group(1)
            elif line.startswith("application-label:"):
                m_lbl = re.search(r"application-label(?:-[^:]+)?:'([^']+)'", line)
                if m_lbl and not manifest.app_label:
                    manifest.app_label = m_lbl.group(1)
            elif line.startswith("launchable-activity:"):
                m_act = re.search(r"name='([^']+)'", line)
                if m_act:
                    manifest.launcher_activity = m_act.group(1)
            elif line.startswith("uses-permission:"):
                m_perm = re.search(r"name='([^']+)'", line)
                if m_perm and m_perm.group(1) not in manifest.permissions:
                    manifest.permissions.append(m_perm.group(1))
    except Exception:
        pass

    # Step B: aapt2 dump xmltree AndroidManifest.xml (gets complete activity tree & deep links)
    try:
        proc = subprocess.run(
            [aapt2_path, "dump", "xmltree", apk_path, "--file", "AndroidManifest.xml"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False
        )
        xmltree = proc.stdout
        current_activity: Optional[Dict[str, Any]] = None
        in_intent_filter = False
        is_launcher = False
        current_scheme = ""
        current_host = ""

        for line in xmltree.splitlines():
            line_str = line.strip()
            if line_str.startswith("E: activity "):
                if current_activity and current_activity.get("name"):
                    if is_launcher:
                        current_activity["is_launcher"] = True
                    manifest.activities.append(current_activity)
                current_activity = {"name": "", "is_launcher": False, "deep_links": []}
                in_intent_filter = False
                is_launcher = False

            elif line_str.startswith("E: ") and not any(line_str.startswith(prefix) for prefix in [
                "E: activity ", "E: intent-filter", "E: action", "E: category", "E: data", "E: meta-data"
            ]):
                # Encountered non-activity tag (e.g. E: provider, E: receiver, E: service)
                if current_activity and current_activity.get("name"):
                    if is_launcher:
                        current_activity["is_launcher"] = True
                    manifest.activities.append(current_activity)
                current_activity = None
                in_intent_filter = False
                is_launcher = False

            elif current_activity is not None:
                # Activity name
                if 'http://schemas.android.com/apk/res/android:name' in line_str and not in_intent_filter:
                    m_name = re.search(r'="([^"]+)"', line_str)
                    if m_name:
                        current_activity["name"] = m_name.group(1)

                elif line_str.startswith("E: intent-filter"):
                    in_intent_filter = True
                    current_scheme = ""
                    current_host = ""

                elif in_intent_filter:
                    if 'android.intent.category.LAUNCHER' in line_str:
                        is_launcher = True
                        if not manifest.launcher_activity and current_activity.get("name"):
                            manifest.launcher_activity = current_activity["name"]

                    # Deep link schemes and hosts
                    if ':scheme' in line_str:
                        m_scheme = re.search(r'="([^"]+)"', line_str)
                        if m_scheme:
                            current_scheme = m_scheme.group(1)
                    if ':host' in line_str:
                        m_host = re.search(r'="([^"]+)"', line_str)
                        if m_host:
                            current_host = m_host.group(1)
                            if current_scheme:
                                link = f"{current_scheme}://{current_host}"
                                current_activity["deep_links"].append(link)
                                manifest.deep_links.append({
                                    "activity": current_activity.get("name", ""),
                                    "url": link
                                })

            # Manifest attributes
            if line_str.startswith('A: package='):
                m_pkg = re.search(r'="([^"]+)"', line_str)
                if m_pkg and not manifest.package_name:
                    manifest.package_name = m_pkg.group(1)

        if current_activity:
            if is_launcher:
                current_activity["is_launcher"] = True
            manifest.activities.append(current_activity)

    except Exception:
        pass

    # Ensure launcher activity is marked in activities list
    for act in manifest.activities:
        if act["name"] == manifest.launcher_activity:
            act["is_launcher"] = True

    return manifest

def parse_manifest_pure_python(apk_path: str) -> ManifestData:
    """
    Pure-Python Binary XML (AXML) parser fallback.
    Decodes strings and extracts package, activities, and permissions directly from AndroidManifest.xml.
    """
    manifest = ManifestData()
    try:
        with zipfile.ZipFile(apk_path, "r") as z:
            if "AndroidManifest.xml" not in z.namelist():
                return manifest
            raw = z.read("AndroidManifest.xml")
    except Exception:
        return manifest

    if len(raw) < 28:
        return manifest

    # Decode string pool
    try:
        chunk_type, header_size, chunk_size, string_count, style_count, flags, strings_start, styles_start = struct.unpack_from(
            '<HHIIIIII', raw, 8
        )
        if chunk_type != 0x0001:
            return manifest

        offsets = struct.unpack_from(f'<{string_count}I', raw, 8 + header_size)
        strings = []
        is_utf8 = bool(flags & (1 << 8))

        for off in offsets:
            pos = 8 + strings_start + off
            if is_utf8:
                u16len = raw[pos]
                pos += 1
                if u16len & 0x80:
                    pos += 1
                u8len = raw[pos]
                pos += 1
                if u8len & 0x80:
                    pos += 1
                s = raw[pos:pos + u8len].decode("utf-8", errors="ignore")
            else:
                u16len = struct.unpack_from('<H', raw, pos)[0]
                pos += 2
                s = raw[pos:pos + u16len * 2].decode("utf-16le", errors="ignore")
            strings.append(s)

        # Scan decoded strings for package, activities, permissions
        for s in strings:
            # Package name heuristic
            if not manifest.package_name and re.match(r'^[a-z][a-z0-9_]*(\.[a-z0-9_]+){2,}$', s):
                if not s.startswith("android.") and not s.startswith("androidx."):
                    manifest.package_name = s

            # Permissions
            if s.startswith("android.permission.") and s not in manifest.permissions:
                manifest.permissions.append(s)

            # Activity heuristic: Class name containing Activity
            if "Activity" in s and ("." in s) and not s.startswith("android.") and not s.startswith("androidx."):
                is_launch = "Main" in s or "Launcher" in s
                if not any(a["name"] == s for a in manifest.activities):
                    manifest.activities.append({
                        "name": s,
                        "is_launcher": is_launch,
                        "deep_links": []
                    })
                if is_launch and not manifest.launcher_activity:
                    manifest.launcher_activity = s

    except Exception:
        pass

    # If launcher not detected, pick the first activity
    if not manifest.launcher_activity and manifest.activities:
        manifest.launcher_activity = manifest.activities[0]["name"]
        manifest.activities[0]["is_launcher"] = True

    return manifest

def parse_apk_manifest(apk_path: str) -> ManifestData:
    """Primary entrypoint: tries aapt2 first for 100% precision, falls back to pure-Python AXML parser."""
    aapt2 = find_aapt2()
    if aapt2:
        manifest = parse_manifest_aapt2(apk_path, aapt2)
        if manifest.package_name and manifest.activities:
            return manifest

    return parse_manifest_pure_python(apk_path)
