"""Exercise the production command adapter against the locked real App Server and synthetic Responses."""
import argparse
import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--codex', type=Path, required=True)
    parser.add_argument('--python', type=Path, required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[3]
    scenario = 'plain'
    requests = []
    server_errors = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            try:
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                assert self.headers.get('Authorization') == 'Bearer SESSION_FIXTURE_ONLY'
                requests.append((self.path, body))
                count = len(requests)
                text = 'SESSION_FIXTURE_OK'
                if scenario == 'goal' and count >= 3:
                    time.sleep(.5)
                    text = 'SESSION_GOAL_FINAL_OK'
                if scenario == 'review':
                    text = json.dumps({'findings': [], 'overall_correctness': 'patch is correct',
                                       'overall_explanation': 'NATIVE_REVIEW_FIXTURE_OK', 'overall_confidence_score': 1.0})
                item = {'type': 'message', 'id': f'msg_{count}', 'role': 'assistant', 'status': 'completed',
                        'content': [{'type': 'output_text', 'text': text, 'annotations': []}]}
                if scenario == 'goal' and count == 2:
                    assert any(tool.get('name') == 'update_goal' for tool in body['tools']), [tool.get('name') for tool in body['tools']]
                    item = {'type': 'function_call', 'id': 'fc_goal', 'call_id': 'call_goal', 'name': 'update_goal',
                            'arguments': json.dumps({'status': 'complete'}), 'status': 'completed'}
                if scenario == 'plan' and count == 1:
                    assert any(tool.get('name') == 'request_user_input' for tool in body['tools'])
                    item = {'type': 'function_call', 'id': 'fc_plan', 'call_id': 'call_plan', 'name': 'request_user_input',
                            'arguments': json.dumps({'questions': [{'id': 'approach', 'header': 'Approach', 'question': 'Choose an approach',
                                'options': [{'label': 'A', 'description': 'First approach'}, {'label': 'B', 'description': 'Second approach'}]}]}), 'status': 'completed'}
                events = [
                    {'type': 'response.created', 'response': {'id': f'resp_{count}', 'status': 'in_progress', 'output': []}},
                    {'type': 'response.output_item.added', 'output_index': 0, 'item': item},
                ]
                if item['type'] == 'message':
                    events.append({'type': 'response.output_text.delta', 'item_id': item['id'], 'output_index': 0, 'content_index': 0, 'delta': text})
                events.extend([
                    {'type': 'response.output_item.done', 'output_index': 0, 'item': item},
                    {'type': 'response.completed', 'response': {'id': f'resp_{count}', 'status': 'completed', 'output': [item],
                        'usage': {'input_tokens': 10, 'output_tokens': 3, 'total_tokens': 13}}},
                ])
                if self.path.endswith('/compact'):
                    data = json.dumps({'output': [{'type': 'compaction', 'encrypted_content': 'SESSION_COMPACT_FIXTURE'}]}).encode()
                    content_type = 'application/json'
                else:
                    data = ''.join('event: ' + event['type'] + '\ndata: ' + json.dumps(event) + '\n\n' for event in events).encode()
                    content_type = 'text/event-stream'
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except Exception as error:
                server_errors.append(repr(error))
                self.send_error(500)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='session-commands-', dir=repo / '.build') as temporary:
        root = Path(temporary)
        home = root / 'home'; home.mkdir()
        cwd = root / 'project'; cwd.mkdir()
        subprocess.run(['git', 'init', '-q', str(cwd)], check=True, creationflags=0x08000000 if os.name == 'nt' else 0)
        subprocess.run(['git', '-C', str(cwd), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'fixture'], check=True, creationflags=0x08000000 if os.name == 'nt' else 0)
        commit = subprocess.check_output(['git', '-C', str(cwd), 'rev-parse', 'HEAD'], text=True, creationflags=0x08000000 if os.name == 'nt' else 0).strip()
        subprocess.run(['git', '-C', str(cwd), 'branch', 'fixture-base'], check=True, creationflags=0x08000000 if os.name == 'nt' else 0)
        env = {name: os.environ[name] for name in ('PATH', 'SystemRoot', 'SystemDrive', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE') if name in os.environ}
        env.update(PYTHONPATH=str(repo / 'upstream/hermes-agent'), PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
        initial = {'home': str(home), 'private_root': str(root), 'cwd': str(cwd), 'executable': str(args.codex.resolve()),
            'connection_id': 'session-fixture', 'model': 'gpt-5.2-codex', 'effort': 'medium', 'api_key': 'SESSION_FIXTURE_ONLY',
            'base_url': f'http://127.0.0.1:{server.server_port}/v1', 'permissions': 'request', 'text': 'Session command fixture', 'images': []}

        def run(extra, control=None, expect_failure=False):
            events = []
            process = subprocess.Popen([str(args.python.resolve()), '-P', '-u', str(repo / 'apps/desktop/runtime/programming_worker.py')],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', cwd=home, env=env,
                creationflags=0x08000000 if os.name == 'nt' else 0)
            output = queue.Queue()
            def reader():
                for line in process.stdout:
                    output.put(json.loads(line))
                output.put(None)
            threading.Thread(target=reader, daemon=True).start()
            process.stdin.write(json.dumps({**initial, **extra}) + '\n'); process.stdin.flush()
            deadline = time.monotonic() + 80
            controls = control if isinstance(control, list) else ([control] if control else [])
            sent = 0
            try:
                while time.monotonic() < deadline:
                    try:
                        event = output.get(timeout=max(1, deadline - time.monotonic()))
                    except queue.Empty:
                        raise AssertionError({'events': events, 'requests': len(requests), 'server_errors': server_errors}) from None
                    assert event is not None, ('worker exited', process.stderr.read())
                    events.append(event)
                    if event['kind'] == 'question':
                        process.stdin.write(json.dumps({'kind': 'answer', 'id': event['id'], 'answers': {'approach': {'answers': ['B']}}}) + '\n'); process.stdin.flush()
                    if sent < len(controls) and len(requests) >= 2 + sent:
                        process.stdin.write(json.dumps(controls[sent]) + '\n'); process.stdin.flush(); sent += 1
                    if event['kind'] == 'result':
                        assert event['failed'] == expect_failure, (event, server_errors, process.stderr.read() if process.poll() is not None else '')
                        return events
                raise AssertionError('Session command timed out')
            finally:
                process.stdin.close()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait()

        events = run({})
        thread = next(event['id'] for event in events if event['kind'] == 'thread')
        scenario = 'review'; requests.clear()
        events = run({'thread_id': thread, 'command': {'type': 'review', 'target': {'type': 'uncommittedChanges'}}})
        assert any('NATIVE_REVIEW_FIXTURE_OK' in event.get('text', '') for event in events), events
        print('PASS native review/start and ExitedReviewMode report', flush=True)
        for target in [{'type': 'baseBranch', 'branch': 'fixture-base'}, {'type': 'commit', 'sha': commit, 'title': None}, {'type': 'custom', 'instructions': 'Review the fixture for bugs'}]:
            events = run({'thread_id': thread, 'command': {'type': 'review', 'target': target}})
            assert any('NATIVE_REVIEW_FIXTURE_OK' in event.get('text', '') for event in events), target
        print('PASS native base-branch, commit and custom review targets', flush=True)
        before = len(requests)
        run({'thread_id': thread, 'command': {'type': 'review', 'target': {'type': 'invalidTarget'}}}, expect_failure=True)
        assert len(requests) == before, 'Invalid native review target must not reach the model'
        scenario = 'plain'; requests.clear()
        events = run({'thread_id': thread, 'command': {'type': 'compact'}})
        assert any('原生压缩' in event.get('text', '') for event in events), events
        assert requests, 'Compaction must contact the actual model fixture'
        print('PASS native thread/compact/start completes', flush=True)
        scenario = 'plan'; requests.clear()
        events = run({'thread_id': thread, 'mode': 'plan', 'text': 'Plan the fixture implementation'})
        assert any(event['kind'] == 'question' for event in events)
        assert len(requests) >= 2 and 'B' in json.dumps(requests[-1][1]['input'])
        print('PASS plan mode enables real request_user_input and returns the user answer', flush=True)
        scenario = 'goal'; requests.clear()
        events = run({'thread_id': thread, 'command': {'type': 'goal', 'action': 'set', 'objective': 'Finish SESSION_GOAL_FIXTURE'}})
        assert any(event['kind'] == 'goal' and (event.get('goal') or {}).get('status') == 'complete' for event in events), events
        assert len(requests) >= 3, len(requests)
        assert any('SESSION_GOAL_FINAL_OK' in event.get('text', '') for event in events), 'Final goal response must not be lost when goal completion precedes final text'
        print('PASS native goal auto-continuation and model-driven completion across turns', flush=True)
        requests.clear()
        events = run({'thread_id': thread, 'command': {'type': 'goal', 'action': 'update', 'objective': 'Completed goal edited without restarting'}})
        assert any(event['kind'] == 'goal' and (event.get('goal') or {}).get('status') == 'complete' for event in events)
        assert not requests, 'Editing a completed goal must not start inference'
        scenario = 'plain'; requests.clear()
        events = run({'thread_id': thread, 'command': {'type': 'goal', 'action': 'set', 'objective': 'Keep working until paused', 'token_budget': 1000}},
                     [{'kind': 'command', 'command': {'type': 'goal', 'action': 'update', 'objective': 'ACTIVE_EDIT_FIXTURE'}},
                      {'kind': 'command', 'command': {'type': 'goal', 'action': 'pause'}}])
        assert any(event['kind'] == 'goal' and event.get('operation') == 'update' and event['goal']['objective'] == 'ACTIVE_EDIT_FIXTURE' and event['goal']['status'] == 'active' and event['goal']['tokenBudget'] == 1000 for event in events), events
        assert len(requests) >= 3, 'Native execution must continue after the edit'
        assert any(event['kind'] == 'goal' and (event.get('goal') or {}).get('status') == 'paused' for event in events), events
        requests.clear()
        events = run({'thread_id': thread, 'command': {'type': 'goal', 'action': 'update', 'objective': 'PAUSED_EDIT_FIXTURE'}})
        assert any(event['kind'] == 'goal' and event['goal']['objective'] == 'PAUSED_EDIT_FIXTURE' and event['goal']['status'] == 'paused' and event['goal']['tokenBudget'] == 1000 for event in events)
        assert not requests, 'Editing a paused goal must not resume it'
        print('PASS active, paused and completed goal edits preserve native status/budget; active execution continues', flush=True)
        events = run({'thread_id': thread, 'command': {'type': 'goal', 'action': 'get'}})
        assert any(event['kind'] == 'goal' and event['goal']['status'] == 'paused' for event in events)
        assert not requests, 'Inspecting a paused goal must not start inference'
        scenario = 'goal'; requests.clear()
        events = run({'thread_id': thread, 'command': {'type': 'goal', 'action': 'resume'}})
        assert any(event['kind'] == 'goal' and (event.get('goal') or {}).get('status') == 'complete' for event in events)
        scenario = 'plain'; requests.clear()
        events = run({'thread_id': thread, 'command': {'type': 'goal', 'action': 'clear'}})
        assert any(event['kind'] == 'goal' and event.get('goal') is None for event in events)
        assert not requests
        run({'thread_id': thread, 'command': {'type': 'goal', 'action': 'update', 'objective': 'Must not recreate a cleared goal'}}, expect_failure=True)
        assert not requests, 'Editing a deleted goal must not create it or start inference'
        print('PASS goal pause, persisted get, resume and clear use the same native thread', flush=True)
        requests.clear()
        events = run({'thread_id': thread, 'command': {'type': 'goal', 'action': 'set', 'objective': 'Test explicit budget', 'token_budget': 1}})
        assert any(event['kind'] == 'goal' and (event.get('goal') or {}).get('status') == 'budgetLimited' for event in events), events
        print('PASS explicit native goal token budget stops continuation', flush=True)
        run({'thread_id': thread, 'command': {'type': 'goal', 'action': 'clear'}})
        requests.clear()
        events = run({'thread_id': thread, 'command': {'type': 'goal', 'action': 'set', 'objective': 'Test stop'}}, {'kind': 'stop'})
        assert events[-1]['interrupted']
        assert any(event['kind'] == 'goal' and (event.get('goal') or {}).get('status') == 'paused' for event in events)
        print('PASS stop interrupts the active native turn and pauses the persisted goal', flush=True)
        run({'thread_id': thread, 'command': {'type': 'goal', 'action': 'clear'}})
        before = len(requests)
        run({'thread_id': thread, 'command': {'type': 'goal', 'action': 'set', 'objective': 'Invalid budget', 'token_budget': 0}}, expect_failure=True)
        run({'thread_id': thread, 'mode': 'invalid-mode'}, expect_failure=True)
        assert len(requests) == before, 'Invalid budget and collaboration mode must fail before inference'
        print('PASS native rejection of invalid review target, goal budget and plan mode without inference', flush=True)
        assert not server_errors, server_errors
    server.shutdown(); server.server_close()


if __name__ == '__main__':
    main()
