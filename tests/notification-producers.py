"""Validate the locked runtime's local plugin notification producer without user data."""
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "upstream/hermes-agent"))
from gateway.plugin_messages import PostTarget, _publish_local


class PluginNotificationProducer(unittest.TestCase):
    def test_local_post_and_edit_keep_key_and_session(self):
        emitted = []

        def publish(session, payload, *, event_type):
            emitted.append((session, event_type, payload))
            return True

        target = PostTarget(platform="local", chat_id="test-session",
                            live=SimpleNamespace(event_stream=SimpleNamespace(publish=publish)),
                            notice_key="plugin-message:test:123")
        first = _publish_local(target, "First")
        edited = _publish_local(target, "Edited")
        self.assertEqual(first["message_id"], edited["message_id"])
        self.assertTrue(first["delivered"] and edited["delivered"])
        self.assertEqual([row[:2] for row in emitted], [("test-session", "notification.show")] * 2)
        self.assertEqual([row[2]["text"] for row in emitted], ["First", "Edited"])
        for _, _, payload in emitted:
            self.assertEqual(payload["key"], "plugin-message:test:123")
            self.assertEqual(payload["id"], payload["key"])

    def test_disconnected_viewer_is_reported_by_producer(self):
        target = PostTarget(platform="local", chat_id="test-session",
                            live=SimpleNamespace(event_stream=SimpleNamespace(publish=lambda *a, **kw: False)),
                            notice_key="plugin-message:test:456")
        self.assertFalse(_publish_local(target, "Not delivered")["delivered"])


if __name__ == "__main__":
    unittest.main()
