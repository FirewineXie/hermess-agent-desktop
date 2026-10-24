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

## 尚未完成

- 上游组装器生成 payload、来源摘要及脱网启动；PM 隔离依赖构建已验证一次。
- 正式产品的数据根选择、私有发现、完整身份鉴权、跨重启进程归属与退出验收。当前仅有 I0 进程内开发态实现。
- HTTP/JSON-RPC/WS 适配、消息与工具闭环、审批、停止、恢复。
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
