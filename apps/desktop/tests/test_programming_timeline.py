import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('worker', Path(__file__).parents[1] / 'runtime/programming_worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class TimelineTests(unittest.TestCase):
    def tool(self, item, method='item/completed'):
        return worker.tool_event({'method': method, 'params': {'item': {'id': 'test', **item}}})['tool']

    def test_dynamic_arguments_and_mcp_identity_survive_projection(self):
        value = self.tool({'type': 'dynamicToolCall', 'tool': 'draw', 'arguments': {'text': '你好'},
                           'success': False, 'contentItems': [{'type': 'inputText', 'text': 'failed'}]})
        self.assertIn('你好', value['detail'])
        self.assertEqual((value['summary'], value['output'], value['status']), ('draw', 'failed', 'failed'))
        self.assertEqual(self.tool({'type': 'mcpToolCall', 'server': 'docs', 'tool': 'read'})['summary'], 'docs/read')

    def test_images_and_agent_calls_are_visible_without_serializing_image_bytes(self):
        for kind in ('imageGeneration', 'imageView', 'collabAgentToolCall'):
            value = self.tool({'type': kind, 'path': '/image.png', 'savedPath': '/result.png', 'result': 'LARGE_BASE64'})
            self.assertEqual(value['type'], kind)
            self.assertNotIn('LARGE_BASE64', str(value))
        self.assertEqual(self.tool({'type': 'imageView'}, 'item/started')['status'], 'inProgress')

    def test_skill_read_is_marked_only_from_structured_read_actions(self):
        value = self.tool({'type': 'commandExecution', 'command': 'echo SKILL.md', 'commandActions': [
            {'type': 'read', 'path': 'C:\\project\\.agents\\skills\\review\\SKILL.md'},
            {'type': 'unknown', 'path': '/not-a-read/SKILL.md'},
        ]})
        self.assertEqual(value['skill_paths'], ['C:\\project\\.agents\\skills\\review\\SKILL.md'])
        self.assertEqual(self.tool({'type': 'commandExecution', 'command': 'echo SKILL.md'})['skill_paths'], [])

    def test_skill_mentions_resolve_enabled_unique_names_and_preserve_paths(self):
        catalog = {'skills': [{'name': 'review', 'enabled': True, 'path': '/project/.agents/skills/review/SKILL.md'},
                              {'name': 'disabled', 'enabled': False, 'path': '/disabled'}]}
        self.assertEqual(worker.skill_inputs('Use $review twice $review, not x$review or $disabled.', catalog),
                         [{'type': 'skill', 'name': 'review', 'path': catalog['skills'][0]['path']}])
        catalog['skills'].append({**catalog['skills'][0], 'path': '/other/SKILL.md'})
        with self.assertRaises(ValueError):
            worker.skill_inputs('$review', catalog)


if __name__ == '__main__':
    unittest.main()
