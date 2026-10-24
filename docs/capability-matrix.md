# 固定提交接入能力矩阵

基线：`vendor/hermes-agent` 提交 `5894e750c3dba980d43b25aa29e3958149ba2c61`。下表的“已验收”仅指 2026-10-24 Windows x64 上的脚本级集成测试，不代表桌面 UI 或其他平台已通过。

| 能力 | 固定提交接口 | 当前产品实现 | 验收状态 |
| --- | --- | --- | --- |
| 本地独立启动 | `hermes serve --host 127.0.0.1 --port 0 --isolated`、`HERMES_DESKTOP_READY_FILE` | 开发态 Rust 命令管理一个子进程，私有数据根与锁目录 | Windows 脚本启动与就绪通过；窗口按钮未操作验收 |
| 本地鉴权 | loopback `/api/ws` 使用每次启动的 `HERMES_DASHBOARD_SESSION_TOKEN` | 凭据仅在 Rust 层；前端收不到 token | 正确凭据 ping 成功、错误凭据拒绝；进程身份与共存仍待验收 |
| 网关连通 | `ping` | Rust 持续连接 + RPC 请求匹配；另有独立 ping | 原版后端脚本通过；Rust 长连接未完成窗口验收 |
| 新建会话 | `session.create`，`source: desktop`、`idempotency_key` | Rust RPC 命令 + 开发态 UI | 脚本从真实后端取得会话 ID；UI 未验收 |
| 提交消息 | `prompt.submit` | Rust RPC 命令，无盲目重试 | 脚本取得 admission；UI 未验收 |
| 流式回复 | `message.delta`、`message.complete` | Rust 筛选事件送前端，最简文本视图 | 脚本收到 7 个 delta 与最终内容；UI 未验收 |
| 基础工具 | `tool.start`、`tool.complete` | Rust 转发工具事件，UI 仅显示状态 | 原版 `read_file` 实际执行，收到 1 个完成事件；工具卡片未完成 |
| 审批与澄清 | `gateway.ready` 后发送 `client.capabilities`；处理 `approval`、`clarify`、`request.cancel` | Rust 限额转发服务端请求并校验审批选项；开发态 UI 展示卡片并回传决定 | 脚本级澄清往返通过；危险命令审批拒绝后目标目录保留。UI 未操作验收；其他服务端请求尚未接入 |
| 中断与恢复 | `session.interrupt`、`session.resume`、事件重放 | 尚未实现 | 未验收 |
| 历史 | `session.list` 与存储会话接口 | 尚未实现 | 未验收 |
| 模型配置 | `config.get`、`config.set`、管理接口 | 尚未实现；脚本使用临时假模型配置 | 真实模型未验收 |

专用 `serve` 不发布 canonical gateway 的私有控制端点；因此此路线验证的是每次启动会话凭据，并未验证原生票据。正式产品需完成进程创建身份、端点身份、鉴权、并行官方 Hermes 共存与退出证明。若改用 `gateway ensure`，必须重新验收私有发现范围和生命周期，不能直接沿用本矩阵结论。
