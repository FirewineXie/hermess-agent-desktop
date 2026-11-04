use super::{helper_python, hermes_process_path, profile_scope::ResolvedProfileScope};
use crate::errors::DesktopFailure;
use std::process::Stdio;
use tokio::process::Command;

#[cfg(test)]
const RESULT_PREFIX: &str = "MEMORY_PROVIDER_SETUP_RESULT=";

// The locked Dashboard setup helper contains the authoritative provider-manifest and
// dependency semantics. Keep its potentially sensitive command/stdout/stderr fields inside
// the helper process and project only bounded status metadata into the product action log.
const SCRIPT: &str = r#"import contextlib,json,os,sys

provider=sys.argv[1]
rows=[]
ok=False
try:
    with open(os.devnull,"w",encoding="utf-8") as sink:
        with contextlib.redirect_stdout(sink),contextlib.redirect_stderr(sink):
            from hermes_cli.web_routers.memory_providers import _install_memory_provider_setup
            raw=_install_memory_provider_setup(provider)
    ok=bool(raw.get("ok"))
    source=raw.get("results") if isinstance(raw.get("results"),list) else []
    for item in source[:64]:
        if not isinstance(item,dict):
            continue
        row={}
        for key in ("kind","status"):
            value=item.get(key)
            if isinstance(value,str):
                row[key]=value[:128]
        value=item.get("returncode")
        row["returncode"]=value if isinstance(value,int) else None
        rows.append(row)
except Exception:
    rows=[{"kind":"setup","status":"failed","returncode":None}]

result={"ok":ok,"provider":provider[:128],"results":rows}
print("MEMORY_PROVIDER_SETUP_RESULT="+json.dumps(result,separators=(",",":"),ensure_ascii=True))
raise SystemExit(0 if ok else 1)
"#;

pub(super) fn valid_provider_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

pub(super) fn command(
    scope: &ResolvedProfileScope,
    provider: &str,
) -> Result<Command, DesktopFailure> {
    if !valid_provider_name(provider) {
        return Err(DesktopFailure::invalid_input());
    }
    let mut command = helper_python::command(&scope.hermes, SCRIPT)
        .map_err(|_| DesktopFailure::operation_failed())?;
    command
        .arg(provider)
        .env("HERMES_HOME", hermes_process_path(&scope.home))
        .env(
            "HERMES_GATEWAY_LOCK_DIR",
            hermes_process_path(&scope.storage.join("control").join("gateway-locks")),
        )
        .env("HERMES_DESKTOP", "1")
        .env("HERMES_VERBOSE", "0")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    Ok(command)
}

#[cfg(test)]
#[path = "tests/memory_provider_setup.rs"]
mod tests;
