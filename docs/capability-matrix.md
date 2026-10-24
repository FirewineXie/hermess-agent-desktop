# 固定提交接入能力矩阵

基线：`vendor/hermes-agent` 提交 `5894e750c3dba980d43b25aa29e3958149ba2c61`。下表的“已验收”仅指 2026-10-24 Windows x64 上的脚本级集成测试，不代表桌面 UI 或其他平台已通过。

| 能力 | 固定提交接口 | 当前产品实现 | 验收状态 |
| --- | --- | --- | --- |
| 本地独立启动 | `hermes serve --host 127.0.0.1 --port 0 --isolated`、`HERMES_DESKTOP_READY_FILE` | 开发态 Rust 命令管理一个子进程，私有数据根与锁目录 | Windows 脚本启动与就绪通过；窗口按钮未操作验收 |
| 本地鉴权 | loopback `/api/ws` 使用每次启动的 `HERMES_DASHBOARD_SESSION_TOKEN` | 凭据仅在 Rust 层；前端收不到 token | 正确凭据 ping 成功、错误凭据拒绝；进程身份与共存仍待验收 |
| 网关连通 | `ping` | Rust 持续连接 + RPC 请求匹配；另有独立 ping | 原版后端脚本通过；Rust 长连接未完成窗口验收 |
| 新建会话 | `session.create`，`source: desktop`、`idempotency_key` | Rust RPC 保留运行时 ID 与持久化 ID，开发态 UI 分别记录 | 脚本从真实后端取得两个 ID；UI 未验收 |
| 提交消息 | `prompt.submit` | Rust RPC 命令，无盲目重试 | 脚本取得 admission；UI 未验收 |
| 流式回复 | `message.delta`、`message.complete` | Rust 筛选事件送前端，最简文本视图 | 脚本收到 7 个 delta 与最终内容；UI 未验收 |
| 基础工具 | `tool.start`、`tool.complete` | Rust 转发工具事件，UI 仅显示状态 | 原版 `read_file` 实际执行，收到 1 个完成事件；工具卡片未完成 |
| 审批与澄清 | `gateway.ready` 后发送 `client.capabilities`；处理 `approval`、`clarify`、`request.cancel` | Rust 限额转发服务端请求并校验审批选项；开发态 UI 展示卡片并回传决定 | 脚本级澄清往返通过；危险命令审批拒绝后目标目录保留。UI 未操作验收；其他服务端请求尚未接入 |
| 中断与恢复 | `session.interrupt`、`session.resume`、`session.events.since` | Rust 重建断开的 WS，UI 用持久化 ID 手动重连，按纪元和序号合并重放事件 | 脚本验证流式任务中途停止、断线重附着同一运行时会话及重放水位；窗口恢复、截断并发与自动重连未验收 |
| 历史 | `session.list` 返回持久化 ID，`session.resume` 返回运行时 ID | 开发态 UI 列表和消息渲染 | 脚本读取列表并用存储 ID 恢复消息；窗口未验收 |
| 模型配置 | `model.options`、`setup.runtime_check`、`POST /api/model/set` | Rust 代理固定本地端点与每次启动凭据；UI 提供提供方、模型、接口地址及密钥配置，支持价格确认与新会话生效提示 | 固定核心包脚本验证错误凭据被拒、正确凭据保存假模型并完成聊天；Rust/UI 编译通过。原生窗口与真实模型未验收 |
| 完整 payload | 上游 `pm bundle`、manifest、内置工具/PM runtime/venv | `.build` 下暂存，源码校验脚本逐项对比锁定提交 | Windows x64 6,922 个发行源码条目匹配；禁用按需安装与不可达公共代理下通过假模型冒烟。包过大，物理断网和正式安装未验收 |
| 核心候选 payload | 上游 PM 工具校验、基础 venv、PM runtime 与 assembler | 产品外置组装脚本只选 Python/uv 和基础依赖；1.54 GB | 与固定源码匹配；中文空格数据根、禁用按需安装及不可达公共代理下通过聊天、文件工具、审批、停止和重连；PM/runtime 依赖离线重建通过。原子修复与正式安装迁移未验收 |
| 路径与并行实例 | 封装启动器可移动；后端支持独立 `HERMES_HOME` 和 WS 凭据 | 中文空格安装目录复制运行；Rust 持有产品存储 OS 锁，release 路径保存首次选择的存储位置 | 复制后完整冒烟通过；独立进程锁测试通过；来源 CLI 与产品并行的凭据、会话和退出隔离通过。NSIS 候选包在当前机器中文空格路径静默安装与卸载通过；用户现有官方数据及窗口操作未验收 |

专用 `serve` 不发布 canonical gateway 的私有控制端点；因此此路线验证的是每次启动会话凭据，并未验证原生票据。正式产品需完成进程创建身份、端点身份、鉴权、并行官方 Hermes 共存与退出证明。若改用 `gateway ensure`，必须重新验收私有发现范围和生命周期，不能直接沿用本矩阵结论。
