"""Local-only preview and standalone export server. Python standard library."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8920

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        if urlsplit(self.path).path.startswith('/exports/'):
            if parse_qs(urlsplit(self.path).query).get('download') == ['1']:
                self.send_header('Content-Disposition', 'attachment; filename="clay-page.html"')
        super().end_headers()

    def do_POST(self):
        if self.path != '/api/export':
            return self.send_error(404)
        allowed = {f'http://127.0.0.1:{PORT}', f'http://localhost:{PORT}'}
        if self.headers.get('Origin') not in allowed:
            return self.send_error(403, 'Export from the local editor only')
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.send_error(415)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 12 * 1024 * 1024:
                return self.send_error(413)
            value = json.loads(self.rfile.read(length))
            html = value['html']
            if not isinstance(html, str) or not html.lower().startswith('<!doctype html>'):
                return self.send_error(400, 'A standalone HTML document is required')
            data = html.encode('utf-8')
            name = 'page-' + hashlib.sha256(data).hexdigest()[:16] + '.html'
            folder = ROOT / 'exports'
            folder.mkdir(exist_ok=True)
            (folder / name).write_bytes(data)
            result = json.dumps({'url': '/exports/' + name}).encode('utf-8')
            self.send_response(201)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(result)))
            self.end_headers()
            self.wfile.write(result)
        except (ValueError, KeyError, TypeError):
            self.send_error(400, 'Invalid export')
        except OSError:
            self.send_error(500, 'Could not write the exported page')

    def do_GET(self):
        if urlsplit(self.path).path == '/':
            self.send_response(302)
            self.send_header('Location', '/index.html')
            self.end_headers()
            return
        super().do_GET()

if __name__ == '__main__':
    print(f'Clay Studio: http://127.0.0.1:{PORT}/', flush=True)
    print('Saved pages appear in the exports folder. Ctrl+C stops the server.', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
