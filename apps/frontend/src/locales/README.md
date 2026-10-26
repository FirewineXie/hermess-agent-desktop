# 桌面端语言文件

- `app/`：桌面主界面的中英文文案，以及斜杠命令的中文说明。
- `hermes-agent/ui.*.json`：Hermes Agent 配置页的固定界面文案。
- `hermes-agent/categories.*.json`：运行时配置分类名称。
- `hermes-agent/fields.*.json`：运行时配置字段的标题和说明，以真实配置键为索引。
- `hermes-agent/options.*.json`：常用枚举选项的显示名称。保存时始终使用上游原值。

`fields.*.json` 对应 `runtime/upstream.lock.json` 锁定的 Hermes Agent v0.22.5（`bf0203a794a07aac3ff764972ab9087baa4e4f4e`）。升级上游时应重新核对字段键、分类与选项；新增字段未收录前，界面会保留上游键名和说明，避免把猜测的译文当成配置含义。

配置键、模型标识、路径、时区和用户输入是数据，不参与翻译。界面显示译文时仍展示原始配置键，方便与 `config.yaml` 对照。
