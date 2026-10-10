"""Server checks against real server processes: local by default, reachable on the network when asked, the password,
who may save pages, and where saved pages go. Python standard library only: python qa/server.test.py"""
import base64
import http.client
import io
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = '<!doctype html><html><head><title>t</title></head><body><p>made in a test</p></body></html>'
results = []


def check(name, ok, detail=''):
    results.append(ok)
    print(('PASS ' if ok else 'FAIL ') + name + (f'  {detail}' if detail and not ok else ''))


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(('10.255.255.255', 1))
            ip = s.getsockname()[0]
            return None if ip.startswith('127.') else ip
    except OSError:
        return None


class Server:
    def __init__(self, args=(), env=None, port_arg=True):
        self.port, self.data = free_port(), tempfile.mkdtemp(prefix='clay-data-')
        e = {k: v for k, v in os.environ.items() if not k.startswith('CLAY_')}
        e.update({'CLAY_DATA': self.data, **(env or {})})
        if not port_arg:
            e['CLAY_PORT'] = str(self.port)
        cmd = [sys.executable, str(ROOT / 'serve.py'), *(['--port', str(self.port)] if port_arg else []), *args]
        self.proc = subprocess.Popen(cmd, env=e, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        # read what it prints as it goes: a full pipe would stop the server mid-request
        self.out = []
        self.reader = threading.Thread(target=lambda: self.out.extend(self.proc.stdout), daemon=True)
        self.reader.start()
        for _ in range(100):
            if self.proc.poll() is not None:
                self.reader.join(2)
                raise RuntimeError('server stopped while starting:\n' + ''.join(self.out))
            try:
                if self.req('GET', '/healthz')[0] == 200:
                    break
            except OSError:
                time.sleep(.05)
        else:
            raise RuntimeError('server did not start: ' + ' '.join(cmd))

    def req(self, method, path, host='127.0.0.1', headers=None, body=None, auth=None):
        h = {'Host': f'{host}:{self.port}', **(headers or {})}
        if auth is not None:
            h['Authorization'] = 'Basic ' + base64.b64encode(auth.encode()).decode()
        c = http.client.HTTPConnection(host, self.port, timeout=5)
        try:
            c.request(method, path, body=body, headers=h)
            r = c.getresponse()
            return r.status, {k.lower(): v for k, v in r.getheaders()}, r.read()
        finally:
            c.close()

    def export(self, host='127.0.0.1', origin=None, auth=None):
        body = json.dumps({'html': PAGE}).encode()
        return self.req('POST', '/api/export', host, {'Origin': origin or f'http://{host}:{self.port}', 'Content-Type': 'application/json', 'Content-Length': str(len(body))}, body, auth)

    def stop(self):
        self.proc.terminate()
        self.proc.wait(timeout=5)
        self.reader.join(5)
        return ''.join(self.out)


def reachable(host, port):
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


ip = lan_ip()

# Local by default
s = Server()
st, hd, _ = s.req('GET', '/')
check('1 Runs local by default and opens the page list', st == 302 and hd.get('location') == '/pages.html')
if ip:
    check('2 Not reachable from the network by default', not reachable(ip, s.port), ip)
st = s.req('GET', '/index.html', headers={'Host': f'evil.example:{s.port}'})[0]
check('3 A local server refuses requests addressed to another name (a website pointing its name at 127.0.0.1)', st == 421, st)
st, _, body = s.export()
url = json.loads(body).get('url', '') if st == 201 else ''
saved = Path(s.data) / url.lstrip('/')
check('4 The editor can save a page, and it lands in the data folder', st == 201 and saved.is_file() and saved.read_text(encoding='utf-8') == PAGE, st)
st, _, got = s.req('GET', url)
check('5 The saved page is served back from the data folder', st == 200 and got.decode() == PAGE, st)
check('6 Not written into the app folder', not (ROOT / url.lstrip('/')).exists())
st = s.export(origin='http://evil.example')[0]
check('7 Another website cannot save pages through it', st == 403, st)
st = s.req('GET', '/exports/../serve.py')[0]
check('8 Paths cannot climb out of the data folder', st == 404, st)
s.stop()

# On the network
s = Server(['--host', '0.0.0.0'])
host = ip or '127.0.0.1'
st = s.req('GET', '/index.html', host)[0]
check('9 With --host 0.0.0.0 it answers on the network address', st == 200, f'{host} {st}')
st = s.export(host)[0]
check('10 The editor opened by network address can save pages', st == 201, st)
check('11 Another website still cannot', s.export(host, origin='http://evil.example')[0] == 403)
out = s.stop()
check('12 Without a password it says that anyone on the network can edit', 'Set CLAY_PASSWORD' in out, out)

# Password
s = Server(['--host', '0.0.0.0'], {'CLAY_PASSWORD': 'open sesame'})
st, hd, _ = s.req('GET', '/index.html', host)
check('13 With a password, the editor asks for it', st == 401 and 'basic' in hd.get('www-authenticate', '').lower(), st)
check('14 A wrong password is refused', s.req('GET', '/index.html', host, auth='me:nope')[0] == 401)
check('15 The right password lets you in, with any user name', s.req('GET', '/index.html', host, auth='anyone:open sesame')[0] == 200)
check('16 Saving pages needs the password too', s.export(host)[0] == 401 and s.export(host, auth='x:open sesame')[0] == 201)
check('17 The health check needs no password and says nothing', s.req('GET', '/healthz', host)[:3:2] == (200, b'ok\n'))
out = s.stop()
check('18 With a password it does not warn', 'Set CLAY_PASSWORD' not in out, out)

pw = Path(tempfile.mkdtemp(prefix='clay-secret-')) / 'password.txt'
pw.write_text('from a file\n', encoding='utf-8')
s = Server(env={'CLAY_PASSWORD_FILE': str(pw)})
check('19 CLAY_PASSWORD_FILE works, for Docker secrets', s.req('GET', '/index.html', auth='u:from a file')[0] == 200 and s.req('GET', '/index.html')[0] == 401)
s.stop()

s = Server(port_arg=False)
check('20 CLAY_PORT sets the port', s.req('GET', '/index.html')[0] == 200)
s.stop()

# Pages kept on the server
s = Server()
J = {'Content-Type': 'application/json'}


def call(method, path, value=None, origin=None):
    body = json.dumps(value).encode() if value is not None else None
    h = {'Origin': origin or f'http://127.0.0.1:{s.port}', **(J if body else {}), **({'Content-Length': str(len(body))} if body else {})}
    st, _, out = s.req(method, path, headers=h, body=body)
    try:
        return st, json.loads(out)
    except ValueError:
        return st, out.decode('utf-8', 'replace')


def saved(name):
    st, _, out = s.req('GET', f'/p/{name}/')
    page = out.decode('utf-8')
    tag = page.split('<script type="application/json" id="clay-saved" data-clay-runtime>', 1)[1].split('</script>', 1)[0] if 'id="clay-saved"' in page else 'null'
    return st, page, json.loads(tag)


check('21 A new server starts with no pages', call('GET', '/api/pages') == (200, []))
st, made = call('POST', '/api/pages', {'title': 'Family links!', 'from': 'blank'})
check('22 A new page gets a tidy name from its title', st == 201 and made['name'] == 'family-links' and made['url'] == '/p/family-links/', made)
st, page, got = saved('family-links')
check('23 It opens with its (empty) saved work inside, titled, with the runtime beside it', st == 200 and got['rev'] == 0 and got['page'] is None and got['api'] == '/api/pages/family-links/state'
      and '<title>Family links!</title>' in page and s.req('GET', '/p/family-links/studio.js')[0] == 200, got)
check('24 Only Clay itself may make pages', call('POST', '/api/pages', {'title': 'x'}, origin='http://evil.example')[0] == 403)
check('25 The same title gets its own name', call('POST', '/api/pages', {'title': 'Family links', 'from': 'sample'})[1].get('name') == 'family-links-2')
st, r = call('PUT', '/api/pages/family-links/state', {'rev': 0, 'page': 'P1', 'steps': 'S1'})
check('26 Work saves, and the page reopens with it', st == 200 and r == {'rev': 1} and saved('family-links')[2]['page'] == 'P1', r)
st, r = call('PUT', '/api/pages/family-links/state', {'rev': 0, 'page': 'from an older copy'})
check('27 A save from an older copy is refused instead of overwriting newer work', st == 409 and r == {'rev': 1} and saved('family-links')[2]['page'] == 'P1', r)
call('PUT', '/api/pages/family-links/state', {'rev': 1, 'page': 'P2'})
got = saved('family-links')[2]
check('28 Saving just the page keeps the saved undo steps', got['page'] == 'P2' and got['steps'] == 'S1' and got['rev'] == 2, got)
evil = 'x</script><script>alert(1)</script><!--'
call('PUT', '/api/pages/family-links/state', {'rev': 2, 'page': evil})
st, page, got = saved('family-links')
check('29 Saved work that looks like HTML cannot break out of the page', got['page'] == evil and '<script>alert(1)' not in page)
st, r = call('PATCH', '/api/pages/family-links', {'title': 'Our home server'})
lst = call('GET', '/api/pages')[1]
check('30 Rename changes the title in the list and on the page, and keeps the address', st == 200 and any(p['name'] == 'family-links' and p['title'] == 'Our home server' for p in lst)
      and '<title>Our home server</title>' in saved('family-links')[1], r)
st, r = call('POST', '/api/pages', {'from': 'copy:family-links'})
got = saved(r.get('name', 'x'))[2]
check('31 Duplicate copies the page and its work, as a fresh page', st == 201 and r['title'] == 'Our home server (copy)' and got['page'] == evil and got['rev'] == 0, r)
st, r = call('DELETE', '/api/pages/family-links')
names = [p['name'] for p in call('GET', '/api/pages')[1]]
check('32 Delete moves a page to the trash', st == 200 and 'family-links' not in names and (Path(s.data) / 'trash' / r['trash'] / 'state.json').is_file(), r)
st, back = call('POST', f"/api/trash/{r['trash']}/restore")
check('33 Undo brings it back, with its work', st == 200 and back['name'] == 'family-links' and saved('family-links')[2]['page'] == evil, back)
st, r2 = call('DELETE', '/api/pages/family-links')
call('POST', '/api/pages', {'title': 'Family links', 'from': 'blank'})
st, back = call('POST', f"/api/trash/{r2['trash']}/restore")
check('34 Restoring when the name is taken gives it a new one', st == 200 and back['name'] not in ('family-links',) and saved(back['name'])[2]['page'] == evil, back)
check('35 Unknown pages and odd names are refused', s.req('GET', '/p/no-such-page/')[0] == 404 and s.req('GET', '/p/Family-Links/')[0] == 404
      and call('PUT', '/api/pages/..%2Fx/state', {'rev': 0})[0] == 404 and call('POST', '/api/trash/../restore')[0] == 404)
check('36 Starting from something unknown is refused', call('POST', '/api/pages', {'title': 'x', 'from': 'serve.py'})[0] == 400)
check('37 Only the runtime is served beside a page, with what reads a server’s apps', s.req('GET', '/p/family-links-2/serve.py')[0] == 404 and s.req('GET', '/p/family-links-2/../serve.py')[0] == 404
      and s.req('GET', '/p/family-links-2/compose.js')[0] == 200 and s.req('GET', '/p/family-links-2/bring.js')[0] == 200)
s.stop()

# A whole site
s = Server()
st, made = call('POST', '/api/pages', {'title': 'Our home server', 'from': 'links'})
page = saved(made.get('name', 'x'))[1]
check('38 Home server links starts with a card for each app', st == 201 and page.count('class="piece app ') == 6 and '<title>Our home server</title>' in page, made)
call('POST', '/api/pages', {'title': 'About us', 'from': 'blank'})
check('39 No page is called index: that name is kept for the home page of an exported site', call('POST', '/api/pages', {'title': 'Index', 'from': 'blank'})[1].get('name') == 'index-2')
HOME = '<!doctype html><html><head><title>Home</title></head><body><a href="about-us.html">About</a><a href="about-us.html#team">Team</a><a href="https://example.com/x.html">Out</a></body></html>'
ABOUT = '<!doctype html><html><head><title>About</title></head><body><a href="our-home-server.html">Home</a><a href="gone.html">Old</a></body></html>'
LAST = '<!doctype html><html><head><title>I</title></head><body></body></html>'
site = [{'name': 'our-home-server', 'html': HOME}, {'name': 'about-us', 'html': ABOUT}, {'name': 'index-2', 'html': LAST}]
st, r = call('POST', '/api/site', {'home': 'our-home-server', 'pages': site})
out = Path(s.data) / r.get('url', '/x').strip('/') if st == 201 else Path(s.data)
check('40 Export site writes each page as name.html, and the home page as index.html too', st == 201 and r['pages'] == 3 and (out / 'index.html').read_text(encoding='utf-8') == HOME
      and (out / 'our-home-server.html').read_text(encoding='utf-8') == HOME and (out / 'about-us.html').read_text(encoding='utf-8') == ABOUT
      and sorted(p.name for p in out.iterdir()) == ['about-us.html', 'index-2.html', 'index.html', 'our-home-server.html'], r)
st, hd, body = s.req('GET', r.get('zip', '/x'))
z =zipfile.ZipFile(io.BytesIO(body)) if st == 200 else None
check('41 The .zip downloads as clay-site.zip and holds the same files', st == 200 and 'clay-site.zip' in hd.get('content-disposition', '')
      and sorted(z.namelist()) == ['about-us.html', 'index-2.html', 'index.html', 'our-home-server.html'] and z.read('index.html').decode() == HOME, (st, hd))
st, _, body = s.req('GET', r.get('url', '/x'))
check('42 The site folder opens on its home page', st == 200 and body.decode() == HOME, st)
check('43 A link to a page that is not in the site is reported; web addresses are left alone', r.get('broken') == [{'page': 'About us', 'link': 'gone.html'}], r.get('broken'))
lst = call('GET', '/api/pages')[1]
check('44 The home page is remembered and marked in the list', [p['name'] for p in lst if p['home']] == ['our-home-server'], lst)
check('45 The same site exported again gets the same name', call('POST', '/api/site', {'home': 'our-home-server', 'pages': site})[1].get('url') == r['url'])
refused = [call('POST', '/api/site', v)[0] for v in (
    {'home': 'our-home-server', 'pages': site + [{'name': 'no-such-page', 'html': LAST}]},
    {'home': 'nobody', 'pages': site},
    {'home': 'about-us', 'pages': [{'name': 'about-us', 'html': '<p>not a document</p>'}]},
    {'home': 'about-us', 'pages': [site[1], site[1]]},
    {'home': 'about-us', 'pages': []})]
check('46 Unknown pages, a home page outside the site, fragments and doubles are refused', refused == [400] * 5, refused)
check('47 Only Clay itself may export a site', call('POST', '/api/site', {'home': 'about-us', 'pages': [site[1]]}, origin='http://evil.example')[0] == 403)
s.stop()

# Agents
s = Server()
st, r = call('GET', '/api/agent-key')
KEY = r.get('key', '') if st == 200 else ''


def agent(method, path, value=None, key=None, headers=None):
    body = json.dumps(value).encode() if value is not None else None
    h = {'Authorization': f'Bearer {KEY if key is None else key}', **(J if body else {}), **({'Content-Length': str(len(body))} if body else {}), **(headers or {})}
    st, hd, out = s.req(method, path, headers=h, body=body)
    try:
        return st, json.loads(out), hd
    except ValueError:
        return st, out, hd


def rpc(method, params=None, rid=1, session=None, headers=None):
    st, out, hd = agent('POST', '/mcp', {'jsonrpc': '2.0', 'id': rid, 'method': method, **({'params': params} if params is not None else {})}, headers={**({'Mcp-Session-Id': session} if session else {}), **(headers or {})})
    return st, out, hd


check('48 The editor gets the agent key; it stays the same', len(KEY) >= 30 and call('GET', '/api/agent-key')[1].get('key') == KEY)
check('49 Agents need the key', agent('GET', '/api/agent/pages', key='')[0] == 401 and agent('GET', '/api/agent/pages', key='wrong')[0] == 401
      and agent('POST', '/mcp', {'jsonrpc': '2.0', 'id': 1, 'method': 'ping'}, key='nope')[0] == 401 and agent('GET', '/api/agent/pages')[0] == 200)
check('50 Another website cannot make a new key', call('POST', '/api/agent-key', {}, origin='http://evil.example')[0] == 403 and call('GET', '/api/agent-key')[1].get('key') == KEY)
st, made, _ = agent('POST', '/api/agent/pages', {'title': 'Agent home', 'from': 'links'})
st2, lst, _ = agent('GET', '/api/agent/pages')
check('51 An agent can make a page, and list them, with their full addresses and whether they are open', st == 201 and made['name'] == 'agent-home'
      and lst[0]['name'] == 'agent-home' and lst[0]['open'] is False and lst[0]['url'] == f'http://127.0.0.1:{s.port}/p/agent-home/', (st, made, lst))
st, r, _ = agent('GET', '/api/agent/pages/agent-home')
check('52 A page nobody has open cannot be read, and the agent is told where to ask the person to open it', st == 409 and f'http://127.0.0.1:{s.port}/p/agent-home/' in r['error'], r)
check('53 Unknown pages are refused', agent('GET', '/api/agent/pages/nope')[0] == 404)

seen = []


def editor(n=1, answer=lambda req: {'ok': True, 'page': {'pieces': []}}):
    """Stands in for an editor with the page open: waits for requests and answers each."""
    def run():
        for _ in range(n):
            st, _, out = s.req('GET', '/api/pages/agent-home/agent?wait=5')
            if st != 200:
                continue
            req = json.loads(out)
            seen.append(req)
            body = json.dumps(answer(req)).encode()
            s.req('POST', f"/api/pages/agent-home/agent/{req['id']}", headers={'Origin': f'http://127.0.0.1:{s.port}', **J, 'Content-Length': str(len(body))}, body=body)
        call('POST', '/api/pages/agent-home/agent/bye')
    t = threading.Thread(target=run, daemon=True)
    t.start()
    time.sleep(.3)
    return t


t = editor()
open_now = agent('GET', '/api/agent/pages')[1][0]['open']
st, r, _ = agent('GET', '/api/agent/pages/agent-home', headers={'X-Clay-Agent-Name': 'Script'})
t.join(5)
check('54 With the page open in an editor, an agent reads it through the editor', open_now and st == 200 and r == {'ok': True, 'page': {'pieces': []}} and seen[-1]['read'] is True and seen[-1]['as'] == 'Script', (open_now, st, r))
t = editor(answer=lambda req: {'ok': True, 'step': 'Script: ' + req['say']})
st, r, _ = agent('POST', '/api/agent/pages/agent-home', {'actions': [{'do': 'place', 'piece': 'movies', 'x': 10}], 'say': 'moved it', 'as': 'Script'})
t.join(5)
check('55 A change goes to the editor with its actions and words, and the editor answers', st == 200 and r['step'] == 'Script: moved it' and seen[-1]['actions'] == [{'do': 'place', 'piece': 'movies', 'x': 10}], (st, r))
t = editor(answer=lambda req: {'ok': False, 'error': 'Action 1 (place): There is no piece "x". Nothing was changed.'})
st, r, _ = agent('POST', '/api/agent/pages/agent-home', {'actions': [{'do': 'place', 'piece': 'x'}]})
t.join(5)
check('56 What the editor could not do comes back as an error', st == 422 and 'no piece' in r['error'], (st, r))
answer = json.dumps({'ok': True}).encode()
check('57 Only answers to requests the editor was given count, and only from Clay itself',
      s.req('POST', '/api/pages/agent-home/agent/0123456789abcdef', headers={'Origin': f'http://127.0.0.1:{s.port}', **J, 'Content-Length': str(len(answer))}, body=answer)[0] == 410
      and s.req('POST', '/api/pages/agent-home/agent/0123456789abcdef', headers={'Origin': 'http://evil.example', **J, 'Content-Length': str(len(answer))}, body=answer)[0] == 403)
waited = []
t = threading.Thread(target=lambda: waited.append(s.req('GET', '/api/pages/agent-home/agent?wait=10&editor=0123456789abcdef')[0]), daemon=True)
t.start()
time.sleep(.3)
was_open = agent('GET', '/api/agent/pages')[1][0]['open']
bye = s.req('POST', '/api/pages/agent-home/agent/bye?editor=0123456789abcdef', headers={'Origin': 'null'})[0]
t.join(3)
began = time.monotonic()
st = agent('GET', '/api/agent/pages/agent-home')[0]
check('58 When the editor says it has gone (a closing tab\'s beacon, Origin "null"), agents are told at once', bye == 200 and was_open and waited == [204] and st == 409 and time.monotonic() - began < 1, (bye, was_open, waited, st))


def poll(path):
    st, _, out = s.req('GET', path)
    return st, (json.loads(out) if st == 200 else None)


def hosted_editor(page, editor, answer):
    """Stands in for an editor opened out of sight by a host: waits for one request, answers it, and keeps waiting."""
    got = []

    def run():
        while True:
            st, req = poll(f'/api/pages/{page}/agent?wait=5&editor={editor}&hosted=1')
            if st == 200 and req.get('close'):
                got.append('close')
                return
            if st == 200:
                got.append(req)
                body = json.dumps(answer(req)).encode()
                s.req('POST', f"/api/pages/{page}/agent/{req['id']}", headers={'Origin': f'http://127.0.0.1:{s.port}', **J, 'Content-Length': str(len(body))}, body=body)
            if len(got) > 3:
                return
    threading.Thread(target=run, daemon=True).start()
    return got


def host(n=1):
    """Stands in for a Clay tab that is showing: opens the pages agents ask for, out of sight."""
    asked = []

    def run():
        for _ in range(n):
            st, summons = poll('/api/host?wait=8&host=aaaaaaaaaaaaaaaa')
            if st == 200:
                asked.append(summons)
                asked.append(hosted_editor(summons['open'], 'bbbbbbbbbbbbbbbb', lambda req: {'ok': True, 'page': {'hidden': True}}))
    t = threading.Thread(target=run, daemon=True)
    t.start()
    time.sleep(.3)
    return t, asked


st, r, _ = agent('GET', '/api/agent/pages/agent-home')
check('59 With Clay open nowhere, agents are told to ask the person to open Clay (the page list is enough), or the page', st == 409 and 'Clay is not open anywhere' in r['error']
      and f'http://127.0.0.1:{s.port}/ ' in r['error'] and f'/p/agent-home/' in r['error'], r)
t, asked = host()
st, r, _ = agent('GET', '/api/agent/pages/agent-home', headers={'X-Clay-Agent-Name': 'Script'})
check('60 With a Clay tab showing, a page nobody has open is opened out of sight, and the agent is answered from there', st == 200 and r == {'ok': True, 'page': {'hidden': True}}
      and asked[0] == {'open': 'agent-home', 'as': 'Script'} and asked[1][0]['read'] is True, (st, r, asked[:1]))
listed = agent('GET', '/api/agent/pages')[1][0]
st2, r2, _ = agent('GET', '/api/agent/pages/agent-home')
check('61 Opened out of sight, it is not listed as open by the person; further requests go to it, without asking the host again', listed['open'] is False and st2 == 200 and len(asked) == 2, (listed, st2))
person = []
pt = threading.Thread(target=lambda: person.append(poll('/api/pages/agent-home/agent?wait=5&editor=cccccccccccccccc')), daemon=True)
pt.start()
time.sleep(.5)
gave_way = asked[1][-1] == 'close'
st3 = [None]
at = threading.Thread(target=lambda: st3.__setitem__(0, agent('GET', '/api/agent/pages/agent-home')[0]), daemon=True)
at.start()
pt.join(6)
if person and person[0][0] == 200:
    body = json.dumps({'ok': True, 'page': {'by': 'person'}}).encode()
    s.req('POST', f"/api/pages/agent-home/agent/{person[0][1]['id']}", headers={'Origin': f'http://127.0.0.1:{s.port}', **J, 'Content-Length': str(len(body))}, body=body)
at.join(5)
check('62 When the person opens the page, the one out of sight is told to close, and requests go to the person\'s editor', gave_way and bool(person) and person[0][0] == 200
      and person[0][1]['read'] is True and st3[0] == 200, (asked[1][-1:], person, st3))
call('POST', '/api/pages/agent-home/agent/bye?editor=cccccccccccccccc')
call('POST', '/api/host/bye?host=aaaaaaaaaaaaaaaa')
began = time.monotonic()
st = agent('GET', '/api/agent/pages/agent-home')[0]
check('63 When the last Clay tab goes, agents are told at once', st == 409 and time.monotonic() - began < 1, st)

# MCP
st, r, hd = rpc('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'claude-code', 'version': '2'}})
session = hd.get('mcp-session-id')
check('64 MCP: initialize answers with tools, instructions and a session', st == 200 and r['result']['protocolVersion'] == '2025-06-18' and 'tools' in r['result']['capabilities']
      and 'opened out of sight' in r['result']['instructions'] and bool(session), r)
check('65 MCP: a notification is accepted without an answer', agent('POST', '/mcp', {'jsonrpc': '2.0', 'method': 'notifications/initialized'}, headers={'Mcp-Session-Id': session})[0] == 202)
tools = rpc('tools/list', session=session)[1]['result']['tools']
check('66 MCP: four tools, the change tool explaining every action', [t['name'] for t in tools] == ['clay_pages', 'clay_new_page', 'clay_read_page', 'clay_change_page']
      and all(f'"do":"{d}"' in tools[3]['description'] for d in ('place', 'text', 'link', 'add', 'remove', 'paint', 'pin', 'group', 'ungroup', 'canvas')))
r = rpc('tools/call', {'name': 'clay_new_page', 'arguments': {'title': 'From MCP', 'start': 'blank'}}, session=session)[1]['result']
out = json.loads(r['content'][0]['text'])
check('67 MCP: clay_new_page makes a page and says what to do next', not r['isError'] and out['name'] == 'from-mcp' and out['url'].endswith('/p/from-mcp/') and 'clay_read_page' in out['next'], r)
r = rpc('tools/call', {'name': 'clay_read_page', 'arguments': {'page': 'from-mcp'}}, session=session)[1]['result']
check('68 MCP: reading a page nobody has open is an error that says what to do', r['isError'] and 'Ask the person to open' in json.loads(r['content'][0]['text'])['error'], r)
t = editor()
r = rpc('tools/call', {'name': 'clay_change_page', 'arguments': {'page': 'agent-home', 'actions': [{'do': 'canvas', 'height': 1400}], 'say': 'more room'}}, session=session)[1]['result']
t.join(5)
check('69 MCP: changes carry the agent\'s name from its MCP client (claude-code is Claude)', not r['isError'] and seen[-1]['as'] == 'Claude' and seen[-1]['say'] == 'more room', seen[-1])
check('70 MCP: unknown methods and tools are errors; GET is not offered; a page of another website is refused', rpc('resources/list', session=session)[1]['error']['code'] == -32601
      and rpc('tools/call', {'name': 'nope', 'arguments': {}}, session=session)[1]['result']['isError'] and agent('GET', '/mcp')[0] == 405 and agent('DELETE', '/mcp')[0] == 405
      and rpc('ping', headers={'Origin': 'http://evil.example'})[0] == 403)

# the bridge for MCP setups that run a program
bridge = [sys.executable, str(ROOT / 'clay-mcp.py')]
lines = '\n'.join(json.dumps(m) for m in ({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'codex-mcp-client'}}},
                                          {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
                                          {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'clay_pages', 'arguments': {}}})) + '\n'
