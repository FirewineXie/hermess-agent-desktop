# v0.1.11 Hermes 稳定版升级记录

## 当前状态

2026-11-08 用户明确要求创建 `v0.1.11` 分支并升级 fork 到最新稳定版，本次授权范围为官方版本升级、冲突处理和验证。

- 产品分支：`feature/v0.1.11`，从最新 `origin/main`（`cce9d3a`）创建。
- 当前产品锁：官方 `v0.22.5` / `bf0203a794a07aac3ff764972ab9087baa4e4f4e`，fork `882037eb8745b505db438217513c4c94f95c93c1`，本轮尚未修改。
- 官方最新非预发布、非草稿 Release：[v0.23.0](https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.0)，发布于 2026-11-05，解引用提交 `2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19`。
- fork 升级分支：`codex/upgrade-hermes-v0.23.0`；合并提交 `f41d994729eac52cfec8137b436d792c5ec35435` 的两个父提交分别为当前桌面维护提交和官方稳定版提交。
- [fork PR #4](https://github.com/FirewineXie/hermes-agent/pull/4) 面向 `hermess-desktop`，等待门禁及维护者手动合并。未修改 fork `main`，未创建、改写或删除 fork tag。

## 同步和冲突处理

使用单独的忽略工作区操作 fork，保留 `upstream/hermes-agent` 的原锁定检出。获取 fork 全部分支与 tag，并从官方远端获取 main 和 tag；本地共有 2655 个 origin 远端引用（含 HEAD）与 248 个 tag。获取远端引用不会把官方 main 的未发布内容合入升级分支，实际合入的是 `v0.23.0`。

两个冲突文件的处理：

- `hermes_cli/web_server.py`：先保留 `require_loopback_host(host)`，同时保留官方新增的代理环境恢复调用。
- `hermes_cli/web_server_dashboard.py`：采用新版 `_server().app.state`、应用状态及 Webapp surface / `html_token` 策略，并继续使用 `withhold_token()` 隐藏桌面令牌。

WebSocket 共享边界的桌面 Origin 拒绝逻辑自动合并。相对官方稳定版，仍仅保留原 5 个桌面集成文件，84 行增加、2 行删除。未因上游自身大文件或空白告警进行无关拆分或格式重写。

## 实际验证

平台：Windows，CPython 3.14。通过上游 `pm.build_env --source <升级源码> --out <独立环境> --group dev --group test` 创建隔离测试环境，不修改产品 payload 或既有依赖环境。

1. 用上游 `scripts/run_tests.sh` 运行 `test_web_server_host_header.py`、`test_web_server_surface.py`、`test_dashboard_auth_session_token_gate.py`、`test_dashboard_token_auth.py`：91 项通过、0 项失败。
2. 本地隔离集成探针：11 个场景通过，实际调用 `start_server` 验证拒绝非回环监听；通过 FastAPI/Starlette ASGI 客户端验证 headless / SPA 私有模式不返回令牌、普通模式仍返回令牌；真实路由的事件 WebSocket 在私有模式下拒绝 http / https / null / file Origin，接受无 Origin，普通模式接受同源 Origin。
3. 四个集成模块 `py_compile` 通过，相对官方 tag 的 `git diff --check` 通过。官方 tag 自带部分空白告警，未改动这些无关内容。
4. 独立代理只读审核完成，未发现冲突解决引入的缺陷；审核建议补齐的实际入口验证已完成。

探针首次因 ASGI 客户端默认 Host 与监听地址不匹配而拒绝无 Origin 连接；明确指定生产一致的 Host 和回环客户端后通过，未为此修改生产实现。本地探针、日志与依赖环境均位于忽略目录，不纳入提交。

## 尚未完成

fork PR 通过门禁并由维护者手动合入后，才能取维护分支实际 SHA 更新产品锁文件。随后须按源码流程重新获取并核对锁定源码，验证产品调用的协议、前端、Rust、插件目录、许可证和 payload，再分别记录 Windows 与 macOS 原生及安装升级验收。当前测试不证明产品已经使用新版，不代表原生窗口、真实模型或安装包验收，也未制作 RC 或正式 tag。
