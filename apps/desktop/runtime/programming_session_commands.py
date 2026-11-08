"""Native session commands for the fixed App Server; embedded before the worker in production."""
import json
import queue
import time


def goal_request(session, command, emit):
    client, thread = session._client, session._thread_id
    action = command["action"]
    if action == "update" and client.request("thread/goal/get", {"threadId": thread})["goal"] is None:
        raise ValueError("Goal no longer exists")
    if action == "clear":
        client.request("thread/goal/clear", {"threadId": thread, "origin": "user"})
        goal = None
    elif action == "get":
        goal = client.request("thread/goal/get", {"threadId": thread})["goal"]
    else:
        params = {"threadId": thread, "origin": command.get("origin", "user")}
        if action in ("set", "update"):
            params["objective"] = command["objective"]
            if action == "set":
                params["status"] = "active"
            if "token_budget" in command:
                params["tokenBudget"] = command["token_budget"]
        else:
            params["status"] = "paused" if action == "pause" else "active"
        goal = client.request("thread/goal/set", params)["goal"]
    emit({"kind": "goal", "goal": goal, "operation": action})
    return goal


def answer_questions(request, emit, answers, interrupted):
    request_id = str(request["id"])
    questions = request["params"]["questions"]
    emit({"kind": "question", "id": request_id, "questions": questions})
    deadline = time.monotonic() + 600
    try:
        while not interrupted.is_set() and time.monotonic() < deadline:
            try:
                reply = answers.get(timeout=.25)
            except queue.Empty:
                continue
            if reply.get("kind") != "answer" or reply.get("id") != request_id:
                continue
            values = reply.get("answers") or {}
            if set(values) != {question["id"] for question in questions}:
                continue
            if all(isinstance(value, dict) and isinstance(value.get("answers"), list)
                   and 1 <= len(value["answers"]) <= 8 and all(isinstance(text, str) and 0 < len(text) <= 8192 for text in value["answers"])
                   for value in values.values()):
                return {"answers": values}
        if interrupted.is_set():
            return {"answers": {}}
        raise TimeoutError("question timed out")
    finally:
        emit({"kind": "question_closed", "id": request_id})


def pump_command(session, emit, on_event, controls, goal=None, turn_id=None):
    """Keep every native goal continuation attached; do not send synthetic 'continue' prompts."""
    client = session._client
    deadline = None if goal is not None else time.monotonic() + 1800
    stopping = False
    pending_note = None
    while deadline is None or time.monotonic() < deadline:
        try:
            command = controls.get_nowait()
        except queue.Empty:
            command = None
        if command:
            goal = goal_request(session, command, emit)
        if session._interrupt_event.is_set() and not stopping:
            stopping = True
            if goal and goal["status"] == "active":
                goal = goal_request(session, {"action": "pause"}, emit)
            session._issue_interrupt(session._active_turn_id or turn_id)
            deadline = min(deadline or float('inf'), time.monotonic() + 5)
        server_request = client.take_server_request(timeout=0)
        if server_request is not None:
            params = server_request.get("params") or {}
            if params.get("threadId") != session._thread_id:
                client.respond_error(server_request["id"], code=-32602, message="Foreign session request")
            else:
                session._handle_server_request(server_request)
        note = pending_note or client.take_notification(timeout=.1)
        pending_note = None
        if note is None:
            if not client.is_alive():
                raise RuntimeError("App Server exited during session command")
            continue
        method, params = note.get("method"), note.get("params") or {}
        if params.get("threadId") != session._thread_id:
            continue
        observed_turn = params.get("turnId") or (params.get("turn") or {}).get("id")
        if method == "turn/started":
            session._active_turn_id = observed_turn
        if method in ("thread/goal/updated", "thread/goal/cleared"):
            # Resume may queue its old empty snapshot before goal/set responds.
            # Reconcile against the current native state instead of ending the new goal on that snapshot.
            goal = client.request("thread/goal/get", {"threadId": session._thread_id})["goal"]
            note = {"method": "thread/goal/updated", "params": {"threadId": session._thread_id, "goal": goal}}
        on_event(note)
        if method == "turn/completed":
            if session._active_turn_id == observed_turn:
                session._active_turn_id = None
            turn = params["turn"]
            if turn["status"] == "failed":
                raise RuntimeError("Native command turn failed")
            if turn_id is not None and observed_turn == turn_id:
                return turn["status"] == "interrupted"
            if goal is not None:
                goal = client.request("thread/goal/get", {"threadId": session._thread_id})["goal"]
                emit({"kind": "goal", "goal": goal})
        if turn_id is None and session._active_turn_id is None and (goal is None or goal["status"] != "active"):
            # A metadata reply can overtake queued turn events. Drain them and verify native idleness
            # before closing, so the goal's final assistant response is not discarded.
            pending_note = client.take_notification(timeout=0)
            if pending_note is not None:
                continue
            thread = client.request("thread/read", {"threadId": session._thread_id, "includeTurns": False})["thread"]
            if thread["status"]["type"] == "idle":
                return stopping
    if goal and goal["status"] == "active":
        goal_request(session, {"action": "pause"}, emit)
    session._issue_interrupt(session._active_turn_id or turn_id)
    if stopping:
        return True
    raise TimeoutError("Session command timed out; goal paused")


def run_session_command(session, command, emit, on_event, controls, *, mode, model, effort):
    kind = command["type"]
    session._client.request("thread/settings/update", {"threadId": session._thread_id,
        "collaborationMode": {"mode": mode, "settings": {
            "model": model, "reasoning_effort": effort, "developer_instructions": None}}})
    if kind == "goal":
        goal = goal_request(session, command, emit)
        if command["action"] == "get" and goal is None:
            emit({"kind": "message", "text": "当前会话未设置目标。"})
        if goal and goal["status"] == "active" and command["action"] in ("set", "resume"):
            interrupted = pump_command(session, emit, on_event, controls, goal=goal)
        else:
            interrupted = False
    elif kind == "compact":
        result = session.compact_thread(turn_timeout=600)
        if result.error:
            raise RuntimeError("Native compaction failed")
        interrupted = result.interrupted
        if not interrupted:
            emit({"kind": "message", "text": "上下文已由 Codex 原生压缩。"})
    elif kind == "review":
        result = session._client.request("review/start", {"threadId": session._thread_id, "target": command["target"], "delivery": "inline"})
        interrupted = pump_command(session, emit, on_event, controls, turn_id=result["turn"]["id"])
    else:
        raise ValueError("Unsupported session command")
    emit({"kind": "result", "text": "", "interrupted": interrupted, "failed": False})