env = {**os.environ, 'CLAY_URL': f'http://127.0.0.1:{s.port}', 'CLAY_AGENT_KEY': KEY}
got = [json.loads(x) for x in subprocess.run(bridge, input=lines, capture_output=True, text=True, env=env, timeout=20).stdout.splitlines()]
check('71 clay-mcp.py passes MCP between a program-based setup and the server', [g['id'] for g in got] == [1, 2] and 'from-mcp' in got[1]['result']['content'][0]['text'], got)
got = [json.loads(x) for x in subprocess.run(bridge, input=lines, capture_output=True, text=True, env={**env, 'CLAY_AGENT_KEY': 'wrong'}, timeout=20).stdout.splitlines()]
check('72 With the wrong key it says to copy the key again', len(got) == 2 and 'copy it again' in got[0]['error']['message'], got)
check('73 It is served by Clay, for downloading', s.req('GET', '/clay-mcp.py')[0] == 200)
s.stop()

# A password guards the editor; agents still use their key
s = Server(env={'CLAY_PASSWORD': 'pw'})
check('74 With a password, the key needs the password, and agents need only the key', s.req('GET', '/api/agent-key')[0] == 401
      and agent('GET', '/api/agent/pages', key=json.loads(s.req('GET', '/api/agent-key', auth='u:pw')[2])['key'])[0] == 200 and agent('GET', '/api/agent/pages', key='pw')[0] == 401)
s.stop()

# The data folder inside the app folder: its files are never served directly
inside = ROOT / 'data-test-server'
s = Server(['--data', str(inside)])
call('POST', '/api/pages', {'title': 'Secret', 'from': 'blank'})
call('PUT', '/api/pages/secret/state', {'rev': 0, 'page': 'hidden'})
call('GET', '/api/agent-key')
check('75 Nothing in the data folder is served as a file (pages, the agent key), even with it inside the app', s.req('GET', '/data-test-server/pages/secret/state.json')[0] == 404
      and s.req('GET', '/data-test-server/pages/secret/page.html')[0] == 404 and (inside / 'agent.json').is_file() and s.req('GET', '/data-test-server/agent.json')[0] == 404)
s.stop()
shutil.rmtree(inside)

print(f'{sum(results)}/{len(results)} server checks passed')
sys.exit(0 if all(results) else 1)
