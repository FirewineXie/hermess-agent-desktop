import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import queue

spec = importlib.util.spec_from_file_location('programming_worker', Path(__file__).parents[1] / 'runtime/programming_worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class ApprovalOptionsTests(unittest.TestCase):
    def test_explicit_decisions_preserve_exact_rule_and_order(self):
        rule = {'acceptWithExecpolicyAmendment': {'execpolicy_amendment': ['git', 'status']}}
        rows = worker.approval_options({'availableDecisions': ['accept', rule, 'cancel']})
        self.assertEqual([row['kind'] for row in rows], ['once', 'command_rule', 'cancel'])
        self.assertEqual(rows[1]['decision'], rule)
        self.assertEqual(rows[1]['detail'], '["git", "status"]')

    def test_human_checkpoint_does_not_offer_reusable_grants(self):
        rows = worker.approval_options({'kind': 'humanCommand', 'availableDecisions': ['accept', 'acceptForSession', 'decline', 'cancel']})
        self.assertEqual([row['kind'] for row in rows], ['once', 'deny', 'cancel'])

    def test_legacy_defaults_match_locked_protocol_and_do_not_invent_session_grants(self):
        self.assertEqual([row['kind'] for row in worker.approval_options({})], ['once', 'cancel'])
        self.assertEqual([row['kind'] for row in worker.approval_options({}, True)], ['once', 'session', 'deny', 'cancel'])
        self.assertEqual(worker.approval_options({'availableDecisions': []}), [])

    def test_timeout_closes_prompt_without_granting_permissions(self):
        for file_change, expected in [(False, 'cancel'), (True, 'decline')]:
            events = []
            result = worker.request_approval({}, events.append, queue.Queue(), '/project', file_change, timeout=0)
            self.assertEqual(result, {'decision': expected})
            self.assertEqual([event['kind'] for event in events], ['approval', 'approval_closed'])
            self.assertEqual(events[-1]['outcome'], 'timeout')
            self.assertEqual(events[0]['id'], events[1]['id'])

    def test_stale_or_unoffered_answers_cannot_broaden_approval(self):
        replies = queue.Queue()
        replies.put({'id': 'old', 'option_id': 'option-0'})
        replies.put({'id': 'request', 'option_id': 'invented-persistent-rule'})
        replies.put({'id': 'request', 'option_id': 'option-0'})
        events = []
        with patch.object(worker.uuid, 'uuid4', return_value='request'):
            result = worker.request_approval({'availableDecisions': ['accept', 'cancel']}, events.append, replies, '/project')
        self.assertEqual(result, {'decision': 'accept'})
        self.assertEqual(events[-1]['outcome'], 'once')

    def test_queued_answer_after_deadline_is_not_accepted(self):
        replies = queue.Queue()
        replies.put({'id': 'request', 'option_id': 'option-0'})
        events = []
        with patch.object(worker.uuid, 'uuid4', return_value='request'):
            result = worker.request_approval({'availableDecisions': ['accept', 'cancel']}, events.append, replies, '/project', timeout=0)
        self.assertEqual(result, {'decision': 'cancel'})
        self.assertEqual(events[-1]['outcome'], 'timeout')


class McpConfirmationTests(unittest.TestCase):
    def test_mcp_confirmation_uses_existing_once_option_and_closes(self):
        replies = queue.Queue()
        events = []
        def emit(event):
            events.append(event)
            if event['kind'] == 'approval':
                option = next(option for option in event['options'] if option['kind'] == 'once')
                replies.put({'kind': 'approval', 'id': event['id'], 'option_id': option['id']})
        result = worker.request_mcp_confirmation({'serverName': 'fixture', 'message': 'Confirm?', 'requestedSchema': {'type': 'object', 'properties': {}}}, emit, replies)
        self.assertEqual(result, {'action': 'accept', 'content': {}, '_meta': None})
        self.assertEqual(events[0]['source'], 'mcp')
        self.assertEqual(events[-1]['outcome'], 'once')

    def test_extra_forms_and_timeouts_are_not_approved(self):
        events = []
        result = worker.request_mcp_confirmation({'serverName': 'fixture', 'requestedSchema': {'properties': {'value': {'type': 'string'}}}}, events.append, queue.Queue())
        self.assertEqual(result['action'], 'decline')
        result = worker.request_mcp_confirmation({'serverName': 'fixture'}, events.append, queue.Queue(), timeout=0)
        self.assertEqual(result['action'], 'cancel')
        self.assertEqual(events[-1]['outcome'], 'timeout')


if __name__ == '__main__':
    unittest.main()
