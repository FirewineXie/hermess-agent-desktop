# I0 实施记录

日期：2026-10-24。验证机器：Windows x64。

## 已完成

1. 在产品目录初始化独立 Git 仓库，添加上游 submodule，固定 `5894e750c3dba980d43b25aa29e3958149ba2c61`。
2. 建立 Tauri 2 + React + TypeScript 最小工程。检测命令使用绝对可执行路径、4 秒超时；不会执行 shell、不安装依赖。
3. 上游源码完整性脚本可校验锁文件、submodule 指针、HEAD 和工作区；`pnpm verify:upstream` 已通过。
4. `pnpm build` 已通过。Windows 的 `python` 命令是商店别名，uv 已安装 CPython 3.14.0；Node 为 22.16.0。当前原生检测尚未运行到 UI，不能声称检测功能已通过端到端验收。
5. 使用原版 `pm.operations.build_environment`、固定 `uv.lock` 和本机 CPython 3.14.0，在 `.build/hermes-venv-i0` 建立隔离依赖环境；`pyvenv.cfg` 指向该已有解释器，`include-system-site-packages = false`。
6. 从该环境启动 `hermes serve --host 127.0.0.1 --port 0 --isolated`，设置独立 `HERMES_HOME`、私有锁目录和每次启动凭据；约 14 秒取得就绪文件 `{"port":7416}`，随后仅停止本次启动的 PID。此测试证明当前 Windows 后端可以启动并报告端口，尚未证明 HTTP/WS 鉴权或真实任务。
7. `scripts/smoke-gateway.py` 从产品 `.build` 下的隔离环境启动后端，使用原版接受的会话凭据完成 `/api/ws` 的 JSON-RPC `ping`；实际返回 `pong: true`，错误凭据被拒绝。进程由测试脚本持有并在退出时停止。
8. 新装完整的 Rust 1.94.0 MSVC 工具链后，`cargo check` 和 `tauri build --no-bundle` 均通过，生成 Windows 原生可执行文件。`pnpm tauri:dev` 编译并启动调试进程；当前 Windows 会话处于锁屏，无法通过窗口操作验证按钮。开发态 Tauri 命令已实现启动、ping、停止，其端到端 UI 操作仍未验收。
9. 扩展 `scripts/smoke-gateway.py` 使用上游假模型：`session.create`、`prompt.submit`、7 个 `message.delta` 与 `message.complete` 实测通过；随后真实执行 `read_file` 并收到 `tool.complete`。测试没有真实模型费用或外部模型请求。对应产品代码已加入持续 WS 代理和最小聊天界面，产品 UI 仍待操作验收。能力边界见 `docs/capability-matrix.md`。
10. 持续 WS 连接在 `gateway.ready` 后声明 `client.capabilities`，Rust 与开发态 UI 接入 `approval`、`clarify` 和 `request.cancel`。脚本用假模型完成澄清回答往返，并对 `rm -rf` 临时测试目录选择 `deny`；目录保持存在。`cargo check`、`pnpm build` 均通过。窗口交互仍未验收。
11. 接入 `session.list`、`session.resume`、`session.interrupt`；脚本证实列表里的持久化 ID 与会话创建返回的运行时 ID不同，使用前者恢复了完整回复，并调用中断 RPC。开发态 UI 可列出和恢复会话、停止当前任务。
12. `session.create` 结果改为保留运行时与持久化 ID；后端连接断开后可在开发态 UI 手动重连并用持久化 ID 恢复。脚本在假模型流式输出中断开首条 WS，第二条 WS 通过 `session.resume` 重附着同一运行时会话，并核对 `session.events.since` 水位。另用慢速流式假模型在中途调用 `session.interrupt`，收到 `interrupted` 与最终 `message.complete`。这些是协议级测试，窗口操作与重放渲染仍未验收。

## 尚未完成

- 上游组装器生成 payload、来源摘要及脱网启动；PM 隔离依赖构建已验证一次。
- 正式产品的数据根选择、私有发现、完整身份鉴权、跨重启进程归属与退出验收。当前仅有 I0 进程内开发态实现。
- 断线自动重连、事件重放渲染；运行中断、历史恢复、审批、澄清已有脚本级闭环，但桌面窗口交互尚未验收。
- 本机解释器复用后的隔离依赖环境、托管兜底下载、离线导入。
- 自选安装/存储位置及升级事务。
- macOS/Linux 的构建、签名、安装与实机验收。

## 构建环境结论

原有 Rust stable 与 1.95.0 安装的标准库异常，依赖编译提示缺少 `core` 或只有 metadata stub。另装 1.94.0 MSVC 后可正常编译；项目以 `rust-toolchain.toml` 固定该构建工具链。原有工具链未被覆盖。

## 上游接口事实

- `hermes serve --host 127.0.0.1 --port 0 --isolated` 是待验证的首选独立后端路线。
- `HERMES_DESKTOP_READY_FILE` 当前只发布端口，不能单凭端口证明身份。
- 该固定提交的专用 `serve` 没有 canonical gateway 的私有控制端点；其 loopback WebSocket 接受每次启动的 `HERMES_DASHBOARD_SESSION_TOKEN`。I0 已验证该路径的 `ping`，没有声称原生票据已通过。正式连接仍需进程身份、端点与鉴权的完整共存测试。
- `HERMES_DESKTOP=1` 单独不构成归属证明；固定提交还检查每次启动的 `HERMES_DASHBOARD_SESSION_TOKEN` 或 SSH 启动身份。
- 因此本样机没有在未实现完整鉴权与归属前擅自启动后端。
