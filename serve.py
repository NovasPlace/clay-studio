"""Clay Studio's server: your pages, the editor, and standalone exports. Python standard library.

Local-only by default. To reach it from other computers on your network, set CLAY_HOST=0.0.0.0 (or pass
--host 0.0.0.0), and set CLAY_PASSWORD so not everyone on the network can edit. Settings:
  CLAY_HOST / --host        address to listen on (default 127.0.0.1)
  CLAY_PORT / --port / arg  port (default 8920)
  CLAY_DATA / --data        folder for your pages and exports (default: the data folder here)
  CLAY_PASSWORD             ask for this password (any user name); CLAY_PASSWORD_FILE reads it from a file

The data folder holds pages/<name>/ (the page, its saved work and its title), trash/ (deleted pages, until you
empty it yourself) and exports/ (standalone pages saved from the editor).
"""
from datetime import datetime, timezone
from html import escape
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
import re
import shutil
import signal
import socket
import threading
import unicodedata

ROOT = Path(__file__).resolve().parent
NAME = re.compile(r'^[a-z0-9][a-z0-9-]{0,47}$')
BINNED = re.compile(r'^([a-z0-9][a-z0-9-]{0,47})--(\d{14})$')
RUNTIME = {'studio.js', 'sculpt-core.js', 'relations.js', 'sculpt.js', 'sculpt-ui.css'}
STARTERS = {'blank': ROOT / 'starters' / 'blank.html', 'sample': ROOT / 'index.html'}
TITLE = re.compile(r'<title>.*?</title>', re.I | re.S)
LOCK = threading.Lock()


def settings(argv=None):
    p = argparse.ArgumentParser(description='Clay Studio server: your pages, the editor and exports')
    p.add_argument('port', nargs='?', type=int, help='port (same as --port)')
    p.add_argument('--port', dest='port_opt', type=int, metavar='PORT', help='port to listen on (CLAY_PORT, default 8920)')
    p.add_argument('--host', default=os.environ.get('CLAY_HOST', '127.0.0.1'), help='address to listen on; 0.0.0.0 for your network (CLAY_HOST, default 127.0.0.1)')
    p.add_argument('--data', default=os.environ.get('CLAY_DATA', str(ROOT / 'data')), help='folder for your pages and exports (CLAY_DATA, default: the data folder here)')
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


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def write(path, text):
    """Whole or not at all: a crash mid-save never leaves half a file."""
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_text(text, encoding='utf-8')
    os.replace(tmp, path)


def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return default


def clean_title(value):
    title = ' '.join(''.join(c for c in str(value) if unicodedata.category(c)[0] != 'C').split())[:80]
    return title or 'Untitled page'


def name_for(title, taken):
    base = unicodedata.normalize('NFKD', title).encode('ascii', 'ignore').decode().lower()
    base = re.sub(r'[^a-z0-9]+', '-', base).strip('-')[:40].strip('-') or 'page'
    name, n = base, 2
    while name in taken:
        name, n = f'{base}-{n}', n + 1
    return name


def retitle(html, title):
    tag = f'<title>{escape(title)}</title>'
    return TITLE.sub(lambda m: tag, html, count=1) if TITLE.search(html) else html.replace('</head>', tag + '</head>', 1)


