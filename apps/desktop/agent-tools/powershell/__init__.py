"""Register the Hermess Windows PowerShell tool with Hermes."""

from .tool import execute, available


SCHEMA = {
    "name": "powershell_execute",
    "description": (
        "Run a PowerShell command on this Windows host using the user's installed "
        "PowerShell. Each call starts a fresh process; variables and location do not "
        "persist. The result identifies the executable and version used."
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
        toolset="terminal",
        schema=SCHEMA,
        handler=lambda args, **kwargs: execute(args, task_id=kwargs.get("task_id")),
        check_fn=available,
        description=SCHEMA["description"],
    )
