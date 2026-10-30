"""
Argus APK DEX Parser

Extracts string constants, API endpoints, button/action triggers, state machine tokens,
and network exception signatures from compiled Dalvik Executable (classes*.dex) files.

Features:
- Pure-Python DEX header & string pool parser (zero native dependencies)
- Multi-DEX support (classes.dex, classes2.dex, ..., classesN.dex)
- Heuristic behavioral classifier for Android mobile workflows
"""

import re
import struct
import zipfile
from dataclasses import dataclass, field
from typing import Set, List, Dict, Any, Optional

@dataclass
class DexAnalysisResult:
    endpoints: List[str] = field(default_factory=list)
    buttons: List[str] = field(default_factory=list)
    state_tokens: List[str] = field(default_factory=list)
    exceptions: List[str] = field(default_factory=list)
    app_classes: List[str] = field(default_factory=list)
    total_strings: int = 0

# Common namespaces and domains to filter out from API endpoint discovery
FILTERED_DOMAINS = [
    "schemas.android.com",
    "www.w3.org",
    "schemas.xmlsoap.org",
    "android.hardware",
    "kotlinx.coroutines",
    "androidx."
]

def decode_uleb128(data: bytes, offset: int) -> tuple[int, int]:
    """Decodes an unsigned LEB128 integer. Returns (value, new_offset)."""
    val = 0
    shift = 0
    while True:
        if offset >= len(data):
            break
        b = data[offset]
        offset += 1
        val |= (b & 0x7F) << shift
        if (b & 0x80) == 0:
            break
        shift += 7
    return val, offset

def extract_dex_strings(dex_data: bytes) -> Set[str]:
    """Parses the string pool of a single DEX file."""
    strings = set()
    if len(dex_data) < 0x70:
        return strings

    magic = dex_data[:8]
    if not magic.startswith(b"dex\n"):
        return strings

    try:
        string_ids_size, string_ids_off = struct.unpack_from("<II", dex_data, 0x38)
        if string_ids_off + string_ids_size * 4 > len(dex_data):
            return strings

        offsets = struct.unpack_from(f"<{string_ids_size}I", dex_data, string_ids_off)
        for s_off in offsets:
            if s_off >= len(dex_data):
                continue
            u16len, str_start = decode_uleb128(dex_data, s_off)
            # Find null terminator
            null_pos = dex_data.find(b"\x00", str_start)
            if null_pos != -1:
                raw_str = dex_data[str_start:null_pos]
                try:
                    s = raw_str.decode("utf-8", errors="ignore")
                    if 1 < len(s) < 256:
                        strings.add(s)
                except Exception:
                    pass
    except Exception:
        pass

    return strings

def parse_apk_dex(apk_path: str, package_filter: Optional[str] = None) -> DexAnalysisResult:
    """
    Parses all classes*.dex files within an APK and categorizes behavioral tokens.
    """
    result = DexAnalysisResult()
    all_strings: Set[str] = set()

    try:
        with zipfile.ZipFile(apk_path, "r") as z:
            dex_files = [n for n in z.namelist() if re.match(r"^classes\d*\.dex$", n)]
            for dex_name in sorted(dex_files):
                try:
                    dex_data = z.read(dex_name)
                    dex_strs = extract_dex_strings(dex_data)
                    all_strings.update(dex_strs)
                except Exception:
                    continue
    except Exception:
        return result

    result.total_strings = len(all_strings)

    # 1. Discover API endpoints
    discovered_endpoints = set()
    for s in all_strings:
        # Full URL
        if s.startswith("http://") or s.startswith("https://"):
            if not any(f in s for f in FILTERED_DOMAINS) and not s.endswith(".xml") and not s.endswith(".png"):
                discovered_endpoints.add(s)
        # Relative endpoint (e.g. /api/upload, /v1/charge)
        elif re.match(r"^/(api|v\d+|auth|users|upload|checkout|charge|order|cart|email)/[a-zA-Z0-9_\-]+", s):
            discovered_endpoints.add(s)

    result.endpoints = sorted(discovered_endpoints)

    # 2. Discover Button IDs and UI action labels
    discovered_buttons = set()
    button_patterns = [
        r"^(btn[A-Z][a-zA-Z0-9_]*)$",
        r"^(button[A-Z][a-zA-Z0-9_]*)$",
        r"^(Tap[A-Z][a-zA-Z0-9_]*)$",
        r"^([a-zA-Z0-9_]+_button)$",
        r"^([a-zA-Z0-9_]+_btn)$",
    ]
    for s in all_strings:
        for pat in button_patterns:
            if re.match(pat, s):
                # Filter out generic Android internal action widgets
                if not any(ign in s for ign in ["actionBar", "actionArea", "actionMode", "actionId"]):
                    discovered_buttons.add(s)

    result.buttons = sorted(discovered_buttons)

    # 3. Discover State Machine tokens
    discovered_states = set()
    for s in all_strings:
        if s.startswith("StateChange:"):
            discovered_states.add(s.replace("StateChange:", ""))
        elif any(k in s for k in ["Uploading", "EmailSent", "UploadFailed", "OrderConfirmed", "PaymentFailed", "Processing"]):
            if len(s) < 40 and not any(ign in s for ign in [" ", "=", "{", "}", "$", ";", "/", "."]):
                discovered_states.add(s)

    result.state_tokens = sorted(discovered_states)

    # 4. Discover Network & Timeout Exceptions
    known_exceptions = [
        "SocketTimeoutException",
        "UnknownHostException",
        "ConnectException",
        "SSLException",
        "HttpException",
        "TimeoutException"
    ]
    for exc in known_exceptions:
        if any(exc in s for s in all_strings):
            result.exceptions.append(exc)

    # 5. Discover Application Specific Classes
    if package_filter:
        pkg_pattern = package_filter.replace(".", "/")
        for s in all_strings:
            if s.startswith(f"L{pkg_pattern}") and s.endswith(";"):
                clean_cls = s[1:-1].replace("/", ".")
                if not "$" in clean_cls:
                    result.app_classes.append(clean_cls)

    return result
