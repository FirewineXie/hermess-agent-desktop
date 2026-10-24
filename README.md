# Hermess Agent Desktop

独立 Tauri 2 桌面端，集成固定提交的原版 Hermes Agent。当前处于 I0 技术样机阶段，尚不能聊天，也没有可分发安装包。

## 当前实现

- 产品独立 Git 仓库；`vendor/hermes-agent` 为固定提交的 submodule，上游源码不修改。
- React/Tauri 最小窗口，原生侧检测本机 Python 3.14 与 Node 22 候选；检测不会下载或安装工具。
- `runtime/upstream.lock.json` 记录上游提交；`pnpm verify:upstream` 校验 submodule 指针、实际 HEAD 和源码工作区。

## 本地运行

需要 Node、pnpm、完整的 Rust Windows MSVC 工具链及 WebView2。执行 `pnpm install --frozen-lockfile` 后用 `pnpm tauri:dev` 启动。`pnpm build` 只验证前端。开发依赖只用于构建；正式发行仍需实现运行时封装和离线资源。

首次克隆后执行 `git submodule update --init`。用 `pnpm verify:upstream` 检查上游提交及源码完整性。I0 的隔离依赖准备命令为 `python scripts/prepare-python.py --python <CPython 3.14 的绝对路径> --out <新环境的绝对路径>`；脚本调用上游 PM，不会向系统 Python 安装包。正式产品的自动检测、下载及激活流程尚未实现。

目前 Python 检测只覆盖 PATH 和 Windows 的 uv 已安装解释器目录。检测通过仅表示可复用候选，不代表 Hermes 依赖已经准备好。Node 是可选工具，前端运行不会触发它的安装。

## 下一步验收

见 [I0 实施记录](docs/I0-implementation.md)。在上游 payload、私有进程发现、鉴权、协议和真实任务链路通过前，不能把本项目称为可用桌面端。
