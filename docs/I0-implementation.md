# I0 实施记录

日期：2026-10-24。验证机器：Windows x64。

## 已完成

1. 在产品目录初始化独立 Git 仓库，添加上游 submodule，固定 `5894e750c3dba980d43b25aa29e3958149ba2c61`。
2. 建立 Tauri 2 + React + TypeScript 最小工程。检测命令使用绝对可执行路径、4 秒超时；不会执行 shell、不安装依赖。
3. 上游源码完整性脚本可校验锁文件、submodule 指针、HEAD 和工作区；`pnpm verify:upstream` 已通过。
4. `pnpm build` 已通过。Windows 的 `python` 命令是商店别名，uv 已安装 CPython 3.14.0；Node 为 22.16.0。当前原生检测尚未运行到 UI，不能声称检测功能已通过端到端验收。
5. 使用原版 `pm.operations.build_environment`、固定 `uv.lock` 和本机 CPython 3.14.0，在 `.build/hermes-venv-i0` 建立隔离依赖环境；`pyvenv.cfg` 指向该已有解释器，`include-system-site-packages = false`。
6. 从该环境启动 `hermes serve --host 127.0.0.1 --port 0 --isolated`，设置独立 `HERMES_HOME`、私有锁目录和每次启动凭据；约 14 秒取得就绪文件 `{"port":7416}`，随后仅停止本次启动的 PID。此测试证明当前 Windows 后端可以启动并报告端口，尚未证明 HTTP/WS 鉴权或真实任务。

## 尚未完成

- 上游组装器生成 payload、来源摘要及脱网启动；PM 隔离依赖构建已验证一次。
- 独立 HERMES_HOME、私有发现目录、启动凭据、真实身份鉴权、进程归属与退出。
- HTTP/JSON-RPC/WS 适配、消息与工具闭环、审批、停止、恢复。
- 本机解释器复用后的隔离依赖环境、托管兜底下载、离线导入。
- 自选安装/存储位置及升级事务。
- macOS/Linux 的构建、签名、安装与实机验收。

## 当前构建阻塞

本机 `cargo check` 和 `cargo +stable-x86_64-pc-windows-msvc check` 都在编译依赖时提示缺少 Rust `core`；`cargo +1.95.0-x86_64-pc-windows-msvc check` 提示标准库只有 metadata stub。此问题发生在依赖阶段，尚无本项目 Rust 代码的编译结论。需修复本机 Rust 标准库安装后重跑 `cargo check` 和 `pnpm tauri:dev`。

## 上游接口事实

- `hermes serve --host 127.0.0.1 --port 0 --isolated` 是待验证的首选独立后端路线。
- `HERMES_DESKTOP_READY_FILE` 当前只发布端口，不能单凭端口证明身份。
- `HERMES_DESKTOP=1` 单独不构成归属证明；固定提交还检查每次启动的 `HERMES_DASHBOARD_SESSION_TOKEN` 或 SSH 启动身份。
- 因此本样机没有在未实现完整鉴权与归属前擅自启动后端。
