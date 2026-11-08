"""The production worker's event classifier, without loading credentials or Hermes homes."""
import importlib.util
import queue
import site
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "runtime/programming_worker.py"
ROOT = PATH.parents[3]
site.addsitedir(str(ROOT / ".build/computer-activity-python-deps"))
site.addsitedir(str(ROOT / ".build/payload/venv/Lib/site-packages"))
import sys
sys.path.insert(0, str(ROOT / "upstream/hermes-agent"))
SPEC = importlib.util.spec_from_file_location("computer_activity_worker", PATH)
WORKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORKER)


def event(method="item/started", **item):
    return {"method": method, "params": {"threadId": "thread", "turnId": "turn",
            "item": {"type": "dynamicToolCall", "tool": "hermess_computer_use", "id": "call", **item}}}


def test_local_desktop_lifecycle_has_identity_but_no_input_content():
    note = event(arguments={"text": "sensitive input"})
    actual = WORKER.computer_activity_event(note)
    assert actual == {"kind": "computer_activity", "started": True,
                      "thread_id": "thread", "turn_id": "turn", "tool_id": "call"}
    assert WORKER.computer_activity_event(event("item/completed"))["started"] is False


def test_shell_files_search_and_unregistered_remote_tools_never_trigger():
    for item in ({"type": "commandExecution", "command": "computer_use click"},
                 {"type": "fileChange"}, {"type": "webSearch"},
                 {"type": "mcpToolCall", "server": "remote-desktop"}, {"tool": "terminal"}, {"id": ""}):
        assert WORKER.computer_activity_event(event(**item)) is None
    assert WORKER.computer_activity_event(event("item/commandExecution/outputDelta")) is None


def test_computer_permissions_never_inherit_full_programming_access():
    for selected in ("once", "deny", "cancel"):
        answers = queue.Queue()
        seen, invoked, interrupted = [], [], []
        def emit(note):
            seen.append(note)
            if note["kind"] == "approval":
                assert note["source"] == "computer"
                assert [option["kind"] for option in note["options"]] == ["once", "deny", "cancel"]
                option = next(option for option in note["options"] if option["kind"] == selected)
                answers.put({"kind": "approval", "id": note["id"], "option_id": option["id"]})
        def native(arguments, **kwargs):
            invoked.append(arguments)
            return '{"ok":true}'
        result = WORKER.run_computer_tool({"threadId":"thread", "turnId":"turn", "callId":"call", "arguments":{"action":"click","coordinate":[1,2]}},
                                         {"cwd":"project", "permissions":"full"}, emit, answers, lambda: interrupted.append(True), native)
        assert bool(invoked) == (selected == "once")
        assert result["success"] == (selected == "once")
        assert bool(interrupted) == (selected == "cancel")
        assert any(note["kind"] == "computer_activity" and note["started"] for note in seen) == (selected == "once")


def test_invalid_input_cannot_reach_approval_or_native_and_images_are_returned():
    called = []
    result = WORKER.run_computer_tool({"arguments":{"action":"click","coordinate":[True,"bad"]}},
                                     {"cwd":"project"}, called.append, queue.Queue(), lambda: None)
    assert not result["success"] and called == []
    result = WORKER.computer_tool_response({"_multimodal":True,"content":[{"type":"text","text":"capture"},
             {"type":"image_url","image_url":{"url":"data:image/png;base64,AA=="}}]})
    assert result == {"success":True,"contentItems":[{"type":"inputText","text":"capture"},
                      {"type":"inputImage","imageUrl":"data:image/png;base64,AA=="}]}


def test_macos_does_not_launch_a_driver_outside_the_managed_process_tree(monkeypatch):
    monkeypatch.setattr(WORKER.sys, "platform", "darwin")
    emitted = []
    result = WORKER.run_computer_tool({}, {}, emitted.append, queue.Queue(), lambda: None)
    assert not result["success"]
    assert "macOS" in result["contentItems"][0]["text"]
    assert emitted == []
