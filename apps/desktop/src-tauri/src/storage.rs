use crate::paths::CanonicalizePlain;
use std::path::{Path, PathBuf};

pub(crate) fn product_storage(selected: &Path) -> Result<PathBuf, String> {
    if !selected.is_absolute() {
        return Err("存储位置必须是绝对路径".into());
    }
    let selected = selected
        .canonicalize_plain()
        .map_err(|_| "无法解析存储位置".to_string())?;
    let storage = selected.join("HermessAgentDesktop");
    storage
        .canonicalize_plain()
        .map_err(|_| "产品存储目录尚未创建".to_string())
}
