"""Product adapter for the locked Hermes App Server session; stdin/stdout are private pipes."""
import json
import hashlib
import os
import queue
import re
import sys
import threading
import time
import tomllib
import uuid
from pathlib import Path

if "run_session_command" not in globals():
    # Source-mode tests load the same helper embedded by the native adapter.
    exec(compile(Path(__file__).with_name("programming_session_commands.py").read_text(encoding="utf-8"),
                 "<hermess-session-commands>", "exec"), globals())


def computer_activity_event(note):
    """Completion comes from the actual dynamic-tool lifecycle, not shell text."""
    method = note.get("method")
    if method not in ("item/started", "item/completed"):
        return None
    params = note.get("params") or {}
    item = params.get("item") or {}
    if item.get("type") != "dynamicToolCall" or item.get("tool") != "hermess_computer_use":
        return None
    if not all(isinstance(value, str) and value for value in (params.get("threadId"), params.get("turnId"), item.get("id"))):
        return None
    return {"kind": "computer_activity", "started": method == "item/started",
            "thread_id": params["threadId"], "turn_id": params["turnId"], "tool_id": item["id"]}


def computer_tool_spec():
    from tools.computer_use.schema import get_computer_use_schema
    schema = get_computer_use_schema()
    return {"type": "function", "name": "hermess_computer_use", "description": schema["description"] +
            " This tool operates the user's real computer. Each call requires explicit approval in Hermess; "
            "it is separate from programming filesystem permissions. If the driver is missing, ask the user "
            "to install cua-driver from Hermess desktop tools settings. Never use shell scripts to bypass this tool.",
            "inputSchema": schema["parameters"]}


def computer_tool_response(result):
    if isinstance(result, dict) and result.get("_multimodal"):
        content = []
        for item in result.get("content", []):
            if item.get("type") == "text":
                content.append({"type": "inputText", "text": item["text"]})
            elif item.get("type") == "image_url":
                content.append({"type": "inputImage", "imageUrl": item["image_url"]["url"]})
        return {"success": True, "contentItems": content}
    text = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
    try:
        value = json.loads(text)
        success = not (isinstance(value, dict) and (value.get("error") or value.get("ok") is False))
    except ValueError:
        success = True
    return {"success": success, "contentItems": [{"type": "inputText", "text": text}]}


def run_computer_tool(params, initial, emit, answers, interrupt, native=None):
    """Only called by the active thread/turn's validated item/tool/call handler."""
    if sys.platform == "darwin" and native is None:
        return computer_tool_response({"error": "macOS 电脑操作尚未启用：驱动独立启动的退出回收适配尚未完成。"})
    try:
        from jsonschema import validate, ValidationError
    except ImportError:
        return computer_tool_response({"error": "电脑操作运行依赖缺失，请修复 Hermess 运行时的 computer-use 依赖。"})
    arguments = params.get("arguments")
    try:
        validate(arguments, computer_tool_spec()["inputSchema"])
    except ValidationError:
        return computer_tool_response({"error": "电脑操作参数无效"})
    action = arguments["action"]
    target = arguments.get("app") or "当前活动应用"
    delivery = "前台" if arguments.get("delivery_mode") == "foreground" or arguments.get("bring_to_front") else "默认投递"
    decision = request_approval({"command": f"电脑操作：{action}\n目标：{target}\n方式：{delivery}",
        "reason": "此操作会读取或控制本机桌面，独立于编程文件权限。请确认目标应用后允许一次。",
        "availableDecisions": ["accept", "decline", "cancel"]}, emit, answers, initial["cwd"], source="computer")
    if decision["decision"] != "accept":
        if decision["decision"] == "cancel":
            interrupt()
        return computer_tool_response({"error": "电脑操作未获批准"})
    call_id = params["callId"]
    emit({"kind": "computer_activity", "started": True, "tool_id": call_id,
          "thread_id": params["threadId"], "turn_id": params["turnId"]})
    try:
        if native is None:
            try:
                from mcp import ClientSession  # validate Windows .pth/DLL initialization before the fork's async startup
            except ImportError:
                emit({"kind": "computer_result", "tool_id": call_id, "outcome": "dependency_missing"})
                return computer_tool_response({"error": "电脑操作组件加载失败，请修复 Hermess 运行时的 computer-use 依赖。"})
            from pm import installed_package
            from tools.computer_use import tool
            installed = None
            for root in initial.get("computer_tools_roots", []):
                os.environ["HERMES_RUNTIME_DIR"] = root
                installed = installed_package("cua-driver")
                if installed and installed.binary:
                    break
            if not installed or not installed.binary:
                emit({"kind": "computer_result", "tool_id": call_id, "outcome": "driver_missing"})
                return computer_tool_response({"error": "尚未安装电脑操作驱动，请在 Hermess 设置 → 桌面 → 工具与能力中安装 cua-driver。"})
            # An absolute PM-selected product binary; never inherit a personal driver from PATH.
            os.environ["HERMES_CUA_DRIVER_CMD"] = str(installed.binary)
            os.environ["HERMES_INTERACTIVE"] = "1"
            # The outer approval covered this exact call, including its foreground/focus arguments.
            tool.set_approval_callback(lambda *_args, **_kwargs: "once")
            native = tool.handle_computer_use
        response = computer_tool_response(native(arguments, session_id=params["threadId"]))
        emit({"kind": "computer_result", "tool_id": call_id, "outcome": "completed" if response["success"] else "native_failed"})
        return response
    except Exception:
        emit({"kind": "computer_result", "tool_id": call_id, "outcome": "exception"})
        return computer_tool_response({"error": "电脑操作失败，请检查驱动、系统权限和客户端日志；不要重复未经确认的输入。"})
    finally:
        emit({"kind": "computer_activity", "started": False, "tool_id": call_id,
              "thread_id": params["threadId"], "turn_id": params["turnId"]})


