"""
Argus Diagnostic Engine — Lightweight HTTP Server

Provides an instant REST API for web widgets, mobile applications, and CI/CD pipelines
to submit graphs and queries and receive real-time behavioral diagnoses.

Endpoint:
  POST /api/diagnose
  Body: {
    "expected": { ... },    # Optional: Argus Expected Behavioral Graph (defaults to local expected_graph.json if omitted)
    "actual": { ... },      # Required: Observed Execution Graph
    "query": "..."          # Optional: User problem description
  }
"""

import sys
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from dataclasses import asdict
from pathlib import Path

from comparator import compare_graphs
from reasoner import diagnose

DEFAULT_PORT = 7890

class DiagnosticRequestHandler(BaseHTTPRequestHandler):
    def _set_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self._set_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self._set_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "healthy", "service": "Argus Diagnostic Engine"}).encode("utf-8"))
        else:
            self.send_response(200)
            self._set_cors_headers()
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Argus Diagnostic Engine is running. Send POST to /api/diagnose.")

    def do_POST(self):
        if self.path in ["/api/diagnose", "/diagnose"]:
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length == 0:
                self.send_error(400, "Missing JSON payload")
                return

            try:
                body = self.rfile.read(content_length)
                data = json.loads(body.decode("utf-8"))

                actual_graph = data.get("actual")
                if not actual_graph:
                    self.send_error(400, "Missing 'actual' execution graph in request body")
                    return

                # If expected graph not provided, look for local default
                expected_graph = data.get("expected")
                if not expected_graph:
                    default_exp = Path("spec/expected_graph.json")
                    if default_exp.exists():
                        with open(default_exp, "r", encoding="utf-8") as f:
                            expected_graph = json.load(f)
                    else:
                        self.send_error(400, "No 'expected' graph provided and local spec/expected_graph.json not found")
                        return

                user_query = data.get("query", "")
                report = compare_graphs(expected_graph, actual_graph)
                result = diagnose(report, user_query=user_query)

                response_payload = json.dumps({
                    "success": True,
                    "diagnosis": asdict(result),
                    "report": {
                        "diverged": report.diverged,
                        "type": report.divergence_type,
                        "divergenceNodeId": report.divergence_node_id,
                        "divergenceNodeLabel": report.divergence_node_label,
                        "matchedFailurePath": report.matched_failure_path,
                        "confidence": report.confidence
                    }
                }, indent=2)

                self.send_response(200)
                self._set_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(response_payload.encode("utf-8"))

            except Exception as e:
                self.send_response(500)
                self._set_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
        else:
            self.send_error(404, "Endpoint not found")

def start_server(port: int = DEFAULT_PORT):
    server_address = ("", port)
    httpd = HTTPServer(server_address, DiagnosticRequestHandler)
    print(f"[*] Argus Diagnostic Engine HTTP server listening on http://localhost:{port}")
    print(f"[*] Ready to accept POST requests at http://localhost:{port}/api/diagnose")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] Server stopping...")
        httpd.server_close()

if __name__ == "__main__":
    port = DEFAULT_PORT
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
    start_server(port)
