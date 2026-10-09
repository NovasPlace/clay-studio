"""Preview and standalone export server. Python standard library.

Local-only by default. To reach it from other computers on your network, set CLAY_HOST=0.0.0.0 (or pass
--host 0.0.0.0), and set CLAY_PASSWORD so not everyone on the network can edit. Settings:
  CLAY_HOST / --host        address to listen on (default 127.0.0.1)
  CLAY_PORT / --port / arg  port (default 8920)
  CLAY_DATA / --data        folder for saved pages (default: this folder)
  CLAY_PASSWORD             ask for this password (any user name); CLAY_PASSWORD_FILE reads it from a file
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
import argparse
import base64
import binascii
import hashlib
import hmac
import ipaddress
import json
import os
import signal
import socket

ROOT = Path(__file__).resolve().parent


def settings(argv=None):
    p = argparse.ArgumentParser(description='Clay Studio preview and export server')
    p.add_argument('port', nargs='?', type=int, help='port (same as --port)')
    p.add_argument('--port', dest='port_opt', type=int, metavar='PORT', help='port to listen on (CLAY_PORT, default 8920)')
    p.add_argument('--host', default=os.environ.get('CLAY_HOST', '127.0.0.1'), help='address to listen on; 0.0.0.0 for your network (CLAY_HOST, default 127.0.0.1)')
    p.add_argument('--data', default=os.environ.get('CLAY_DATA', str(ROOT)), help='folder for saved pages (CLAY_DATA, default: this folder)')
    a = p.parse_args(argv)
    a.port = a.port_opt or a.port or int(os.environ.get('CLAY_PORT', '8920'))
    password = os.environ.get('CLAY_PASSWORD', '')
    if os.environ.get('CLAY_PASSWORD_FILE'):
        password = Path(os.environ['CLAY_PASSWORD_FILE']).read_text(encoding='utf-8').strip()
    a.password = password
    a.data = Path(a.data).resolve()
    return a


def loopback(host):
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host == 'localhost'


class Handler(SimpleHTTPRequestHandler):
    port = 8920
    data = ROOT
    password = ''
    local = True

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # Saved pages live in the data folder; everything else is the app itself.
    def translate_path(self, path):
        if urlsplit(path).path.startswith('/exports/'):
            app, self.directory = self.directory, str(self.data)
            try:
                return super().translate_path(path)
            finally:
                self.directory = app
        return super().translate_path(path)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        if urlsplit(self.path).path.startswith('/exports/'):
            if parse_qs(urlsplit(self.path).query).get('download') == ['1']:
                self.send_header('Content-Disposition', 'attachment; filename="clay-page.html"')
        super().end_headers()

    # A local server only answers to its own name, so another website can't reach it by pointing a hostname at 127.0.0.1.
    def host_ok(self):
        host = (self.headers.get('Host') or '').strip().lower()
        return not self.local or host in (f'127.0.0.1:{self.port}', f'localhost:{self.port}', f'[::1]:{self.port}')

    def authorized(self):
        if not self.password:
            return True
        scheme, _, value = (self.headers.get('Authorization') or '').partition(' ')
        if scheme.lower() != 'basic':
            return False
        try:
            given = base64.b64decode(value.strip(), validate=True).decode('utf-8').partition(':')[2]
        except (binascii.Error, UnicodeDecodeError):
            return False
        return hmac.compare_digest(given.encode('utf-8'), self.password.encode('utf-8'))

    def allowed(self):
        if not self.host_ok():
            self.send_error(421, 'This server answers to its own address only')
            return False
        if not self.authorized():
            self.send_response(401)
            self.send_header('WWW-Authenticate', 'Basic realm="Clay Studio", charset="UTF-8"')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return False
        return True

    def do_POST(self):
        if not self.allowed():
            return
        if self.path != '/api/export':
            return self.send_error(404)
        # only the editor itself, opened from this server under whatever address, may save pages
        if urlsplit(self.headers.get('Origin') or '').netloc.lower() != (self.headers.get('Host') or '').lower():
            return self.send_error(403, 'Export from this editor only')
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
            folder = self.data / 'exports'
            folder.mkdir(parents=True, exist_ok=True)
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
        path = urlsplit(self.path).path
        # for container health checks: says nothing, needs no password
        if path == '/healthz':
            body = b'ok\n'
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if not self.allowed():
            return
        if path == '/':
            self.send_response(302)
            self.send_header('Location', '/index.html')
            self.end_headers()
            return
        super().do_GET()

    def do_HEAD(self):
        if self.allowed():
            super().do_HEAD()

    def log_request(self, code='-', size='-'):
        if urlsplit(self.path).path != '/healthz':
            super().log_request(code, size)


def address_for_people(host, port):
    if loopback(host):
        return f'http://127.0.0.1:{port}/'
    if host not in ('0.0.0.0', '::'):
        return f'http://{host}:{port}/'
    if Path('/.dockerenv').exists():
        return f"http://<this server's address>:{port}/"
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(('10.255.255.255', 1))
            return f'http://{s.getsockname()[0]}:{port}/'
    except OSError:
        return f"http://<this computer's address>:{port}/"


def main(argv=None):
    a = settings(argv)
    Handler.port, Handler.data, Handler.password, Handler.local = a.port, a.data, a.password, loopback(a.host)
    family = socket.AF_INET6 if ':' in a.host else socket.AF_INET
    server = type('Server', (ThreadingHTTPServer,), {'address_family': family})((a.host, a.port), Handler)
    print(f'Clay Studio: {address_for_people(a.host, a.port)}', flush=True)
    if not Handler.local and not a.password:
        print('Anyone on your network can open and edit this. Set CLAY_PASSWORD to ask for a password.', flush=True)
    print(f'Saved pages go to {a.data / "exports"}. Ctrl+C stops the server.', flush=True)
    # in a container the server is process 1, which ignores a stop request unless it says what to do with it
    signal.signal(signal.SIGTERM, stop)
    try:
        server.serve_forever()
    except (KeyboardInterrupt, SystemExit):
        print('Stopped.', flush=True)


def stop(*_):
    raise SystemExit(0)


if __name__ == '__main__':
    main()