def custom_permissions(initial):
    path = Path(initial["private_root"]) / "config.toml"
    if not path.exists():
        return {}
    with path.open("rb") as handle:
        config = tomllib.load(handle)
    return {key: config[key] for key in ("default_permissions", "permissions", "approval_policy", "approvals_reviewer",
            "sandbox_mode", "sandbox_workspace_write", "auto_review") if key in config}


def permission_mode(initial, custom=None):
    mode = initial.get("permissions", "request")
    if mode in ("hermess", "hermess-readonly"):
        return {"default_permissions": mode, "approval_policy": "on-request", "approvals_reviewer": "user"}
    if mode in ("request", "auto"):
        return {"default_permissions": "hermess", "approval_policy": "on-request",
                "approvals_reviewer": "auto_review" if mode == "auto" else "user"}
    if mode == "full":
        return {"default_permissions": ":danger-full-access", "approval_policy": "never", "approvals_reviewer": "user"}
    if mode != "custom":
        raise RuntimeError("Unknown programming permission mode")
    custom = custom_permissions(initial) if custom is None else custom
    legacy = {"read-only": ":read-only", "workspace-write": ":workspace", "danger-full-access": ":danger-full-access"}
    profile = custom.get("default_permissions") or legacy.get(custom.get("sandbox_mode"), "hermess")
    result = {"default_permissions": profile, "approval_policy": custom.get("approval_policy", "on-request"),
              "approvals_reviewer": custom.get("approvals_reviewer", "user")}
    if result["approvals_reviewer"] == "guardian_subagent":
        result["approvals_reviewer"] = "auto_review"
    for key in ("permissions", "sandbox_workspace_write", "auto_review"):
        if key in custom:
            result[key] = custom[key]
    return result


def toml_value(value):
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(k) + "=" + toml_value(v) for k, v in value.items()) + "}"
    if isinstance(value, list):
        return "[" + ",".join(toml_value(v) for v in value) + "]"
    if isinstance(value, (int, float)):
        return str(value)
    return json.dumps(value, ensure_ascii=False)


def integration_options(initial):
    settings = (initial.get("integration") or {}).get("settings") or {}
    result = {}
    instructions = settings.get("instructions") or {}
    for name in ("developer_instructions", "project_doc_max_bytes", "project_doc_fallback_filenames"):
        if name in instructions:
            result[name] = instructions[name]
    for name, value in (settings.get("context") or {}).items():
        if value is not None and value != "":
            result[name] = value
    if "disabled_skills" in settings:
        result["skills"] = {"config": [{"path": path, "enabled": False} for path in settings["disabled_skills"]]}
    servers = {}
    for row in ([] if "mcp_config" in (initial.get("integration") or {}) else settings.get("mcp_servers", [])):
        config = {"enabled": row["enabled"], "startup_timeout_sec": row["startup_timeout_sec"], "tool_timeout_sec": row["tool_timeout_sec"]}
        if row["transport"] == "stdio":
            config.update(command=row["command"], args=row["args"], env=row["env"])
            if row["cwd"]:
                config["cwd"] = row["cwd"]
        else:
            config.update(url=row["url"], http_headers=row["http_headers"])
            if row["bearer_token"]:
                config["http_headers"] = {**config["http_headers"], "Authorization": "Bearer " + row["bearer_token"]}
        for name in ("enabled_tools", "disabled_tools"):
            if row[name]:
                config[name] = row[name]
        servers[row["id"]] = config
    if "mcp_servers" in settings:
        result["mcp_servers"] = servers
    integration = initial.get("integration") or {}
    if "mcp_config" in integration:
        result["mcp_servers"] = integration["mcp_config"]
    if "skills_config" in integration:
        result["skills"] = integration["skills_config"]
    return result


def prepare_integration_config(initial):
    # Credentials and long instruction text travel through the private config file, never argv.
    options = integration_options(initial)
    home = Path(initial["home"])
    path = home / "config.toml"
    if options:
        if path.is_symlink():
            raise RuntimeError("Unsafe programming configuration path")
        existing = tomllib.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        for name in ("mcp_servers", "skills", "developer_instructions", "project_doc_max_bytes", "project_doc_fallback_filenames",
                     "model_context_window", "model_auto_compact_token_limit", "tool_output_token_limit", "model_post_turn_compact_threshold_percent", "compact_prompt"):
            existing.pop(name, None)
        existing.update(options)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write("\n".join(name + "=" + toml_value(value) for name, value in existing.items()) + "\n")
    oauth_root = (initial.get("integration") or {}).get("oauth_root")
    if oauth_root and Path(oauth_root) != home:
        source = Path(oauth_root) / ".credentials.json"
        if source.is_file() and not source.is_symlink():
            destination = home / ".credentials.json"
            if destination.is_symlink():
                raise RuntimeError("Unsafe programming credentials path")
            descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(source.read_bytes())
    return options


