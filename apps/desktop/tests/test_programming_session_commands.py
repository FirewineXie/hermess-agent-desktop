import importlib.util
from pathlib import Path
import queue
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('session_commands', Path(__file__).parents[1] / 'runtime/programming_session_commands.py')
commands = importlib.util.module_from_spec(spec)
spec.loader.exec_module(commands)


class SessionCommandTests(unittest.TestCase):
    def test_questions_ignore_stale_answers_and_close_after_real_answer(self):
        answers = queue.Queue()
        answers.put({'kind': 'answer', 'id': 'old', 'answers': {'q': {'answers': ['A']}}})
        answers.put({'kind': 'answer', 'id': '1', 'answers': {'wrong': {'answers': ['A']}}})
        answers.put({'kind': 'answer', 'id': '1', 'answers': {'q': {'answers': ['B']}}})
        events = []
        result = commands.answer_questions({'id': 1, 'params': {'questions': [{'id': 'q'}]}}, events.append, answers, threading.Event())
        self.assertEqual(result, {'answers': {'q': {'answers': ['B']}}})
        self.assertEqual([event['kind'] for event in events], ['question', 'question_closed'])

    def test_question_timeout_is_an_error_and_closes_question(self):
        events = []
        with patch.object(commands.time, 'monotonic', side_effect=[0, 601]):
            with self.assertRaises(TimeoutError):
                commands.answer_questions({'id': 1, 'params': {'questions': []}}, events.append, queue.Queue(), threading.Event())
        self.assertEqual(events[-1]['kind'], 'question_closed')

    def test_user_stop_cancels_question_without_inventing_an_answer(self):
        stopped = threading.Event(); stopped.set()
        self.assertEqual(commands.answer_questions({'id': 1, 'params': {'questions': [{'id': 'q'}]}}, lambda _: None, queue.Queue(), stopped), {'answers': {}})


if __name__ == '__main__':
    unittest.main()
