"""Serves the font build endpoint locally. Vite proxies /api here during development."""
import importlib.util
import os
from http.server import ThreadingHTTPServer

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "build.py")
spec = importlib.util.spec_from_file_location("api_build", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

print("Font build API on http://127.0.0.1:8787")
ThreadingHTTPServer(("127.0.0.1", 8787), module.handler).serve_forever()