def launch_policy(initial):
    """Only validated runtime options enter the effective config. Connections never come from TOML."""
    provider_id = "hermess_" + initial["connection_id"].replace("-", "")
    home = Path(initial["home"])
    provider = {"name": "Hermess programming", "base_url": initial["base_url"],
                "env_key": "HERMESS_PROGRAMMING_KEY", "wire_api": "responses",
                "requires_openai_auth": False, "supports_websockets": False,
                "request_max_retries": 0, "stream_max_retries": 0}
    tool_env = {key: os.environ[key] for key in
                ("PATH", "SystemRoot", "SystemDrive", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LANG", "LC_ALL")
                if key in os.environ}
    denied = {str(Path(initial["private_root"]) / "vault"): "deny",
              str(Path(initial["private_root"]) / "connection.enc"): "deny",
              str(Path(initial["private_root"]) / "config.toml"): "deny",
              str(Path(initial["private_root"]) / "mcp-auth"): "deny",
              str(home / "config.toml"): "deny", str(home / ".credentials.json"): "deny"}
    user_home = initial.get("host_home") or os.environ.get("USERPROFILE") or os.environ.get("HOME")
    if user_home:
        denied[str(Path(user_home) / ".codex")] = "deny"
        denied[str(Path(user_home) / ".hermes")] = "deny"
        denied[str(Path(user_home) / ".agents")] = "deny"
    tool_env["HOME"] = str(home / "user-home")
    if os.name == "nt":
        tool_env["USERPROFILE"] = str(home / "user-home")
    policy = {
        "model_provider": provider_id, "model_providers": {provider_id: provider},
        "model": initial["model"], "review_model": initial["model"],
        "model_reasoning_effort": initial["effort"],
        "approval_policy": "on-request", "approvals_reviewer": "user",
        "default_permissions": "hermess", "permissions": {
            "hermess": {"description": "Project read and write", "extends": ":workspace", "filesystem": denied, "network": {"enabled": False}},
            "hermess-readonly": {"description": "Read only", "extends": ":read-only", "filesystem": denied, "network": {"enabled": False}}},
        "cli_auth_credentials_store": "ephemeral", "mcp_oauth_credentials_store": "file",
        "sqlite_home": str(home), "log_dir": str(home / "logs"),
        "allow_symlinked_codex_home": False, "allow_login_shell": False,
        "shell_environment_policy": {"inherit": "none", "set": tool_env,
            "exclude": ["*KEY*", "*TOKEN*", "*SECRET*", "CODEX_*", "HERMESS_*", "HERMES_*", "BASH_ENV", "ENV", "ZDOTDIR"],
            "ignore_default_excludes": False, "experimental_use_profile": False},
        "web_search": "disabled", "agents": {"enabled": False},
        "features": {name: False for name in ("shell_snapshot", "multi_agent", "multi_agent_v2", "hooks", "codex_hooks",
                     "plugin_hooks", "apps", "connectors", "browser_use", "computer_use", "memories", "memory_tool",
                     "plugins", "daemon_auto_start", "network_proxy", "code_mode", "code_mode_host")},
    }
    if os.name == "nt":
        policy["windows"] = {"sandbox": "mxc", "allow_mxc": True}
    policy.update(integration_options(initial))
    selected = permission_mode(initial)
    if "permissions" in selected:
        merged = dict(policy["permissions"])
        for name, custom in selected["permissions"].items():
            base = merged.get(name, {})
            merged[name] = {**base, **custom}
            if "filesystem" in base:
                merged[name]["filesystem"] = {**custom.get("filesystem", {}), **base["filesystem"]}
        selected["permissions"] = merged
    policy.update(selected)
    if initial.get("action") == "permissions":
        # Discover user-defined names as well as the product and built-in profiles.
        try:
            policy["permissions"] = {**custom_permissions(initial).get("permissions", {}), **policy["permissions"]}
        except (OSError, ValueError):
            pass
    policy["features"]["goals"] = True
    return provider_id, provider, policy


def without_nulls(value):
    if isinstance(value, dict):
        return {key: without_nulls(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [without_nulls(item) for item in value]
    return value


def verify_effective_config(config, provider_id, provider, policy):
    if config.get("model") != policy["model"] or config.get("model_provider") != provider_id:
        raise RuntimeError("Programming model control could not be enforced")
    actual = (config.get("model_providers") or {}).get(provider_id) or {}
    defaults = {name: None for name in ("auth", "aws", "capabilities", "credential_file", "env_http_headers",
        "env_key_instructions", "experimental_bearer_token", "gateway_oauth", "http_headers", "location",
        "model_catalog_url", "project_id", "query_params", "stream_idle_timeout_ms", "websocket_connect_timeout_ms")}
    defaults["supports_standalone_web_search"] = False
    if actual != {**defaults, **provider}:
        raise RuntimeError("Programming provider control could not be enforced")
    if config.get("notify"):
        raise RuntimeError("Unvalidated external process configuration")
    actual_mcp, expected_mcp = config.get("mcp_servers") or {}, policy.get("mcp_servers") or {}
    if set(actual_mcp) != set(expected_mcp):
        raise RuntimeError("Programming MCP configuration mismatch")
    for server, expected in expected_mcp.items():
        for key, value in expected.items():
            if actual_mcp[server].get(key) != value:
                raise RuntimeError("Programming MCP configuration mismatch")
    for name in ("developer_instructions", "project_doc_max_bytes", "project_doc_fallback_filenames", "model_context_window",
                 "model_auto_compact_token_limit", "tool_output_token_limit", "model_post_turn_compact_threshold_percent", "compact_prompt"):
        if name in policy and config.get(name) != policy[name]:
            raise RuntimeError("Programming integration configuration mismatch")
    shell = config.get("shell_environment_policy") or {}
    for name, expected in policy["shell_environment_policy"].items():
        if shell.get(name) != expected:
            raise RuntimeError("Tool credential isolation could not be enforced")
    for name in ("allow_login_shell", "cli_auth_credentials_store", "default_permissions", "sqlite_home", "log_dir",
                 "approval_policy", "approvals_reviewer", "review_model"):
        if config.get(name) != policy[name]:
            raise RuntimeError("Programming runtime isolation could not be enforced")
    actual_permissions = config.get("permissions")
    if without_nulls(actual_permissions) != policy["permissions"]:
        raise RuntimeError("Programming filesystem isolation could not be enforced")
    if "windows" in policy and without_nulls(config.get("windows")) != policy["windows"]:
        raise RuntimeError("Programming Windows sandbox isolation could not be enforced")
    for name, value in policy["features"].items():
        if (config.get("features") or {}).get(name) != value:
            raise RuntimeError("Unvalidated runtime feature")


def failure_reason(error):
    message = str(error).lower()
    if "question timed out" in message:
        return "question_timeout"
    if "goal state unconfirmed" in message:
        return "goal_state_unconfirmed"
    if "sandbox" in message or "mxc" in message:
        return "sandbox_unavailable"
    if "401" in message or "authentication" in message or "unauthorized" in message:
        return "authentication_failed"
    if "404" in message:
        return "responses_unavailable"
    if "resume" in message:
        return "resume_failed"
    if "isolation" in message or "control" in message or "configuration" in message:
        return "configuration_rejected"
    return "request_failed"


def plain_display_path(path):
    if os.name != "nt":
        return path
    return "\\\\" + path[8:] if path.startswith("\\\\?\\UNC\\") else path.removeprefix("\\\\?\\")


def skill_catalog(client, cwd):
    result = client.request("skills/list", {"cwds": [cwd], "forceReload": True})
    skills, errors = [], []
    for entry in result["data"]:
        skills.extend({key: row[key] for key in ("name", "description", "path", "enabled")} for row in entry["skills"])
        errors.extend(entry.get("errors") or [])
    for row in skills + errors:
        row["path"] = plain_display_path(row.get("path", ""))
    return {"skills": skills, "errors": errors}


def skill_inputs(text, catalog):
    names = set(re.findall(r"(?<![\w$])\$([\w-]+)(?![\w-])", text))
    rows = []
    for name in sorted(names):
        matches = [row for row in catalog["skills"] if row["name"] == name and row["enabled"]]
        if len(matches) > 1:
            raise ValueError("Ambiguous skill name")
        if matches:
            rows.append({"type": "skill", "name": name, "path": matches[0]["path"]})
    return rows


def approval_options(params, file_change=False):
    """Keep the exact decisions offered by the locked server, including rule amendments."""
    decisions = params.get("availableDecisions")
    if decisions is None:
        if file_change:
            decisions = ["accept", "acceptForSession", "decline", "cancel"]
        elif params.get("networkApprovalContext"):
            decisions = ["accept", "acceptForSession"]
            amendment = next((item for item in params.get("proposedNetworkPolicyAmendments") or []
                              if item.get("action") == "allow"), None)
            if amendment:
                decisions.append({"applyNetworkPolicyAmendment": {"network_policy_amendment": amendment}})
            decisions.append("cancel")
        else:
            decisions = ["accept"]
            prefix = params.get("proposedExecpolicyAmendment")
            if prefix and not params.get("additionalPermissions") and params.get("kind") != "humanCommand":
                decisions.append({"acceptWithExecpolicyAmendment": {"execpolicy_amendment": prefix}})
            decisions.append("cancel")
    options = []
    names = {"accept": "once", "acceptForSession": "session", "decline": "deny", "cancel": "cancel"}
    for index, decision in enumerate(decisions):
        detail = ""
        if isinstance(decision, str):
            kind = names.get(decision)
            if params.get("kind") == "humanCommand" and decision == "acceptForSession":
                continue
        elif isinstance(decision, dict) and params.get("kind") != "humanCommand":
            if "acceptWithExecpolicyAmendment" in decision:
                kind = "command_rule"
                detail = json.dumps(decision["acceptWithExecpolicyAmendment"]["execpolicy_amendment"], ensure_ascii=False)
            elif "applyNetworkPolicyAmendment" in decision:
                kind = "network_rule"
                detail = json.dumps(decision["applyNetworkPolicyAmendment"]["network_policy_amendment"], ensure_ascii=False)
            else:
                continue
        else:
            continue
        if kind:
            options.append({"id": f"option-{index}", "kind": kind, "detail": detail, "decision": decision})
    return options


def request_approval(params, emit, answers, cwd, file_change=False, change_summary="", timeout=120, source="codex"):
    request_id = str(uuid.uuid4())
    options = approval_options(params, file_change)
    emit({"kind": "approval", "id": request_id, "source": source,
          "command": change_summary if file_change else params.get("command") or "",
          "description": params.get("reason") or "", "cwd": params.get("cwd") or cwd,
          "options": [{key: value for key, value in option.items() if key != "decision"} for option in options]})
    deadline = time.monotonic() + timeout
    outcome = "timeout"
    try:
        while True:
            try:
                reply = answers.get(timeout=max(0, deadline - time.monotonic()))
            except queue.Empty:
                return {"decision": "decline" if file_change else "cancel"}
            if time.monotonic() >= deadline:
                return {"decision": "decline" if file_change else "cancel"}
            if reply.get("id") == request_id:
                option = next((item for item in options if item["id"] == reply.get("option_id")), None)
                if option:
                    outcome = option["kind"]
                    return {"decision": option["decision"]}
            if reply.get("kind") == "stop":
                outcome = "stopped"
                return {"decision": "cancel"}
    finally:
        emit({"kind": "approval_closed", "id": request_id, "outcome": outcome})


def request_mcp_confirmation(params, emit, answers, timeout=120):
    schema = params.get("requestedSchema") or {}
    if not isinstance(schema, dict) or schema.get("properties") or schema.get("required"):
        emit({"kind": "activity", "text": "此 MCP 请求需要额外表单数据，请在外部完成配置后重试 / This MCP request requires additional form data; configure it externally and retry"})
        return {"action": "decline", "content": None, "_meta": None}
    decision = request_approval({"command": "MCP: " + params["serverName"],
        "reason": params.get("message", "") + ("\n" + params["url"] if params.get("mode") == "url" else ""),
        "availableDecisions": ["accept", "decline", "cancel"]}, emit, answers, "", timeout=timeout, source="mcp")
    action = {"accept": "accept", "decline": "decline", "cancel": "cancel"}[decision["decision"]]
    return {"action": action, "content": {} if action == "accept" and params.get("mode") != "url" else None, "_meta": None}


def tool_event(note):
    method, params = note.get("method"), note.get("params") or {}
    if method not in ("item/started", "item/completed"):
        return None
    item = params.get("item") or {}
    if item.get("type") in ("commandExecution", "fileChange", "mcpToolCall", "webSearch", "dynamicToolCall", "imageGeneration", "imageView", "collabAgentToolCall"):
        kind = item["type"]
        detail = ""
        changes = []
        if kind == "fileChange":
            detail = "\n\n".join(str(change.get("path", "")) + "\n" + str(change.get("diff", ""))
                                   for change in item.get("changes", []) if isinstance(change, dict))
            for change in item.get("changes", []):
                if not isinstance(change, dict):
                    continue
                lines = str(change.get("diff", "")).splitlines()
                change_kind = (change.get("kind") or {}).get("type", "update")
                # Add/delete carry raw file contents; update carries a unified diff.
                added = len(lines) if change_kind == "add" else 0 if change_kind == "delete" else sum(line.startswith("+") and not line.startswith("+++") for line in lines)
                removed = len(lines) if change_kind == "delete" else 0 if change_kind == "add" else sum(line.startswith("-") and not line.startswith("---") for line in lines)
                changes.append({"path": str(change.get("path", "")), "kind": change_kind,
                                "added": added, "removed": removed})
        elif kind in ("mcpToolCall", "dynamicToolCall"):
            detail = json.dumps(item.get("arguments"), ensure_ascii=False)
        elif kind == "imageGeneration":
            detail = str(item.get("revisedPrompt") or "")
        elif kind == "imageView":
            detail = str(item.get("path") or "")
        elif kind == "collabAgentToolCall":
            detail = str(item.get("prompt") or "")
        output = item.get("aggregatedOutput") or ""
        if kind == "mcpToolCall":
            output = json.dumps(item.get("error") or item.get("result"), ensure_ascii=False)
        if kind == "dynamicToolCall":
            output = "\n".join(part.get("text", "") for part in item.get("contentItems") or [] if part.get("type") == "inputText")
        if kind == "imageGeneration":
            output = str(item.get("failure") or item.get("savedPath") or "")
        return {"kind": "tool", "tool": {
            "id": item.get("id", ""), "type": kind,
            "status": "failed" if item.get("success") is False else item.get("status") or ("completed" if method.endswith("completed") else "inProgress"),
            "summary": "电脑操作" if item.get("tool") == "hermess_computer_use" else str(item.get("command") or ((str(item.get("server")) + "/") if item.get("server") else "") + str(item.get("tool") or item.get("query") or ""))[:4096],
            "detail": detail[:65536], "output": str(output)[:65536],
            "cwd": item.get("cwd"), "exit_code": item.get("exitCode"),
            "skill_paths": [plain_display_path(action["path"]) for action in item.get("commandActions", [])
                            if action.get("type") == "read" and str(action.get("path", "")).replace("\\", "/").endswith("/SKILL.md")],
            "changes": changes,
        }}


def main():
    initial = json.loads(sys.stdin.readline())
    initial["host_home"] = os.environ.get("USERPROFILE") or os.environ.get("HOME")
    # Set before importing Hermes: never load the user's Hermes or Codex homes.
    os.environ["CODEX_HOME"] = initial["home"]
    os.environ["HERMES_HOME"] = initial["home"]
    os.environ["CODEX_SQLITE_HOME"] = initial["home"]
    isolated_home = Path(initial["home"]) / "user-home"
    isolated_home.mkdir(exist_ok=True)
    os.environ["HOME"] = str(isolated_home)
    if os.name == "nt":
        os.environ["USERPROFILE"] = str(isolated_home)
    if os.name == "nt":
        appdata = Path(initial["home"]) / "local-appdata"
        appdata.mkdir(exist_ok=True)
        os.environ["LOCALAPPDATA"] = str(appdata)
    os.environ["HERMESS_PROGRAMMING_KEY"] = initial.pop("api_key")
    from agent.transports.codex_app_server import CodexAppServerClient
    from agent.transports.codex_app_server_session import CodexAppServerSession

    lock = threading.Lock()
    answers = queue.Queue()
    controls = queue.Queue()

    def sanitize(value, field=""):
        # Keep protocol identities intact; redact nested tool content as well.
        if isinstance(value, dict):
            return {key: sanitize(item, key) for key, item in value.items()}
        if isinstance(value, list):
            return [sanitize(item, field) for item in value]
        if isinstance(value, str) and field in ("text", "command", "description", "summary", "detail", "output", "cwd", "path", "objective", "question", "header", "label"):
            return value.replace(os.environ["HERMESS_PROGRAMMING_KEY"], "[密钥已隐藏]")
        return value

    def emit(value):
        with lock:
            print(json.dumps(sanitize(value), ensure_ascii=False), flush=True)

    def event(note):
        method, params = note.get("method"), note.get("params") or {}
        if method == "thread/goal/updated":
            emit({"kind": "goal", "goal": params["goal"]})
        elif method == "thread/goal/cleared":
            emit({"kind": "goal", "goal": None})
        activity = computer_activity_event(note)
        if activity is not None and not activity["started"]:
            emit(activity)
        method, params = note.get("method"), note.get("params") or {}
        if method == "thread/tokenUsage/updated":
            usage = params.get("tokenUsage") or {}
            last = usage.get("last") or {}
            used, window = last.get("totalTokens"), usage.get("modelContextWindow")
            value = {"kind": "context"}
            if isinstance(used, int) and not isinstance(used, bool) and used >= 0:
                value["used_tokens"] = used
            if isinstance(window, int) and not isinstance(window, bool) and window > 0:
                value["context_window"] = window
            emit(value)
        elif method == "item/agentMessage/delta":
            emit({"kind": "delta", "text": params.get("delta", "")})
        elif method == "item/commandExecution/outputDelta":
            emit({"kind": "tool_delta", "id": params.get("itemId"), "text": params.get("delta", "")[:65536]})
        elif method in ("item/started", "item/completed"):
            item = params.get("item") or {}
            if item.get("type") == "agentMessage" and method == "item/completed":
                emit({"kind": "message", "text": item.get("text", "")})
            elif item.get("type") == "exitedReviewMode" and method == "item/completed":
                emit({"kind": "message", "text": item.get("review", "")})
            tool = tool_event(note)
            if tool is not None:
                emit(tool)

    try:
        provider_id, provider, overrides = launch_policy(initial)
    except (OSError, ValueError, TypeError, RuntimeError):
        emit({"kind": "result", "text": "", "interrupted": False, "failed": True, "reason": "configuration_rejected"})
        return
    args = []
    file_options = prepare_integration_config(initial)
    for name, value in overrides.items():
        if name in file_options:
            continue
        args.extend(["-c", name + "=" + toml_value(value)])

    class ControlledClient(CodexAppServerClient):
        def sync_global_instructions(self, thread_id):
            text = overrides.get("developer_instructions", "")
            digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
            marker = Path(initial["home"]) / ".hermess-instructions.sha256"
            if marker.is_symlink():
                raise RuntimeError("Unsafe instruction revision path")
            previous = marker.read_text(encoding="utf-8") if marker.exists() else None
            if initial.get("thread_id") and previous != digest:
                # In the locked version resume does not rewrite an existing thread's developer instructions.
                super().request("thread/inject_items", {"threadId": thread_id, "items": [{"type": "message", "role": "developer",
                    "content": [{"type": "input_text", "text": "Current Hermess global programming instructions. This snapshot replaces previous global programming instructions; project instructions still apply.\n" + (text or "No additional global programming instructions.") }]}]})
                emit({"kind": "activity", "text": "已同步本轮全局编程指令 / Global instructions updated"})
            marker.write_text(digest, encoding="utf-8")

        def initialize(self, **kwargs):
            kwargs["capabilities"] = {**kwargs.get("capabilities", {}), "experimentalApi": True}
            result = super().initialize(**kwargs)
            effective = self.request("config/read", {"cwd": initial["cwd"], "includeLayers": False})
            verify_effective_config(effective["config"], provider_id, provider, overrides)
            skill_root = (initial.get("integration") or {}).get("skill_root")
            if skill_root:
                Path(skill_root).mkdir(parents=True, exist_ok=True)
                self.request("skills/extraRoots/set", {"extraRoots": [skill_root]})
            emit({"kind": "context", "effort": initial["effort"],
                  "approval_policy": overrides["approval_policy"], "approvals_reviewer": overrides["approvals_reviewer"],
                  "permissions": initial.get("permissions", "request")})
            return result

        def request(self, method, params=None, **kwargs):
            selected_skills = []
            if method == "turn/start":
                params = {**params, "collaborationMode": {"mode": initial.get("mode", "default"),
                    "settings": {"model": initial["model"], "reasoning_effort": initial["effort"], "developer_instructions": None}}}
                if "developer_instructions" in overrides:
                    self.sync_global_instructions(params["threadId"])
                selected_skills = skill_inputs(initial["text"], skill_catalog(self, initial["cwd"])) if "$" in initial["text"] else []
                params = {**params, "input": [*params["input"], *selected_skills]}
            if method in ("thread/start", "thread/resume"):
                params = {**(params or {}), "permissions": overrides["default_permissions"],
                          "approvalPolicy": overrides["approval_policy"], "approvalsReviewer": overrides["approvals_reviewer"]}
                params["dynamicTools"] = [computer_tool_spec()]
                if "developer_instructions" in overrides:
                    params["developerInstructions"] = "\n\n".join(part for part in (params.get("developerInstructions", ""), overrides["developer_instructions"]) if part)
            result = super().request(method, params, **kwargs)
            for skill in selected_skills:
                emit({"kind": "tool", "tool": {"id": "skill-" + str(uuid.uuid4()), "type": "skill",
                      "status": "completed", "summary": skill["name"], "detail": skill["path"],
                      "output": "已提交到本轮上下文 / Submitted to this turn's context"}})
            if method in ("thread/start", "thread/resume"):
                if result.get("approvalPolicy") != overrides["approval_policy"] or result.get("approvalsReviewer") != overrides["approvals_reviewer"]:
                    raise RuntimeError("Programming approval mode could not be enforced")
            return result

    def client_factory(**kwargs):
        return ControlledClient(**kwargs, env=(initial.get("integration") or {}).get("mcp_environment") or {}, extra_args=["--strict-config", *args])

    if overrides["default_permissions"] not in overrides["permissions"] and overrides["default_permissions"] not in (":workspace", ":read-only", ":danger-full-access"):
        raise RuntimeError("Unknown programming permission profile")
    if initial.get("action") in ("permissions", "skills", "settings_probe"):
        client = client_factory(codex_bin=initial["executable"], codex_home=initial["home"])
        try:
            client.initialize()
            if initial["action"] == "settings_probe":
                if initial.get("mcp_login"):
                    login = client.request("mcpServer/oauth/login", {"name": initial["mcp_server"], "timeoutSecs": 180})
                    emit({"kind": "authorization_url", "url": login["authorizationUrl"]})
                    deadline = time.monotonic() + 180
                    while time.monotonic() < deadline:
                        note = client.take_notification(timeout=1)
                        if note and note.get("method") == "mcpServer/oauthLogin/completed":
                            status = note.get("params") or {}
                            if status.get("name") == initial["mcp_server"] and status.get("loginId") == login.get("loginId"):
                                if not status.get("success"):
                                    raise RuntimeError("MCP authorization failed")
                                break
                    else:
                        raise RuntimeError("MCP authorization timed out")
                    client.request("config/mcpServer/reload", {})
                rows, cursor = [], None
                while True:
                    result = client.request("mcpServerStatus/list", {"cursor": cursor, "limit": 100, "serverName": initial.get("mcp_server")}, timeout=130)
                    rows.extend(result["data"])
                    cursor = result.get("nextCursor")
                    if not cursor:
                        break
                enabled = {server["id"] for server in ((initial.get("integration") or {}).get("settings") or {}).get("mcp_servers", []) if server["enabled"] and (not initial.get("mcp_server") or server["id"] == initial["mcp_server"])}
                success = enabled.issubset({row["name"] for row in rows}) and all(not row.get("toolsError") and row.get("authStatus") != "notLoggedIn" for row in rows if row["name"] in enabled)
                emit({"kind": "settings_probe", "result": {"servers": rows, "success": success}})
                return
            if initial["action"] == "skills":
                emit({"kind": "skills", "catalog": skill_catalog(client, initial["cwd"])})
                return
            profiles, cursor = [], None
            while True:
                result = client.request("permissionProfile/list", {"cwd": initial["cwd"], "cursor": cursor})
                profiles.extend(result["data"])
                cursor = result.get("nextCursor")
                if not cursor:
                    break
            requirements = client.request("configRequirements/read", {}).get("requirements") or {}
            allowed_policies = requirements.get("allowedApprovalPolicies")
            rows = []
            for mode in ("request", "auto", "full", "custom"):
                try:
                    settings = permission_mode({**initial, "permissions": mode})
                    profile = next((row for row in profiles if row["id"] == settings["default_permissions"]), None)
                    allowed = bool(profile and profile["allowed"] and (allowed_policies is None or settings["approval_policy"] in allowed_policies))
                except (OSError, ValueError, TypeError):
                    allowed = False
                rows.append({"id": mode, "allowed": allowed})
            emit({"kind": "permissions", "profiles": rows})
        finally:
            client.close()
        return

    class ControlledSession(CodexAppServerSession):
        def _handle_server_request(self, req):
            if req.get("method") == "item/tool/requestUserInput":
                params = req.get("params") or {}
                if params.get("threadId") != self._thread_id or params.get("turnId") != self._active_turn_id:
                    self._client.respond_error(req["id"], code=-32602, message="Stale question")
                else:
                    response = answer_questions(req, emit, answers, self._interrupt_event)
                    if not response["answers"]:
                        self.request_interrupt()
                    self._client.respond(req["id"], response)
                return
            if req.get("method") == "mcpServer/elicitation/request":
                params = req.get("params") or {}
                configured = {row["id"] for row in ((initial.get("integration") or {}).get("settings") or {}).get("mcp_servers", []) if row["enabled"]}
                if params.get("serverName") not in configured or params.get("threadId") != self._thread_id:
                    self._client.respond(req.get("id"), {"action": "decline", "content": None, "_meta": None}); return
                response = request_mcp_confirmation(params, emit, answers)
                if response["action"] == "cancel": self.request_interrupt()
                self._client.respond(req.get("id"), response)
                return
            if req.get("method") == "item/tool/call":
                params = req.get("params") or {}
                if (params.get("tool") != "hermess_computer_use" or params.get("namespace") is not None
                        or params.get("threadId") != self._thread_id or params.get("turnId") != self._active_turn_id
                        or not isinstance(params.get("callId"), str) or not params["callId"]):
                    self._client.respond_error(req.get("id"), code=-32602, message="Unsupported or stale computer tool call")
                    return
                response = run_computer_tool(params, initial, emit, answers, self.request_interrupt)
                self._client.respond(req.get("id"), response)
                return
            # Preserve old restricted sessions; the four new modes use Codex's real approval routing.
            if initial.get("permissions") in ("hermess", "hermess-readonly") and req.get("method") in ("item/commandExecution/requestApproval", "item/fileChange/requestApproval",
                                      "item/permissions/requestApproval"):
                self._client.respond(req.get("id"), {"decision": "decline"})
                emit({"kind": "activity", "text": "操作超出编程沙箱范围，已拒绝"})
                return
            if req.get("method") in ("item/commandExecution/requestApproval", "item/fileChange/requestApproval"):
                file_change = req["method"] == "item/fileChange/requestApproval"
                params = req.get("params") or {}
                summary = self._pending_file_changes.get(params.get("itemId"), "修改文件") if file_change else ""
                response = request_approval(params, emit, answers, initial["cwd"], file_change, summary)
                if response["decision"] == "cancel":
                    self.request_interrupt()
                self._client.respond(req.get("id"), response)
                return
            super()._handle_server_request(req)

    session = ControlledSession(
        cwd=initial["cwd"], codex_bin=initial["executable"], codex_home=initial["home"],
        model=initial["model"], model_provider=provider_id,
        resume_thread_id=initial.get("thread_id"), on_event=event,
        client_factory=client_factory,
        developer_instructions="你是 Hermess 的编程助手。使用中文回答，在指定项目目录内完成用户任务并验证结果。",
    )

    def read_control():
        for line in sys.stdin:
            try:
                reply = json.loads(line)
            except ValueError:
                continue
            if reply.get("kind") == "stop":
                session.request_interrupt()
            if reply.get("kind") == "command":
                controls.put(reply["command"])
                if reply["command"].get("action") in ("pause", "clear"):
                    session.request_interrupt()
                    answers.put({"kind": "stop"})
                continue
            if reply.get("kind") == "approval" and "content" in reply:
                emit({"kind": "activity", "text": "已接收 MCP 确认响应 / MCP confirmation response received"})
            answers.put(reply)
        session.request_interrupt()
        answers.put({"kind": "stop"})

    threading.Thread(target=read_control, daemon=True).start()
    try:
        native_command = initial.get("command") or {}
        if (native_command.get("type") == "goal" and native_command.get("action") in ("get", "pause", "clear", "update")
                and initial.get("thread_id")):
            # Metadata operations can address an unloaded thread; do not resume an active goal merely to inspect it.
            session._client = client_factory(codex_bin=initial["executable"], codex_home=initial["home"])
            session._client.initialize()
            session._thread_id = initial["thread_id"]
            goal = goal_request(session, native_command, emit)
            if native_command["action"] == "get" and goal is None:
                emit({"kind": "message", "text": "当前会话未设置目标。"})
            emit({"kind": "result", "text": "", "interrupted": False, "failed": False})
            return
        thread_id = session.ensure_started()
        emit({"kind": "thread", "id": thread_id})
        if initial.get("command"):
            run_session_command(session, initial["command"], emit, event, controls,
                                mode=initial.get("mode", "default"), model=initial["model"], effort=initial["effort"])
            return
        turn_input = [{"type": "text", "text": initial["text"]}]
        turn_input.extend({"type": "image_url", "image_url": {"url": url}} for url in initial.get("images", []))
        result = session.run_turn(turn_input, model=initial["model"], reasoning_effort=initial["effort"], turn_timeout=1800)
        # Error details from a remote gateway may echo credentials. Keep them off the UI and logs.
        emit({"kind": "result", "text": result.final_text, "interrupted": result.interrupted,
              "failed": bool(result.error), "reason": failure_reason(result.error) if result.error else None})
    except Exception as error:
        if (initial.get("command") or {}).get("type") == "goal" and session._client is not None and session._thread_id:
            try:
                goal = goal_request(session, {"action": "get"}, emit)
                if goal and goal["status"] == "active":
                    goal_request(session, {"action": "pause", "origin": "automatic"}, emit)
            except Exception:
                error = RuntimeError("goal state unconfirmed")
        emit({"kind": "result", "text": "", "interrupted": False, "failed": True, "reason": failure_reason(error)})
    finally:
        thread_id = session._thread_id
        try:
            if thread_id:
                from tools.computer_use.tool import release_computer_use_session
                release_computer_use_session(thread_id)
        finally:
            session.close()


if __name__ == "__main__":
    main()
