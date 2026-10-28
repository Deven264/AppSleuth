"""
AppSleuth HTML & DOM Analyzer

Parses web page HTML, DOM nodes, interactive elements, forms, and embedded scripts
to extract the behavioral entities needed for graph synthesis.
"""

import re
from html.parser import HTMLParser
from urllib.parse import urlparse, urljoin
from typing import List, Dict, Any, Optional

class PageContentParser(HTMLParser):
    def __init__(self, base_url: str = ""):
        super().__init__()
        self.base_url = base_url
        self.title = ""
        self._in_title = False
        self._in_button = False
        self._in_script = False
        self._current_button_text = []
        self._current_script = []

        self.buttons: List[Dict[str, Any]] = []
        self.forms: List[Dict[str, Any]] = []
        self.links: List[Dict[str, str]] = []
        self.scripts: List[str] = []
        self._current_form: Optional[Dict[str, Any]] = None

    def handle_starttag(self, tag: str, attrs: list):
        attr_dict = dict(attrs)

        if tag == "title":
            self._in_title = True
        elif tag == "script":
            self._in_script = True
            if "src" in attr_dict:
                self.scripts.append(f"src:{attr_dict['src']}")
        elif tag == "form":
            self._current_form = {
                "id": attr_dict.get("id", ""),
                "action": attr_dict.get("action", ""),
                "method": attr_dict.get("method", "GET").upper(),
                "inputs": []
            }
            self.forms.append(self._current_form)
        elif tag in ("input", "select", "textarea"):
            input_info = {
                "tag": tag,
                "name": attr_dict.get("name", ""),
                "id": attr_dict.get("id", ""),
                "type": attr_dict.get("type", "text"),
                "placeholder": attr_dict.get("placeholder", ""),
                "required": "required" in attr_dict,
                "value": attr_dict.get("value", "")
            }
            if self._current_form is not None:
                self._current_form["inputs"].append(input_info)
            else:
                # Top-level standalone input
                if not hasattr(self, "standalone_inputs"):
                    self.standalone_inputs = []
                self.standalone_inputs.append(input_info)

            # Check if this input is a submit/button
            if attr_dict.get("type") in ("submit", "button"):
                label = attr_dict.get("value") or attr_dict.get("name") or "Submit"
                self.buttons.append({
                    "id": attr_dict.get("id", ""),
                    "label": label,
                    "type": "input_" + attr_dict.get("type")
                })

        elif tag == "button" or attr_dict.get("role") == "button":
            self._in_button = True
            self._current_button_text = []
            self._current_button_attrs = attr_dict

        elif tag == "a" and "href" in attr_dict:
            href = attr_dict["href"]
            if href and not href.startswith("javascript:") and not href.startswith("#"):
                self.links.append({
                    "href": urljoin(self.base_url, href),
                    "text": ""  # will capture text in handle_data
                })

    def handle_endtag(self, tag: str):
        if tag == "title":
            self._in_title = False
        elif tag == "script":
            self._in_script = False
            code = "".join(self._current_script).strip()
            if code:
                self.scripts.append(code)
            self._current_script = []
        elif tag == "form":
            self._current_form = None
        elif tag == "button":
            self._in_button = False
            label = "".join(self._current_button_text).strip()
            attrs = getattr(self, "_current_button_attrs", {})
            track_label = (
                attrs.get("data-appsleuth-track")
                or attrs.get("data-track")
                or attrs.get("aria-label")
                or label
                or attrs.get("id")
                or "Button"
            )
            # Clean label
            track_label = re.sub(r"\s+", " ", track_label)[:40]
            self.buttons.append({
                "id": attrs.get("id", ""),
                "label": track_label,
                "type": "button",
                "track": attrs.get("data-appsleuth-track") or attrs.get("data-track")
            })

    def handle_data(self, data: str):
        if self._in_title:
            self.title += data.strip()
        elif self._in_button:
            self._current_button_text.append(data)
        elif self._in_script:
            self._current_script.append(data)


class WebPageAnalysis:
    def __init__(self, raw_html: str, url: str):
        self.url = url
        self.parsed_url = urlparse(url)
        self.path = self.parsed_url.path or "/"

        parser = PageContentParser(base_url=url)
        parser.feed(raw_html)

        self.title = parser.title or "Web Application"
        self.buttons = parser.buttons
        self.forms = parser.forms
        self.standalone_inputs = getattr(parser, "standalone_inputs", [])
        self.links = parser.links
        self.scripts = parser.scripts

        self.api_endpoints = self._extract_api_endpoints()
        self.detected_workflow = self._classify_workflow()

    def _extract_api_endpoints(self) -> List[Dict[str, str]]:
        endpoints = []
        seen = set()

        # Check form actions
        for form in self.forms:
            action = form.get("action", "")
            if action and not action.startswith("#"):
                method = form.get("method", "POST")
                key = f"{method}:{action}"
                if key not in seen:
                    endpoints.append({"method": method, "path": action, "source": "form_action"})
                    seen.add(key)

        # Regex scan scripts for fetch('/api/...'), axios.post('...'), etc.
        fetch_pattern = re.compile(r"""fetch\s*\(\s*['"`]([^'"`]+)['"`]\s*(?:,\s*\{[^}]*method:\s*['"`]([A-Z]+)['"`])?""", re.IGNORECASE)
        axios_pattern = re.compile(r"""axios\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]""", re.IGNORECASE)

        for script in self.scripts:
            # fetch
            for match in fetch_pattern.finditer(script):
                path = match.group(1)
                method = (match.group(2) or "GET").upper()
                if not path.startswith("data:"):
                    key = f"{method}:{path}"
                    if key not in seen:
                        endpoints.append({"method": method, "path": path, "source": "script_fetch"})
                        seen.add(key)

            # axios
            for match in axios_pattern.finditer(script):
                method = match.group(1).upper()
                path = match.group(2)
                key = f"{method}:{path}"
                if key not in seen:
                    endpoints.append({"method": method, "path": path, "source": "script_axios"})
                    seen.add(key)

        return endpoints

    def _classify_workflow(self) -> str:
        text_corpus = (
            self.title + " " + self.path + " " +
            " ".join(b["label"] for b in self.buttons) + " " +
            " ".join(f.get("action", "") for f in self.forms)
        ).lower()

        if any(w in text_corpus for w in ["checkout", "cart", "pay", "order", "purchase", "billing"]):
            return "ECommerceCheckout"
        elif any(w in text_corpus for w in ["login", "signin", "auth", "password", "authenticate"]):
            return "UserAuthentication"
        elif any(w in text_corpus for w in ["signup", "register", "join", "create account"]):
            return "UserRegistration"
        elif any(w in text_corpus for w in ["search", "query", "filter", "find"]):
            return "SearchAndFilter"
        elif any(w in text_corpus for w in ["contact", "feedback", "support", "ticket"]):
            return "ContactSubmission"
        return "InteractiveWebFlow"
