"""Server checks against real server processes: local by default, reachable on the network when asked, the password,
who may save pages, and where saved pages go. Python standard library only: python qa/server.test.py"""
import base64
import http.client
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
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
        for _ in range(100):
            if self.proc.poll() is not None:
                raise RuntimeError('server stopped while starting:\n' + self.proc.stdout.read())
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
        out, _ = self.proc.communicate(timeout=5)
        return out


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
check('37 Only the runtime is served beside a page', s.req('GET', '/p/family-links-2/serve.py')[0] == 404 and s.req('GET', '/p/family-links-2/../serve.py')[0] == 404)
s.stop()

# The data folder inside the app folder: its files are never served directly
inside = ROOT / 'data-test-server'
s = Server(['--data', str(inside)])
call('POST', '/api/pages', {'title': 'Secret', 'from': 'blank'})
call('PUT', '/api/pages/secret/state', {'rev': 0, 'page': 'hidden'})
check('38 Page files are never served as files, even with the data folder inside the app', s.req('GET', '/data-test-server/pages/secret/state.json')[0] == 404
      and s.req('GET', '/data-test-server/pages/secret/page.html')[0] == 404)
s.stop()
shutil.rmtree(inside)

print(f'{sum(results)}/{len(results)} server checks passed')
sys.exit(0 if all(results) else 1)
