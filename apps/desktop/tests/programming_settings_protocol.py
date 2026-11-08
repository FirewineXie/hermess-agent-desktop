"""Locked App Server acceptance and real worker behavior using isolated synthetic MCP/model services."""
import argparse
import copy
import importlib.util
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def stdio_mcp():
    for line in sys.stdin:
        message = json.loads(line)
        if 'id' not in message: continue
        method = message.get('method')
        if method == 'initialize': result = {'protocolVersion': message['params']['protocolVersion'], 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'stdio-fixture', 'version': '1'}}
        elif method == 'tools/list': result = {'tools': [{'name': 'ping', 'description': 'STDIO fixture', 'inputSchema': {'type': 'object', 'properties': {}}}]}
        elif method == 'tools/call': result = {'content': [{'type': 'text', 'text': 'STDIO_MCP_EXECUTED:' + os.environ.get('MCP_ENV_FIXTURE', 'MISSING')}]}
        else: result = {}
        print(json.dumps({'jsonrpc': '2.0', 'id': message['id'], 'result': result}), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--codex', type=Path, required=True)
    parser.add_argument('--python', type=Path, required=True)
    parser.add_argument('--fixtures', type=Path, required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[3]
    spec = importlib.util.spec_from_file_location('worker', repo / 'apps/desktop/runtime/programming_worker.py')
    worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)
    requests, calls = [], []
    writable_marker = None

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def reply(self, value, status=200, content_type='application/json'):
            data = json.dumps(value).encode()
            self.send_response(status); self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
        def do_GET(self):
            base_url = f'http://127.0.0.1:{self.server.server_port}'
            if self.path.startswith('/.well-known/oauth-protected-resource'):
                self.reply({'resource': base_url + '/oauth-mcp', 'authorization_servers': [base_url]}); return
            if self.path.startswith('/.well-known/oauth-authorization-server') or self.path.startswith('/.well-known/openid-configuration'):
                self.reply({'issuer': base_url, 'authorization_endpoint': base_url + '/authorize', 'token_endpoint': base_url + '/token',
                    'registration_endpoint': base_url + '/register', 'response_types_supported': ['code'], 'grant_types_supported': ['authorization_code', 'refresh_token'],
                    'code_challenge_methods_supported': ['S256'], 'token_endpoint_auth_methods_supported': ['none']}); return
            if self.path.startswith('/authorize?'):
                params = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                redirect = params['redirect_uri'][0] + '?' + urllib.parse.urlencode({'code': 'fixture-code', 'state': params['state'][0]})
                self.send_response(302); self.send_header('Location', redirect); self.send_header('Content-Length', '0'); self.end_headers(); return
            self.reply({}, 405)
        def do_POST(self):
            data = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            if self.path == '/bad-mcp':
                self.reply({'error': 'fixture unavailable'}, 503); return
            if self.path == '/token':
                self.reply({'access_token': 'OAUTH_FIXTURE_TOKEN', 'token_type': 'Bearer', 'expires_in': 3600, 'refresh_token': 'OAUTH_FIXTURE_REFRESH'}); return
            body = json.loads(data or '{}')
            if self.path == '/register':
                self.reply({**body, 'client_id': 'fixture-client', 'token_endpoint_auth_method': 'none'}, 201); return
            if self.path in ('/mcp', '/oauth-mcp'):
                expected = 'OAUTH_FIXTURE_TOKEN' if self.path == '/oauth-mcp' else 'MCP_FIXTURE_TOKEN'
                if self.headers.get('Authorization') != 'Bearer ' + expected:
                    self.send_response(401); self.send_header('WWW-Authenticate', f'Bearer resource_metadata="http://127.0.0.1:{self.server.server_port}/.well-known/oauth-protected-resource"'); self.send_header('Content-Length', '0'); self.end_headers(); return
                method = body.get('method')
                if method == 'initialize':
                    result = {'protocolVersion': body['params']['protocolVersion'], 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'fixture', 'version': '1'}}
                elif method == 'tools/list':
                    result = {'tools': [{'name': 'ping', 'description': 'Fixture tool', 'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False}},
                                        {'name': 'blocked', 'description': 'Must be filtered', 'inputSchema': {'type': 'object', 'properties': {}}}]}
                elif method == 'tools/call':
                    calls.append(body['params']['name']); result = {'content': [{'type': 'text', 'text': 'MCP_TOOL_EXECUTED'}]}
                elif 'id' not in body:
                    self.reply({}, 202); return
                else: result = {}
                self.reply({'jsonrpc': '2.0', 'id': body.get('id'), 'result': result}); return
            assert self.path == '/v1/responses', self.path
            assert self.headers.get('Authorization') == 'Bearer MODEL_FIXTURE_KEY'
            requests.append(body)
            text = 'SETTINGS_WORKER_OK'
            item = {'type': 'message', 'id': 'message', 'role': 'assistant', 'status': 'completed', 'content': [{'type': 'output_text', 'text': text, 'annotations': []}]}
            input_text = json.dumps(body.get('input'))
            call_mcp = 'CALL_MCP' in input_text and 'MCP_TOOL_EXECUTED' not in input_text
            call_write = 'WRITE_OUTSIDE_FIXTURE' in input_text and '"call_id": "write-fixture"' not in input_text
            assert len(requests) < 20, 'Synthetic model exceeded the expected tool loop budget'
            if call_mcp:
                namespace = next(tool for tool in body['tools'] if tool.get('name') == 'mcp__fixture')
                assert any(tool.get('name') == 'ping' for tool in namespace['tools']), namespace
                item = {'type': 'function_call', 'id': 'mcp-call', 'call_id': 'mcp-call', 'namespace': 'mcp__fixture', 'name': 'ping', 'arguments': '{}', 'status': 'completed'}
            if call_write:
                if os.name == 'nt':
                    literal = str(writable_marker).replace("'", "''")
                    command = "Set-Content -LiteralPath '" + literal + "' -Value 'PERMISSION' -NoNewline -ErrorAction Stop; 'PERMISSION_FILE_WRITTEN'"
                else:
                    import shlex
                    command = "printf PERMISSION > " + shlex.quote(str(writable_marker)) + "; echo PERMISSION_FILE_WRITTEN"
                item = {'type': 'function_call', 'id': 'write-fixture', 'call_id': 'write-fixture', 'name': 'exec_command', 'arguments': json.dumps({'cmd': command, 'yield_time_ms': 1000, 'max_output_tokens': 200}), 'status': 'completed'}
            events = [
                {'type': 'response.created', 'response': {'id': 'fixture-response', 'status': 'in_progress', 'output': []}},
                {'type': 'response.output_item.added', 'output_index': 0, 'item': {**item, 'status': 'in_progress', 'content': []}},
                {'type': 'response.output_text.delta', 'item_id': 'message', 'output_index': 0, 'content_index': 0, 'delta': text},
                {'type': 'response.output_item.done', 'output_index': 0, 'item': item},
                {'type': 'response.completed', 'response': {'id': 'fixture-response', 'status': 'completed', 'output': [item], 'usage': {'input_tokens': 100, 'output_tokens': 5, 'total_tokens': 105}}},
            ]
            if call_mcp or call_write: events = [events[0], {'type': 'response.output_item.added', 'output_index': 0, 'item': item}, events[-2], events[-1]]
            data = ''.join('event: ' + event['type'] + '\ndata: ' + json.dumps(event) + '\n\n' for event in events).encode()
            self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.send_header('Content-Length', str(len(data)))
            self.end_headers(); self.wfile.write(data)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='hermess-settings-', dir=repo / '.build') as temp:
        root = Path(temp); private = root / 'private'; private.mkdir()
        cwd = root / 'project'; cwd.mkdir()
        (cwd / 'AGENTS.md').write_text('PROJECT_INSTRUCTION_FIXTURE\n', encoding='utf-8')
        skill_root = private / 'skills'; skill = skill_root / 'fixture-skill'; skill.mkdir(parents=True)
        (skill / 'SKILL.md').write_bytes((args.fixtures / 'SKILL.md').read_bytes())
        settings = json.loads((args.fixtures / 'settings.json').read_text(encoding='utf-8'))
        settings['mcp_servers'] = [{'id': 'fixture', 'enabled': True, 'transport': 'http', 'command': '', 'args': [], 'cwd': '', 'env': {},
            'url': f'http://127.0.0.1:{server.server_port}/mcp', 'http_headers': {}, 'bearer_token': 'MCP_FIXTURE_TOKEN',
            'startup_timeout_sec': 10, 'tool_timeout_sec': 10, 'enabled_tools': [], 'disabled_tools': ['blocked']}]
        settings['mcp_servers'].append({'id': 'stdio', 'enabled': True, 'transport': 'stdio', 'command': str(args.python.resolve()),
            'args': [str(Path(__file__).resolve()), '--stdio-mcp'], 'cwd': str(cwd), 'env': {'MCP_ENV_FIXTURE': 'PASSED'}, 'url': '', 'http_headers': {},
            'bearer_token': '', 'startup_timeout_sec': 10, 'tool_timeout_sec': 10, 'enabled_tools': [], 'disabled_tools': []})
        base = {'private_root': str(private), 'cwd': str(cwd), 'connection_id': 'fixture', 'model': 'gpt-5.2-codex', 'effort': 'medium',
                'permissions': 'request', 'base_url': f'http://127.0.0.1:{server.server_port}/v1', 'executable': str(args.codex.resolve()),
                'api_key': 'MODEL_FIXTURE_KEY', 'text': '$fixture-skill reply', 'thread_id': None,
                'integration': {'settings': settings, 'skill_root': str(skill_root), 'oauth_root': str(private / 'oauth')}}
        integration = json.loads((args.fixtures / 'integration.json').read_text(encoding='utf-8'))
        integration.update(settings=settings, skill_root=str(skill_root), oauth_root=str(private / 'oauth'))
        integration['mcp_config']['fixture'].update(url=settings['mcp_servers'][0]['url'], disabled_tools=['blocked'], startup_timeout_sec=10, tool_timeout_sec=10)
        integration['mcp_config']['fixture'].pop('http_headers', None)
        integration['mcp_config']['fixture']['bearer_token_env_var'] = 'MCP_FIXTURE_ENV_TOKEN'
        integration['mcp_environment'] = {'MCP_FIXTURE_ENV_TOKEN': 'MCP_FIXTURE_TOKEN'}
        integration['mcp_config']['stdio'] = {'command': str(args.python.resolve()), 'args': [str(Path(__file__).resolve()), '--stdio-mcp'], 'cwd': str(cwd), 'env': {'MCP_ENV_FIXTURE': 'PASSED'}, 'startup_timeout_sec': 10, 'tool_timeout_sec': 10}
        base['integration'] = integration
        env = {key: os.environ[key] for key in ('PATH', 'SystemRoot', 'SystemDrive', 'WINDIR', 'TEMP', 'TMP') if key in os.environ}
        env.update(PYTHONPATH=str(repo / 'upstream/hermes-agent'), PYTHONIOENCODING='utf-8', PYTHONUTF8='1')

        class Rpc:
            def __init__(self, initial):
                self.initial = initial; self.home = Path(initial['home']); self.home.mkdir(parents=True, exist_ok=True)
                (self.home / 'user-home').mkdir(exist_ok=True)
                provider_id, provider, policy = worker.launch_policy(initial)
                self.policy, self.provider_id, self.provider = policy, provider_id, provider
                files = worker.prepare_integration_config(initial)
                command = [str(args.codex.resolve()), 'app-server', '--strict-config']
                for key, value in policy.items():
                    if key not in files: command.extend(['-c', key + '=' + worker.toml_value(value)])
                assert not any('MCP_FIXTURE_TOKEN' in argument for argument in command)
                launch_env = {**env, 'CODEX_HOME': str(self.home), 'CODEX_SQLITE_HOME': str(self.home), 'HOME': str(self.home / 'user-home'),
                              'USERPROFILE': str(self.home / 'user-home'), 'HERMESS_PROGRAMMING_KEY': 'MODEL_FIXTURE_KEY'}
                (self.home / 'local-appdata').mkdir(exist_ok=True)
                launch_env['LOCALAPPDATA'] = str(self.home / 'local-appdata')
                launch_env.update(initial['integration'].get('mcp_environment', {}))
                self.error = (self.home / 'errors.log').open('w', encoding='utf-8')
                self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.error, text=True, encoding='utf-8', env=launch_env,
                    cwd=self.home, creationflags=0x08000000 if os.name == 'nt' else 0)
                self.queue = queue.Queue(); self.id = 0
                def read():
                    for line in self.process.stdout: self.queue.put(json.loads(line))
                    self.queue.put(None)
                threading.Thread(target=read, daemon=True).start()
            def request(self, method, params):
                self.id += 1; self.process.stdin.write(json.dumps({'id': self.id, 'method': method, 'params': params}) + '\n'); self.process.stdin.flush()
                while True:
                    value = self.queue.get(timeout=40)
                    assert value is not None, (self.home / 'errors.log').read_text(encoding='utf-8')[-4000:]
                    if value.get('id') == self.id:
                        assert 'error' not in value, (method, value)
                        return value['result']
            def close(self):
                self.process.stdin.close()
                try: self.process.wait(timeout=10)
                except subprocess.TimeoutExpired: self.process.kill(); self.process.wait()
                self.error.close()

        initial = {**base, 'home': str(private / 'acceptance')}
        rpc = Rpc(initial)
        try:
            rpc.request('initialize', {'clientInfo': {'name': 'hermess-settings-test', 'version': '1'}, 'capabilities': {'experimentalApi': True}})
            effective = rpc.request('config/read', {'cwd': str(cwd), 'includeLayers': False})['config']
            for key in worker.integration_options(initial):
                if key not in ('mcp_servers', 'skills'):
                    assert effective.get(key) == rpc.policy[key], (key, effective.get(key), rpc.policy[key])
            worker.verify_effective_config(effective, rpc.provider_id, rpc.provider, rpc.policy)
            rpc.request('skills/extraRoots/set', {'extraRoots': [str(skill_root)]})
            catalog = rpc.request('skills/list', {'cwds': [str(cwd)], 'forceReload': True})
            assert any(row['name'] == 'fixture-skill' and row['enabled'] for entry in catalog['data'] for row in entry['skills']), catalog
            thread = rpc.request('thread/start', {'cwd': str(cwd), 'model': base['model'], 'modelProvider': rpc.provider_id})['thread']['id']
            status = rpc.request('mcpServerStatus/list', {'threadId': thread, 'serverName': 'fixture'})
            assert status['data'] and 'ping' in status['data'][0]['tools'] and 'blocked' not in status['data'][0]['tools'], status
            result = rpc.request('mcpServer/tool/call', {'threadId': thread, 'server': 'fixture', 'tool': 'ping', 'arguments': {}})
            assert 'MCP_TOOL_EXECUTED' in json.dumps(result) and calls == ['ping'], result
            stdio = rpc.request('mcpServer/tool/call', {'threadId': thread, 'server': 'stdio', 'tool': 'ping', 'arguments': {}})
            assert 'STDIO_MCP_EXECUTED:PASSED' in json.dumps(stdio), stdio
            print('PASS production settings: effective context/instructions, skill discovery, HTTP MCP authentication, tool filtering and actual tool execution', flush=True)
        finally: rpc.close()

        oauth = copy.deepcopy(base)
        oauth['home'] = str(private / 'oauth')
        oauth['integration']['settings']['mcp_servers'][0].update(url=f'http://127.0.0.1:{server.server_port}/oauth-mcp', bearer_token='')
        oauth['integration']['mcp_config']['fixture']['url'] = f'http://127.0.0.1:{server.server_port}/oauth-mcp'
        oauth['integration']['mcp_config']['fixture'].pop('bearer_token_env_var', None)
        rpc = Rpc(oauth)
        try:
            rpc.request('initialize', {'clientInfo': {'name': 'hermess-settings-test', 'version': '1'}, 'capabilities': {'experimentalApi': True}})
            login = rpc.request('mcpServer/oauth/login', {'name': 'fixture', 'timeoutSecs': 30})
            with urllib.request.urlopen(login['authorizationUrl'], timeout=15) as response: response.read()
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                note = rpc.queue.get(timeout=30)
                if note and note.get('method') == 'mcpServer/oauthLogin/completed':
                    assert note['params']['success'], note
                    break
            else: raise AssertionError('OAuth completion missing')
            assert (Path(oauth['home']) / '.credentials.json').is_file(), [file.name for file in Path(oauth['home']).iterdir()]
        finally: rpc.close()
        rpc = Rpc({**oauth, 'home': str(private / 'oauth-reused')})
        try:
            rpc.request('initialize', {'clientInfo': {'name': 'hermess-settings-test', 'version': '1'}, 'capabilities': {'experimentalApi': True}})
            status = rpc.request('mcpServerStatus/list', {'serverName': 'fixture'})
            assert status['data'] and 'ping' in status['data'][0]['tools'], status
            print('PASS actual OAuth browser callback, product-only credential persistence and authentication reuse by another isolated home', flush=True)
        finally: rpc.close()

        def run_worker(initial):
            Path(initial['home']).mkdir(parents=True, exist_ok=True)
            stderr = (root / 'worker-errors.log').open('w', encoding='utf-8')
            process = subprocess.Popen([str(args.python.resolve()), str(repo / 'apps/desktop/runtime/programming_worker.py')],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr, env=env, text=True, encoding='utf-8', cwd=repo,
                creationflags=0x08000000 if os.name == 'nt' else 0)
            events = queue.Queue()
            def read():
                for line in process.stdout: events.put(json.loads(line))
                events.put(None)
            threading.Thread(target=read, daemon=True).start()
            process.stdin.write(json.dumps(initial) + '\n'); process.stdin.flush()
            received = []
            try:
                while True:
                    value = events.get(timeout=60)
                    assert value is not None, (received, (root / 'worker-errors.log').read_text(encoding='utf-8')[-4000:])
                    received.append(value)
                    if value.get('kind') == 'approval' and value.get('source') == 'mcp':
                        option = next(option for option in value['options'] if option['kind'] == 'once')
                        process.stdin.write(json.dumps({'kind': 'approval', 'id': value['id'], 'option_id': option['id']}) + '\n'); process.stdin.flush()
                    if value.get('kind') == ('settings_probe' if initial.get('action') == 'settings_probe' else 'result'):
                        process.wait(timeout=15)
                        assert not value.get('failed'), (value, received[-4:], (root / 'worker-errors.log').read_text(encoding='utf-8')[-4000:])
                        break
                process.wait(timeout=15)
                return received
            finally:
                if process.poll() is None: process.kill(); process.wait()
                process.stdin.close(); stderr.close()

        initial = {**base, 'home': str(private / 'turn')}
        probe = run_worker({**base, 'home': str(private / 'probe'), 'action': 'settings_probe'})
        assert probe[-1]['result']['success'] and len(probe[-1]['result']['servers']) == 2, probe[-1]
        events = run_worker(initial)
        thread = next(event['id'] for event in events if event['kind'] == 'thread')
        body = json.dumps(requests[-1])
        assert 'GLOBAL_INSTRUCTION_FIXTURE' in body and 'PROJECT_INSTRUCTION_FIXTURE' in body and 'SKILL_BODY_FIXTURE' in body, body[:1000]
        assert any(event.get('tool', {}).get('type') == 'skill' for event in events), events
        next_initial = copy.deepcopy(initial); next_initial['thread_id'] = thread
        next_initial['integration']['settings']['instructions']['developer_instructions'] = 'UPDATED_GLOBAL_INSTRUCTION_FIXTURE'
        (cwd / 'AGENTS.md').write_text('UPDATED_PROJECT_INSTRUCTION_FIXTURE\n', encoding='utf-8')
        run_worker(next_initial)
        body = json.dumps(requests[-1])
        assert 'UPDATED_GLOBAL_INSTRUCTION_FIXTURE' in body and 'UPDATED_PROJECT_INSTRUCTION_FIXTURE' in body, {key: key in body for key in ['UPDATED_GLOBAL_INSTRUCTION_FIXTURE', 'UPDATED_PROJECT_INSTRUCTION_FIXTURE', 'GLOBAL_INSTRUCTION_FIXTURE', 'PROJECT_INSTRUCTION_FIXTURE']}
        print('PASS actual worker: global/project instructions and skill body reach model; resumed thread receives saved instruction changes', flush=True)
        cleared = copy.deepcopy(next_initial)
        cleared['integration']['settings']['instructions']['developer_instructions'] = ''
        cleared['integration']['settings']['context'] = {**settings['context'], 'model_context_window': None, 'model_auto_compact_token_limit': None, 'tool_output_token_limit': None, 'model_post_turn_compact_threshold_percent': None, 'compact_prompt': ''}
        rpc = Rpc(cleared)
        try:
            rpc.request('initialize', {'clientInfo': {'name': 'hermess-settings-test', 'version': '1'}, 'capabilities': {'experimentalApi': True}})
            config = rpc.request('config/read', {'cwd': str(cwd), 'includeLayers': False})['config']
            assert config.get('model_context_window') is None and config.get('tool_output_token_limit') is None, config.get('model_context_window')
        finally: rpc.close()
        run_worker(cleared)
        assert 'No additional global programming instructions.' in json.dumps(requests[-1])
        print('PASS clearing global instructions and optional context settings takes effect on a resumed thread', flush=True)
        events = run_worker({**base, 'home': str(private / 'mcp-turn'), 'text': 'CALL_MCP'})
        assert len(calls) >= 2 and any(event.get('tool', {}).get('type') == 'mcpToolCall' for event in events), events
        print('PASS production MCP probe and model-driven MCP call through the actual worker', flush=True)
        (private / 'config.toml').write_bytes((args.fixtures / 'permissions.toml').read_bytes())
        extra = (args.fixtures / 'writable-root').resolve()
        writable_marker = extra / ('permission-' + uuid.uuid4().hex + '.txt')
        custom = {**base, 'home': str(private / 'custom-permissions'), 'permissions': 'custom', 'text': 'WRITE_OUTSIDE_FIXTURE'}
        rpc = Rpc(custom)
        try:
            rpc.request('initialize', {'clientInfo': {'name': 'hermess-settings-test', 'version': '1'}, 'capabilities': {'experimentalApi': True}})
            started = rpc.request('thread/start', {'cwd': str(cwd), 'model': base['model'], 'modelProvider': rpc.provider_id})
            assert started['sandbox']['networkAccess'] is True, started['sandbox']
            assert any(Path(path) == extra for path in started['sandbox']['writableRoots']), started['sandbox']
        finally: rpc.close()
        try:
            run_worker(custom)
            assert writable_marker.read_text(encoding='utf-8') == 'PERMISSION'
        finally:
            if writable_marker.exists(): writable_marker.unlink()
        print('PASS native-saved network/writable-root settings accepted and actual sandboxed tool writes the additional directory', flush=True)
        failed = copy.deepcopy(base)
        failed['home'] = str(private / 'failed-probe'); failed['action'] = 'settings_probe'
        failed['integration']['mcp_config']['fixture'].update(url=f'http://127.0.0.1:{server.server_port}/bad-mcp', startup_timeout_sec=1)
        result = run_worker(failed)[-1]['result']
        assert not result['success'], result
        print('PASS failed MCP discovery is reported as a failed connection check', flush=True)

        settings['disabled_skills'] = [str(skill / 'SKILL.md')]
        base['integration']['skills_config'] = {'config': [{'path': str(skill / 'SKILL.md'), 'enabled': False}]}
        rpc = Rpc({**base, 'home': str(private / 'disabled')})
        try:
            rpc.request('initialize', {'clientInfo': {'name': 'hermess-settings-test', 'version': '1'}, 'capabilities': {'experimentalApi': True}})
            rpc.request('skills/extraRoots/set', {'extraRoots': [str(skill_root)]})
            result = rpc.request('skills/list', {'cwds': [str(cwd)], 'forceReload': True})
            assert any(row['name'] == 'fixture-skill' and not row['enabled'] for entry in result['data'] for row in entry['skills']), result
            print('PASS saved skill disabling accepted by actual skill discovery', flush=True)
        finally: rpc.close()
    server.shutdown(); server.server_close()


if __name__ == '__main__':
    if '--stdio-mcp' in sys.argv: stdio_mcp()
    else: main()
