"""Clay Studio for agents whose MCP setup runs a program (Codex, and others): passes MCP messages between the agent and a
Clay server. Python standard library only. Settings, usually given in the agent's MCP config:
  CLAY_URL        the Clay server, e.g. http://127.0.0.1:8920
  CLAY_AGENT_KEY  the key from the Agent dialog in Clay's editor
"""
import json
import os
import sys
import urllib.error
import urllib.request

URL = os.environ.get('CLAY_URL', 'http://127.0.0.1:8920').rstrip('/') + '/mcp'
KEY = os.environ.get('CLAY_AGENT_KEY', '')
session = None


def relay(message):
    global session
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + KEY}
    if session:
        headers['Mcp-Session-Id'] = session
    request = urllib.request.Request(URL, data=json.dumps(message).encode('utf-8'), headers=headers, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=60) as r:
            session = r.headers.get('Mcp-Session-Id') or session
            body = r.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        why = 'the key was refused; copy it again from the Agent dialog in Clay' if e.code == 401 else f'the server said {e.code}'
    except (urllib.error.URLError, OSError) as e:
        why = f'could not reach Clay at {URL} ({getattr(e, "reason", e)})'
    return None if 'id' not in message else {'jsonrpc': '2.0', 'id': message['id'], 'error': {'code': -32000, 'message': 'Clay Studio: ' + why}}


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
        except ValueError:
            continue
        answer = relay(message)
        if answer is not None:
            sys.stdout.write(json.dumps(answer) + '\n')
            sys.stdout.flush()


if __name__ == '__main__':
    main()
