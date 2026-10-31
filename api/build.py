"""POST /api/build: turns an export bundle into font files.

Vercel runs this as a Python serverless function; scripts/dev_api.py serves the
same handler locally.
"""
import base64
import json
import os
import sys
import traceback
import zlib
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from fontbuild.build import BundleError, build_font  # noqa: E402

# Vercel rejects request bodies over 4.5 MB.
MAX_BODY = 4_400_000
MAX_UNZIPPED = 30_000_000


class handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY:
                return self._send(413, {"error": "These drawings are too large to send. Try fewer glyphs."})
            raw = self.rfile.read(length)
            if self.headers.get("X-Bundle-Encoding") == "gzip":
                # Limit the output so a small upload can't expand without bound.
                unzip = zlib.decompressobj(wbits=31)
                raw = unzip.decompress(raw, MAX_UNZIPPED)
                if unzip.unconsumed_tail:
                    return self._send(413, {"error": "These drawings are too large to build."})
            result = build_font(json.loads(raw))
            self._send(
                200,
                {
                    "ttf": base64.b64encode(result["ttf"]).decode(),
                    "woff2": base64.b64encode(result["woff2"]).decode(),
                    "report": result["report"],
                },
            )
        except (BundleError, zlib.error, ValueError, KeyError, TypeError) as e:
            message = str(e) if isinstance(e, BundleError) else "That export couldn't be read."
            self._send(400, {"error": message})
        except Exception:
            traceback.print_exc()
            self._send(500, {"error": "Something went wrong while building the font."})

    def log_message(self, *args):
        pass
