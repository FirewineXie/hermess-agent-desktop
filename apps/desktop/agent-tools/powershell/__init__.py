"""Register the Hermess Windows PowerShell tool with Hermes."""

from .tool import execute, available


SCHEMA = {
    "name": "powershell_execute",
    "description": (
        "On Windows, use this instead of `terminal` for local commands; `terminal` "
        "requires bash. Run PowerShell source directly without wrapping it in "
        "powershell.exe, pwsh.exe, cmd.exe, or a bash command. Each call starts a fresh "
        "process, so variables and location do not persist. The result identifies the "
        "executable and version used."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "PowerShell source to execute"},
            "workdir": {"type": "string", "description": "Absolute Windows working directory"},
            "timeout": {"type": "integer", "minimum": 1, "maximum": 300},
            "engine": {"type": "string", "enum": ["auto", "ps7", "winps51"]},
        },
        "required": ["command"],
    },
}


def register(ctx):
    ctx.register_tool(
        name="powershell_execute",
        toolset="desktop_ui",
        schema=SCHEMA,
        handler=lambda args, **kwargs: execute(args, task_id=kwargs.get("task_id")),
        check_fn=available,
        description=SCHEMA["description"],
    )
