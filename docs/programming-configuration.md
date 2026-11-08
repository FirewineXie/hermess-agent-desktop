# 编程配置

编程功能使用 Hermess 自己的 Codex 数据目录，与个人 Codex 配置隔离。所有 Hermess Profile 共用编程配置。

## 设置入口

“设置 → 编程”包含 MCP Servers、Skills、自定义权限、指令与项目、上下文及 `config.toml` 等子页。

- MCP Servers 只展示配置中的服务器、启用状态及手动检查得到的认证状态和工具列表。新增、删除、启停与参数修改在独立 `config.toml` 中完成；需要 OAuth 的服务可在检查后发起浏览器授权。
- Skills 只展示运行时实际发现的技能、启用状态、说明、文件位置及加载错误，可按已登记项目筛选和重新扫描。技能内容在技能目录配置，启停规则在 `config.toml` 配置。
- 自定义权限、指令与上下文保留常用表单；表单与文件编辑使用同一个 `config.toml`。项目 `AGENTS.md` 单独读写所选项目根目录中的文件，不写入全局配置。

MCP 和 Skills 页不提供配置增删、启停开关或保存表单。页面提供“编辑 config.toml”。编程设置中的这个按钮统一跳转到 `config.toml` 子页，在应用内查看和编辑原文件；Skills 页的“打开独立技能目录”仍打开系统文件管理器。

`config.toml` 子页提供全文编辑、保存和重新读取，不展示本机完整配置路径。保存保留原文及注释，检查 TOML 语法、1 MiB 大小上限和文件版本；文件被其他页面或外部编辑器修改时拒绝覆盖并保留当前输入。重新读取或离开页面时，未保存修改需要确认丢弃。语法通过不代表每个字段都会生效，实际支持范围见下文；读取不要求 TOML 有效，因此可以在此修复外部写入的语法错误。

## 配置示例

以下为配置结构示例，服务地址和技能名称需要替换为实际值。

```toml
developer_instructions = "修改后验证结果，并说明未验证的范围。"
project_doc_max_bytes = 32768
project_doc_fallback_filenames = ["PROJECT_RULES.md"]

# 可选：根据所用模型设置；省略时采用运行时默认值。
tool_output_token_limit = 2048

[mcp_servers.docs]
url = "https://example.com/mcp"
enabled = true
startup_timeout_sec = 10
tool_timeout_sec = 60

# 如服务需要令牌，可引用明确配置的本机环境变量。
bearer_token_env_var = "MY_MCP_TOKEN"

[skills]
config = [{ path = "/absolute/path/my-skill/SKILL.md", enabled = false }]
```

STDIO 服务按 Codex 标准使用 `command`、`args`、`cwd` 和 `env` 等字段。客户端仅向 Codex 补入 MCP 配置明确引用的本机环境变量，不继承全部宿主环境；产品隔离目录和解释器启动相关变量不开放覆盖。MCP 服务认证信息不写入日志或启动命令行。

独立技能目录的结构为 `<技能目录>/<技能名>/SKILL.md`，可包含技能自身的脚本和参考资料。禁用规则的 `path` 指向技能的 `SKILL.md` 绝对路径；Windows 可使用 TOML 单引号字符串保存普通 Win32 路径。项目中的 `.agents/skills` 仍由锁定 Codex 按项目范围发现。复杂规则由用户或 AI 直接编辑文件，不在界面复制一套配置管理流程。

当前适配层读取五块约定范围内的配置：`mcp_servers`、`skills`、全局及项目指令、上下文参数，以及已有自定义权限字段。其他 Codex 配置项不会因写入该文件而自动开放；模型连接仍由现有提供商配置管理。

## 生效与验证边界

配置文件在每轮任务启动前读取。文件修改、表单保存、技能内容和启停规则的变动从下一轮生效，正在运行的任务保持本轮配置。界面的“重新读取”“重新扫描”和“检查连接与工具”分别更新配置摘要、技能目录和 MCP 检查结果，不会自动重新发送聊天消息。

保存表单时校验文件版本；外部文件已变化时拒绝覆盖，提示重新读取。只修改对应配置字段，保留其他字段；MCP 和 Skills 原始配置不由表单改写。

锁定运行时恢复会话时不会自动替换已有的全局开发者指令。客户端在全局指令变化后，通过 App Server 的 `thread/inject_items` 同步最新指令；清空全局指令也生成新的指令快照，历史消息仍保留。项目指令由运行时重新加载。

MCP 工具的简单确认复用“允许一次／拒绝并继续／拒绝并停止”审批及超时处理；需要填写额外动态表单的 MCP elicitation 暂不扩展，明确拒绝并提示外部处理。

Windows 与 macOS 共用配置及界面实现，进程仍纳入现有产品进程树管理。浏览器模拟预览、无窗口原生命令、App Server 协议测试与完整原生窗口验收分别记录，不能互相代替。
