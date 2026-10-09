"""Clay Studio's server: your pages, the editor, and standalone exports. Python standard library.

Local-only by default. To reach it from other computers on your network, set CLAY_HOST=0.0.0.0 (or pass
--host 0.0.0.0), and set CLAY_PASSWORD so not everyone on the network can edit. Settings:
  CLAY_HOST / --host        address to listen on (default 127.0.0.1)
  CLAY_PORT / --port / arg  port (default 8920)
  CLAY_DATA / --data        folder for your pages and exports (default: the data folder here)
  CLAY_PASSWORD             ask for this password (any user name); CLAY_PASSWORD_FILE reads it from a file

The data folder holds pages/<name>/ (the page, its saved work and its title), trash/ (deleted pages, until you
empty it yourself), exports/ (standalone pages saved from the editor, and whole sites: a folder and a .zip each),
site.json (which page is the home page) and agent.json (the key agents use).

Agents (Claude Code, Codex, scripts) use /mcp (MCP over HTTP) or /api/agent/..., with the key as a bearer token. They
can list and make pages; to read or change one, it has to be open in an editor, which takes their changes as they come.
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
import secrets
import shutil
import signal
import socket
import threading
import time
import unicodedata
import zipfile

ROOT = Path(__file__).resolve().parent
NAME = re.compile(r'^[a-z0-9][a-z0-9-]{0,47}$')
BINNED = re.compile(r'^([a-z0-9][a-z0-9-]{0,47})--(\d{14})$')
RUNTIME = {'studio.js', 'sculpt-core.js', 'relations.js', 'sculpt.js', 'sculpt-ui.css', 'agent.js'}
STARTERS = {'blank': ROOT / 'starters' / 'blank.html', 'links': ROOT / 'starters' / 'links.html', 'sample': ROOT / 'index.html'}
TITLE = re.compile(r'<title>.*?</title>', re.I | re.S)
PAGE_LINK = re.compile(r'href="([a-z0-9][a-z0-9-]{0,47})\.html(?:#[^"]*)?"')
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
    # index is kept for the home page of an exported site
    while name in taken or name == 'index':
        name, n = f'{base}-{n}', n + 1
    return name


def retitle(html, title):
    tag = f'<title>{escape(title)}</title>'
    return TITLE.sub(lambda m: tag, html, count=1) if TITLE.search(html) else html.replace('</head>', tag + '</head>', 1)


class Channels:
    """Agents' requests for a page, waiting for an editor that has it open. An editor counts as open while it is waiting
    for requests, and for a little while after (it is busy between requests), until it says it has gone: its tab
    closed or was hidden. A page nobody has open is opened out of sight by a host: any Clay tab that is showing (the
    page list, or another page). That hidden editor gives way as soon as the person opens the page themselves."""
    PRESENT, EDITOR_WAIT, AGENT_WAIT, HOSTING = 35, 25, 30, 20

    def __init__(self):
        self.cond, self.pages, self.hosts = threading.Condition(), {}, {'queue': [], 'waiters': {}}

    def page(self, name):
        return self.pages.setdefault(name, {'queue': [], 'out': set(), 'answers': {}, 'editors': {}})

    def live(self, waiters, but=None):
        t = time.monotonic()
        return [e for e in waiters.values() if e is not but and not e['gone'] and (e['waiting'] or t - e['seen'] < self.PRESENT)]

    # open in an editor; by_person leaves out the ones opened out of sight
    def is_open(self, name, by_person=False):
        with self.cond:
            ch = self.pages.get(name)
            return bool(ch) and any(not (by_person and e['hosted']) for e in self.live(ch['editors']))

    def hosting(self):
        with self.cond:
            return bool(self.live(self.hosts['waiters']))

    def bye(self, name, editor):
        with self.cond:
            e = self.page(name)['editors'].get(editor)
            if e:
                e['gone'] = True
                self.cond.notify_all()

    def host_bye(self, host):
        with self.cond:
            h = self.hosts['waiters'].get(host)
            if h:
                h['gone'] = True
                self.cond.notify_all()

    # for an agent: hand the request over and wait for the editor's answer. None if no editor has the page open and no
    # host could open it; False if the editor didn't answer in time.
    def ask(self, name, request):
        request = {**request, 'id': secrets.token_hex(8)}
        with self.cond:
            if not self.is_open(name):
                if not self.hosting():
                    return None
                summons = {'open': name, 'as': request.get('as')}
                self.hosts['queue'].append(summons)
                self.cond.notify_all()
                opened = self.cond.wait_for(lambda: self.is_open(name), self.HOSTING)
                if summons in self.hosts['queue']:
                    self.hosts['queue'].remove(summons)
                if not opened:
                    return None
            ch = self.page(name)
            ch['queue'].append(request)
            self.cond.notify_all()
            if self.cond.wait_for(lambda: request['id'] in ch['answers'], self.AGENT_WAIT):
                return ch['answers'].pop(request['id'])
            if request in ch['queue']:
                ch['queue'].remove(request)
            ch['out'].discard(request['id'])
            return False

    # for an editor: the next request, waiting a while for one. One opened out of sight is told to close once the
    # person has the page open; requests go to the person's.
    def next(self, name, editor, wait, hosted=False):
        with self.cond:
            ch, t = self.page(name), time.monotonic()
            for k in [k for k, e in ch['editors'].items() if not e['waiting'] and (e['gone'] or t - e['seen'] > 600)]:
                del ch['editors'][k]
            e = ch['editors'].setdefault(editor, {'waiting': 0, 'seen': t, 'gone': False, 'hosted': hosted})
            e.update(gone=False, waiting=e['waiting'] + 1, seen=t, hosted=hosted)
            # an agent may be waiting for this page to open; one opened out of sight may have to give way to this one
            self.cond.notify_all()
            person = lambda: hosted and any(not x['hosted'] for x in self.live(ch['editors'], but=e))
            try:
                self.cond.wait_for(lambda: e['gone'] or person() or ch['queue'], wait)
                if person():
                    e['gone'] = True
                    return {'close': True}
                if e['gone'] or not ch['queue']:
                    return None
                request = ch['queue'].pop(0)
                ch['out'].add(request['id'])
                return request
            finally:
                e['waiting'] -= 1
                e['seen'] = time.monotonic()

    # for a host: the next page to open for an agent, waiting a while for one
    def next_host(self, host, wait):
        with self.cond:
            hs, t = self.hosts, time.monotonic()
            for k in [k for k, h in hs['waiters'].items() if not h['waiting'] and (h['gone'] or t - h['seen'] > 600)]:
                del hs['waiters'][k]
            h = hs['waiters'].setdefault(host, {'waiting': 0, 'seen': t, 'gone': False})
            h.update(gone=False, waiting=h['waiting'] + 1, seen=t)
            try:
                self.cond.wait_for(lambda: hs['queue'] or h['gone'], wait)
                return None if h['gone'] or not hs['queue'] else hs['queue'].pop(0)
            finally:
                h['waiting'] -= 1
                h['seen'] = time.monotonic()

    def answer(self, name, rid, value):
        with self.cond:
            ch = self.page(name)
            if rid not in ch['out']:
                return False
            ch['out'].discard(rid)
            ch['answers'][rid] = value
            self.cond.notify_all()
            return True


CHANNELS = Channels()
SESSIONS = {}
ACTIONS = '''Each action is an object with "do", and pieces are named by the ids clay_read_page gives:
- {"do":"place","piece":id,"x":px,"y":px,"width":px,"height":px,"size":px} moves or resizes a piece or group; give only what changes. size is the letter size of a text piece.
- {"do":"text","piece":id,"part":n,"text":"..."} changes words. A piece with several parts (a card's label, title and words; a menu's links) needs "part".
- {"do":"link","piece":id,"part":n,"to":"page:<name>" | "#<id>" | "https://..." | "192.168.1.20:8096"} points a button, card or link somewhere.
- {"do":"add","kind":"text"|"card"|"button"|"image","like":id,"id":"new-id","x":px,"y":px,"width":px,"text":"...","parts":["..."],"to":"...","src":"https://...","alt":"..."} adds a piece. "like" copies the look of an existing piece (best for matching the page's style), and then kind can be left out.
- {"do":"remove","piece":id}
- {"do":"paint","piece":id,"fill":"#ffd66b","text":"#24323c"} colours a piece's background, its words, or both.
- {"do":"pin","piece":id,"pinned":true|false} pinned pieces stay put when the person sculpts.
- {"do":"group","pieces":[id,...]} sticks pieces together; they move as one and stay together on phones. {"do":"ungroup","piece":id}
- {"do":"canvas","height":px} makes the page taller or shorter; asked to be shorter than its pieces, it ends just below the lowest one.
All the actions in one call are one step in the person's history (one Undo), and either all happen or none do.'''
MCP_TOOLS = [
    {'name': 'clay_pages', 'description': 'List the pages in Clay Studio: name, title, whether the person has it open right now, and which is the home page.',
     'inputSchema': {'type': 'object', 'properties': {}}},
    {'name': 'clay_new_page', 'description': 'Make a new page. It starts from "blank" (a heading, words, a button, two cards and a picture), "links" (a card per self-hosted app) or "sample" (the Clay demo page). You can then read and change it.',
     'inputSchema': {'type': 'object', 'properties': {'title': {'type': 'string'}, 'start': {'type': 'string', 'enum': ['blank', 'links', 'sample']}}, 'required': ['title']}},
    {'name': 'clay_read_page', 'description': 'Read a page: every piece with its id, kind, position and size in pixels on the desktop canvas, its words (in parts, for cards and menus), links and colours. The person may be changing it too, so read it again before a new round of changes.',
     'inputSchema': {'type': 'object', 'properties': {'page': {'type': 'string', 'description': 'The page name from clay_pages'}}, 'required': ['page']}},
    {'name': 'clay_change_page', 'description': 'Change a page. If the person has it open they see each change appear as you make it, labelled with your name and what you said; either way it goes into the page\'s history, where they can undo it. Returns the page as it is afterwards, and warns about pieces that overlap.\n' + ACTIONS,
     'inputSchema': {'type': 'object', 'properties': {'page': {'type': 'string'}, 'say': {'type': 'string', 'description': 'A few words for the person, saying what you did, like "made the cards three across"'},
                                                      'actions': {'type': 'array', 'items': {'type': 'object', 'properties': {'do': {'type': 'string', 'enum': ['place', 'text', 'link', 'add', 'remove', 'paint', 'pin', 'group', 'ungroup', 'canvas']}}, 'required': ['do']}}},
                     'required': ['page', 'actions']}},
]
MCP_ABOUT = ('Clay Studio is a web page editor where a person shapes pages by hand. You can work on the same pages with them: '
             'list the pages, make new ones, read one, and change it with small steps the person sees as they happen and can undo. '
             'Clay has to be open in the person\'s browser (any page, or the page list) for you to read or change pages; '
             'pages they don\'t have open are opened out of sight. If Clay isn\'t open, you are told what to ask them.')


def agent_name(client):
    name = str(client or '').strip()
    return 'Claude' if 'claude' in name.lower() else 'Codex' if 'codex' in name.lower() else (name[:30] or 'An agent')


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

    # Exports are served from the data folder, and nothing else in it is served as a file: a page opens through
    # /p/<name>/, its saved work only travels with it, and the agent key stays put.
    def translate_path(self, path):
        if urlsplit(path).path.startswith('/exports/'):
            app, self.directory = self.directory, str(self.data)
            try:
                return super().translate_path(path)
            finally:
                self.directory = app
        found = Path(super().translate_path(path)).resolve()
        if found.is_relative_to(self.data):
            return str(ROOT / '.nothing-here')
        return str(found)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        if urlsplit(self.path).path.startswith('/exports/'):
            if urlsplit(self.path).path.endswith('.zip'):
                self.send_header('Content-Disposition', 'attachment; filename="clay-site.zip"')
            elif parse_qs(urlsplit(self.path).query).get('download') == ['1']:
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

    # Agents come in with the key from the editor's Agent dialog instead of the password; a browser can't send it.
    def for_agents(self):
        path = urlsplit(self.path).path
        return path == '/mcp' or path.startswith('/api/agent/')

    def agent_key(self, new=False):
        with LOCK:
            key = None if new else read_json(self.data / 'agent.json', {}).get('key')
            if not key:
                key = secrets.token_urlsafe(24)
                write(self.data / 'agent.json', json.dumps({'key': key}))
            return key

    def agent_ok(self):
        scheme, _, value = (self.headers.get('Authorization') or '').partition(' ')
        return scheme.lower() == 'bearer' and hmac.compare_digest(value.strip().encode('utf-8'), self.agent_key().encode('utf-8'))

    def allowed(self):
        if not self.host_ok():
            self.send_error(421, 'This server answers to its own address only')
            return False
        if self.for_agents():
            if self.agent_ok():
                return True
            self.send_response(401)
            self.send_header('WWW-Authenticate', 'Bearer realm="Clay Studio"')
            self.send_header('Content-Length', '0')
            self.end_headers()
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
        out, home = [], read_json(self.data / 'site.json', {}).get('home')
        if self.pages.is_dir():
            for folder in self.pages.iterdir():
                meta = read_json(folder / 'meta.json')
                if NAME.match(folder.name) and meta and (folder / 'page.html').is_file():
                    out.append({'name': folder.name, 'title': meta.get('title', folder.name), 'created': meta.get('created'), 'updated': meta.get('updated'), 'url': f'/p/{folder.name}/', 'home': folder.name == home})
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
        if path == '/api/agent-key':
            return self.send_json(200, {'key': self.agent_key()})
        m = re.match(r'^/api/pages/([^/]+)/agent$', path)
        if m:
            return self.inbox(m.group(1))
        if path == '/api/host':
            return self.host()
        if path == '/api/agent/pages':
            return self.send_json(200, self.agent_pages())
        m = re.match(r'^/api/agent/pages/([^/]+)$', path)
        if m:
            return self.agent_reply(*self.agent_ask(m.group(1), {'read': True, 'as': self.headers.get('X-Clay-Agent-Name')}))
        if path == '/mcp':
            self.send_response(405)
            self.send_header('Allow', 'POST')
            self.send_header('Content-Length', '0')
            return self.end_headers()
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
        if not self.allowed():
            return
        path = urlsplit(self.path).path
        if self.for_agents():
            # a browser always says where it comes from; agents send nothing, and only pages of this server may send it
            if self.headers.get('Origin') and not self.same_origin():
                return
            if path == '/mcp':
                return self.mcp()
            if path == '/api/agent/pages':
                return self.create()
            m = re.match(r'^/api/agent/pages/([^/]+)$', path)
            if m:
                value = self.body(8 * 1024 * 1024)
                if value is None:
                    return
                return self.agent_reply(*self.agent_ask(m.group(1), {'actions': value.get('actions'), 'say': value.get('say'), 'as': value.get('as') or self.headers.get('X-Clay-Agent-Name')}))
            return self.send_error(404)
        # A closing tab says it has gone with a beacon, which comes with Origin "null" or none. At worst a stranger's would
        # make an agent wait for the editor's next call, within a second.
        m = re.match(r'^/api/pages/([^/]+)/agent/bye$', path) or re.match(r'^/api/host/bye$', path)
        if m and (self.headers.get('Origin') in (None, '', 'null') or self.same_origin()):
            if path == '/api/host/bye':
                CHANNELS.host_bye(self.editor_id(parse_qs(urlsplit(self.path).query), 'host'))
            else:
                CHANNELS.bye(m.group(1), self.editor_id(parse_qs(urlsplit(self.path).query)))
            return self.send_json(200, {})
        if m or not self.same_origin():
            return
        if path == '/api/agent-key':
            return self.send_json(200, {'key': self.agent_key(new=True)})
        m = re.match(r'^/api/pages/([^/]+)/agent/([0-9a-f]{16})$', path)
        if m:
            value = self.body(16 * 1024 * 1024)
            if value is None:
                return
            return self.send_json(200 if CHANNELS.answer(m.group(1), m.group(2), value) else 410, {})
        if path == '/api/export':
            return self.export()
        if path == '/api/site':
            return self.export_site()
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
        if not self.allowed():
            return
        # an MCP client ending its session: there is nothing to end
        if urlsplit(self.path).path == '/mcp':
            self.send_response(405)
            self.send_header('Allow', 'POST')
            self.send_header('Content-Length', '0')
            return self.end_headers()
        if not self.same_origin():
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

    # The editor with a page open waits here for agents' requests (it answers each one with a POST).
    def inbox(self, name):
        if not self.page_dir(name):
            return self.send_error(404, 'No page by that name')
        query = parse_qs(urlsplit(self.path).query)
        try:
            wait = min(Channels.EDITOR_WAIT, max(0.0, float(query.get('wait', ['0'])[0])))
        except ValueError:
            wait = 0.0
        request = CHANNELS.next(name, self.editor_id(query), wait, hosted=query.get('hosted') == ['1'])
        if request is None:
            self.send_response(204)
            self.send_header('Content-Length', '0')
            return self.end_headers()
        self.send_json(200, request)

    # A Clay tab that is showing waits here to open pages out of sight for agents.
    def host(self):
        query = parse_qs(urlsplit(self.path).query)
        try:
            wait = min(Channels.EDITOR_WAIT, max(0.0, float(query.get('wait', ['0'])[0])))
        except ValueError:
            wait = 0.0
        summons = CHANNELS.next_host(self.editor_id(query, 'host'), wait)
        if summons is None:
            self.send_response(204)
            self.send_header('Content-Length', '0')
            return self.end_headers()
        self.send_json(200, summons)

    @staticmethod
    def editor_id(query, key='editor'):
        editor = query.get(key, [''])[0]
        return editor if re.match(r'^[0-9a-f]{8,32}$', editor) else key

    def agent_pages(self):
        return [{**p, 'open': CHANNELS.is_open(p['name'], by_person=True), 'url': self.address() + p['url']} for p in self.listing()]

    def address(self):
        return ('https' if self.headers.get('X-Forwarded-Proto') == 'https' else 'http') + '://' + (self.headers.get('Host') or f'127.0.0.1:{self.port}')

    # (status, answer) for an agent's request to a page
    def agent_ask(self, name, request):
        if not self.page_dir(name):
            return 404, {'ok': False, 'error': f'There is no page "{name}". clay_pages lists them.'}
        got = CHANNELS.ask(name, request)
        if got is None:
            return 409, {'ok': False, 'error': f'Clay is not open anywhere right now, so "{name}" can\'t be opened to work on. Ask the person to open Clay at {self.address()}/ '
                                               f'(the page list is enough) and keep it showing, or to open the page itself at {self.address()}/p/{name}/ to watch.'}
        if got is False:
            return 504, {'ok': False, 'error': 'The editor did not answer in time. The person may have closed the page or be busy; try again.'}
        return (200 if got.get('ok') else 422), got

    def agent_reply(self, status, value):
        self.send_json(status, value)

    # MCP over HTTP: one JSON-RPC request in, one JSON answer out. No streams, no server-sent requests.
    def mcp(self):
        value = self.body(8 * 1024 * 1024)
        if value is None:
            return
        method, rid, params = value.get('method'), value.get('id'), value.get('params') or {}
        if 'id' not in value:
            self.send_response(202)
            self.send_header('Content-Length', '0')
            return self.end_headers()
        session = self.headers.get('Mcp-Session-Id', '')
        headers, result, error = {}, None, None
        if method == 'initialize':
            session = secrets.token_hex(16)
            with LOCK:
                SESSIONS[session] = agent_name((params.get('clientInfo') or {}).get('name'))
                while len(SESSIONS) > 200:
                    SESSIONS.pop(next(iter(SESSIONS)))
            headers['Mcp-Session-Id'] = session
            result = {'protocolVersion': params.get('protocolVersion') or '2025-06-18', 'capabilities': {'tools': {}},
                      'serverInfo': {'name': 'clay-studio', 'version': '0.3'}, 'instructions': MCP_ABOUT}
        elif method == 'ping':
            result = {}
        elif method == 'tools/list':
            result = {'tools': MCP_TOOLS}
        elif method == 'tools/call':
            ok, out = self.tool(params.get('name'), params.get('arguments') or {}, SESSIONS.get(session, 'An agent'))
            result = {'content': [{'type': 'text', 'text': json.dumps(out, ensure_ascii=False, indent=1)}], 'isError': not ok}
        else:
            error = {'code': -32601, 'message': f'Unknown method {method}'}
        data = json.dumps({'jsonrpc': '2.0', 'id': rid, **({'error': error} if error else {'result': result})}).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def tool(self, name, args, who):
        if name == 'clay_pages':
            return True, self.agent_pages()
        if name == 'clay_new_page':
            made = self.make_page(str(args.get('start') or 'blank'), args.get('title', ''))
            if isinstance(made, str):
                return False, {'error': made}
            return True, {**made, 'url': self.address() + made['url'], 'next': 'Read it with clay_read_page, then change it. The person can watch at this url.'}
        if name in ('clay_read_page', 'clay_change_page'):
            request = {'read': True} if name == 'clay_read_page' else {'actions': args.get('actions'), 'say': args.get('say')}
            status, out = self.agent_ask(str(args.get('page', '')), {**request, 'as': who})
            return status == 200, out
        return False, {'error': f'There is no tool {name}.'}

    def create(self):
        value = self.body(64 * 1024)
        if value is None:
            return
        made = self.make_page(str(value.get('from', value.get('start', 'blank'))), value.get('title'))
        if isinstance(made, str):
            return self.send_error(404 if made.startswith('No page') else 400, made)
        self.send_json(201, made)

    # A new page from a starter or a copy of another; what went wrong, as text, if it can't be made.
    def make_page(self, start, title):
        with LOCK:
            taken = {p.name for p in self.pages.iterdir()} if self.pages.is_dir() else set()
            if start.startswith('copy:'):
                source = self.page_dir(start[5:])
                if not source:
                    return 'No page by that name to copy'
                title = clean_title(title or read_json(source / 'meta.json', {}).get('title', source.name) + ' (copy)')
                html = (source / 'page.html').read_text(encoding='utf-8')
                state = read_json(source / 'state.json', {})
                state['rev'] = 0
            elif start in STARTERS:
                title = clean_title(title or '')
                html, state = STARTERS[start].read_text(encoding='utf-8'), None
            else:
                return 'Start from blank, links, sample or copy:<page>'
            name = name_for(title, taken)
            folder = self.pages / name
            folder.mkdir(parents=True)
            write(folder / 'page.html', retitle(html, title))
            if state:
                write(folder / 'state.json', json.dumps(state))
            write(folder / 'meta.json', json.dumps({'title': title, 'created': now(), 'updated': now()}))
        return {'name': name, 'title': title, 'url': f'/p/{name}/'}

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

    # A whole site: each page as <name>.html (the editor has already pointed page links there) and the home page also as
    # index.html, the page a web host shows first. It is kept as a folder you can open here and as a .zip to take away.
    def export_site(self):
        value = self.body(128 * 1024 * 1024)
        if value is None:
            return
        pages, home = value.get('pages'), value.get('home')
        if not isinstance(pages, list) or not pages or not all(isinstance(p, dict) and isinstance(p.get('name'), str) and self.page_dir(p['name'])
                                                               and isinstance(p.get('html'), str) and p['html'].lower().startswith('<!doctype html>') for p in pages):
            return self.send_error(400, 'Every page needs its name and a standalone HTML document')
        names = [p['name'] for p in pages]
        if len(set(names)) != len(names) or home not in names:
            return self.send_error(400, 'Each page once, and the home page among them')
        if 'index' in names and home != 'index':
            return self.send_error(409, 'A page called index would be replaced by the home page; make index the home page')
        files = {p['name'] + '.html': p['html'].encode('utf-8') for p in pages}
        files['index.html'] = files[home + '.html']
        titles = {p['name']: read_json(self.pages / p['name'] / 'meta.json', {}).get('title', p['name']) for p in pages}
        broken = sorted({(titles[p['name']], target + '.html') for p in pages for target in PAGE_LINK.findall(p['html']) if target + '.html' not in files})
        digest = hashlib.sha256()
        for n in sorted(files):
            digest.update(n.encode('utf-8') + b'\0' + files[n] + b'\0')
        name = 'site-' + digest.hexdigest()[:16]
        folder = self.data / 'exports'
        try:
            (folder / name).mkdir(parents=True, exist_ok=True)
            for n, data in files.items():
                (folder / name / n).write_bytes(data)
            tmp = folder / f'{name}.zip.{threading.get_ident()}.tmp'
            with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
                for n in sorted(files):
                    z.writestr(n, files[n])
            os.replace(tmp, folder / (name + '.zip'))
            with LOCK:
                write(self.data / 'site.json', json.dumps({'home': home}))
        except OSError:
            return self.send_error(500, 'Could not write the exported site')
        self.send_json(201, {'url': f'/exports/{name}/', 'zip': f'/exports/{name}.zip', 'pages': len(pages),
                             'broken': [{'page': t, 'link': link} for t, link in broken]})

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
