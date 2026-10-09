"""Server checks against real server processes: local by default, reachable on the network when asked, the password,
who may save pages, and where saved pages go. Python standard library only: python qa/server.test.py"""
import base64
import http.client
import json
import os
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
check('1 Runs local by default and opens the editor', st == 302 and hd.get('location') == '/index.html')
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

print(f'{sum(results)}/{len(results)} server checks passed')
sys.exit(0 if all(results) else 1)