class Handler(SimpleHTTPRequestHandler):
    port = 8920
    data = ROOT / 'data'
    password = ''
    local = True

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    @property
    def pages(self):
        return self.data / 'pages'

    # Exports are served from the data folder. Pages and the trash are never served as files: a page opens through
    # /p/<name>/, and its saved work only travels with it.
    def translate_path(self, path):
        if urlsplit(path).path.startswith('/exports/'):
            app, self.directory = self.directory, str(self.data)
            try:
                return super().translate_path(path)
            finally:
                self.directory = app
        found = Path(super().translate_path(path)).resolve()
        if found.is_relative_to(self.pages) or found.is_relative_to(self.data / 'trash'):
            return str(ROOT / '.nothing-here')
        return str(found)

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

    # Changes come only from Clay itself, opened from this server under whatever address.
    def same_origin(self):
        if urlsplit(self.headers.get('Origin') or '').netloc.lower() != (self.headers.get('Host') or '').lower():
            self.send_error(403, "Changes come from this server's own pages only")
            return False
        return True

    def body(self, limit):
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            self.send_error(415)
            return None
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            length = -1
        if not 0 < length <= limit:
            self.send_error(413)
            return None
        try:
            value = json.loads(self.rfile.read(length))
        except ValueError:
            value = None
        if not isinstance(value, dict):
            self.send_error(400, 'Expected a JSON object')
            return None
        return value

    def send_json(self, code, value):
        data = json.dumps(value).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_text(self, code, text, kind='text/html; charset=utf-8'):
        data = text.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def redirect(self, where):
        self.send_response(302)
        self.send_header('Location', where)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def page_dir(self, name):
        if not NAME.match(name or ''):
            return None
        folder = self.pages / name
        return folder if (folder / 'page.html').is_file() else None

    def listing(self):
        out = []
        if self.pages.is_dir():
            for folder in self.pages.iterdir():
                meta = read_json(folder / 'meta.json')
                if NAME.match(folder.name) and meta and (folder / 'page.html').is_file():
                    out.append({'name': folder.name, 'title': meta.get('title', folder.name), 'created': meta.get('created'), 'updated': meta.get('updated'), 'url': f'/p/{folder.name}/'})
        return sorted(out, key=lambda p: p['updated'] or '', reverse=True)

    # A page opens with its saved work inside it, so the editor restores it at once, the same way it does from the browser.
    def open_page(self, folder):
        meta, state = read_json(folder / 'meta.json', {}), read_json(folder / 'state.json', {})
        saved = {'api': f'/api/pages/{folder.name}/state', 'pages': '/', 'title': meta.get('title'), 'rev': state.get('rev', 0), 'page': state.get('page'), 'steps': state.get('steps')}
        tag = '<script type="application/json" id="clay-saved" data-clay-runtime>' + json.dumps(saved).replace('<', '\\u003c') + '</script>'
        html = (folder / 'page.html').read_text(encoding='utf-8')
        at = html.lower().find('</head>')
        self.send_text(200, html[:at] + tag + html[at:] if at >= 0 else tag + html)

    def do_GET(self):
        path = urlsplit(self.path).path
        # for container health checks: says nothing, needs no password
        if path == '/healthz':
            return self.send_text(200, 'ok\n', 'text/plain')
        if not self.allowed():
            return
        if path == '/':
            return self.redirect('/pages.html')
        if path == '/api/pages':
            return self.send_json(200, self.listing())
        m = re.match(r'^/p/([^/]+)(/(.*))?$', path)
        if m:
            folder = self.page_dir(m.group(1))
            if not folder:
                return self.send_error(404, 'No page by that name')
            if m.group(2) is None:
                return self.redirect(f'/p/{m.group(1)}/')
            if m.group(3) == '':
                return self.open_page(folder)
            if m.group(3) in RUNTIME:
                self.path = '/' + m.group(3)
                return super().do_GET()
            return self.send_error(404)
        super().do_GET()

    def do_HEAD(self):
        if self.allowed():
            super().do_HEAD()

    def do_POST(self):
        if not self.allowed() or not self.same_origin():
            return
        path = urlsplit(self.path).path
        if path == '/api/export':
            return self.export()
        if path == '/api/pages':
            return self.create()
        m = re.match(r'^/api/trash/([^/]+)/restore$', path)
        if m:
            return self.restore(m.group(1))
        self.send_error(404)

    def do_PUT(self):
        if not self.allowed() or not self.same_origin():
            return
        m = re.match(r'^/api/pages/([^/]+)/state$', urlsplit(self.path).path)
        if not m:
            return self.send_error(404)
        folder = self.page_dir(m.group(1))
        if not folder:
            return self.send_error(404, 'No page by that name')
        value = self.body(40 * 1024 * 1024)
        if value is None:
            return
        if not isinstance(value.get('rev'), int) or any(k in value and value[k] is not None and not isinstance(value[k], str) for k in ('page', 'steps')):
            return self.send_error(400, 'Expected rev, and page and steps as text')
        # whoever saved last from an older copy is told, instead of overwriting newer work from another device
        with LOCK:
            state = read_json(folder / 'state.json', {})
            if value['rev'] != state.get('rev', 0):
                return self.send_json(409, {'rev': state.get('rev', 0)})
            for k in ('page', 'steps'):
                if k in value:
                    state[k] = value[k]
            state['rev'] = state.get('rev', 0) + 1
            write(folder / 'state.json', json.dumps(state))
            meta = read_json(folder / 'meta.json', {})
            meta['updated'] = now()
            write(folder / 'meta.json', json.dumps(meta))
        self.send_json(200, {'rev': state['rev']})

    def do_PATCH(self):
        if not self.allowed() or not self.same_origin():
            return
        m = re.match(r'^/api/pages/([^/]+)$', urlsplit(self.path).path)
        folder = m and self.page_dir(m.group(1))
        if not folder:
            return self.send_error(404, 'No page by that name')
        value = self.body(64 * 1024)
        if value is None:
            return
        if 'title' not in value:
            return self.send_error(400, 'Expected a title')
        title = clean_title(value['title'])
        with LOCK:
            meta = read_json(folder / 'meta.json', {})
            meta.update(title=title, updated=now())
            write(folder / 'meta.json', json.dumps(meta))
            write(folder / 'page.html', retitle((folder / 'page.html').read_text(encoding='utf-8'), title))
        self.send_json(200, {'name': folder.name, 'title': title})

    # Deleting moves a page to the trash, from where it can come back.
    def do_DELETE(self):
        if not self.allowed() or not self.same_origin():
            return
        m = re.match(r'^/api/pages/([^/]+)$', urlsplit(self.path).path)
        folder = m and self.page_dir(m.group(1))
        if not folder:
            return self.send_error(404, 'No page by that name')
        with LOCK:
            binned = f'{folder.name}--{datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")}'
            (self.data / 'trash').mkdir(parents=True, exist_ok=True)
            while (self.data / 'trash' / binned).exists():
                binned = binned[:-1] + str((int(binned[-1]) + 1) % 10)
            shutil.move(str(folder), str(self.data / 'trash' / binned))
        self.send_json(200, {'trash': binned})

    def create(self):
        value = self.body(64 * 1024)
        if value is None:
            return
        start = str(value.get('from', 'blank'))
        with LOCK:
            taken = {p.name for p in self.pages.iterdir()} if self.pages.is_dir() else set()
            if start.startswith('copy:'):
                source = self.page_dir(start[5:])
                if not source:
                    return self.send_error(404, 'No page by that name to copy')
                title = clean_title(value.get('title') or read_json(source / 'meta.json', {}).get('title', source.name) + ' (copy)')
                html = (source / 'page.html').read_text(encoding='utf-8')
                state = read_json(source / 'state.json', {})
                state['rev'] = 0
            elif start in STARTERS:
                title = clean_title(value.get('title', ''))
                html, state = STARTERS[start].read_text(encoding='utf-8'), None
            else:
                return self.send_error(400, 'Start from blank, sample or copy:<page>')
            name = name_for(title, taken)
            folder = self.pages / name
            folder.mkdir(parents=True)
            write(folder / 'page.html', retitle(html, title))
            if state:
                write(folder / 'state.json', json.dumps(state))
            write(folder / 'meta.json', json.dumps({'title': title, 'created': now(), 'updated': now()}))
        self.send_json(201, {'name': name, 'title': title, 'url': f'/p/{name}/'})

    def restore(self, binned):
        m = BINNED.match(binned)
        source = self.data / 'trash' / binned
        if not m or not (source / 'page.html').is_file():
            return self.send_error(404, 'Nothing in the trash by that name')
        with LOCK:
            taken = {p.name for p in self.pages.iterdir()} if self.pages.is_dir() else set()
            name = m.group(1) if m.group(1) not in taken else name_for(m.group(1), taken)
            self.pages.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(self.pages / name))
        self.send_json(200, {'name': name, 'url': f'/p/{name}/'})

    def export(self):
        value = self.body(32 * 1024 * 1024)
        if value is None:
            return
        html = value.get('html')
        if not isinstance(html, str) or not html.lower().startswith('<!doctype html>'):
            return self.send_error(400, 'A standalone HTML document is required')
        try:
            data = html.encode('utf-8')
            name = 'page-' + hashlib.sha256(data).hexdigest()[:16] + '.html'
            folder = self.data / 'exports'
            folder.mkdir(parents=True, exist_ok=True)
            (folder / name).write_bytes(data)
        except OSError:
            return self.send_error(500, 'Could not write the exported page')
        self.send_json(201, {'url': '/exports/' + name})

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
    a.data.mkdir(parents=True, exist_ok=True)
    family = socket.AF_INET6 if ':' in a.host else socket.AF_INET
    server = type('Server', (ThreadingHTTPServer,), {'address_family': family})((a.host, a.port), Handler)
    print(f'Clay Studio: {address_for_people(a.host, a.port)}', flush=True)
    if not Handler.local and not a.password:
        print('Anyone on your network can open and edit this. Set CLAY_PASSWORD to ask for a password.', flush=True)
    print(f'Your pages are kept in {a.data}. Ctrl+C stops the server.', flush=True)
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
