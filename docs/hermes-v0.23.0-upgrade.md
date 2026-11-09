# v0.1.11 Hermes 稳定版升级记录

## 当前状态

2026-11-08 用户明确要求创建 `v0.1.11` 分支并升级 fork 到最新稳定版，本次授权范围为官方版本升级、冲突处理和验证。

- 产品分支：`feature/v0.1.11`，从最新 `origin/main`（`cce9d3a`）创建。
- 旧产品锁：官方 `v0.22.5` / `bf0203a794a07aac3ff764972ab9087baa4e4f4e`，fork `882037eb8745b505db438217513c4c94f95c93c1`。
- 官方最新非预发布、非草稿 Release：[v0.23.0](https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.0)，发布于 2026-11-05，解引用提交 `2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19`。
- fork 升级分支：`codex/upgrade-hermes-v0.23.0`；合并提交 `f41d994729eac52cfec8137b436d792c5ec35435` 的两个父提交分别为当前桌面维护提交和官方稳定版提交。
- [fork PR #4](https://github.com/FirewineXie/hermes-agent/pull/4) 通过门禁后以 Squash Merge 合入 `29a86e95c3d438e64bc71f8ae8237fd3a94f19ce`。其文件树与原升级提交一致，但官方 `v0.23.0` 提交缺失于祖先历史，未满足产品锁定验证条件。
- [fork PR #5](https://github.com/FirewineXie/hermes-agent/pull/5) 的门禁已通过。合入结果 `a86cb3063c799a8c585aa1334fdf8c53a89876f1` 仍是单父提交，祖先关系仍缺失。
- [fork PR #6](https://github.com/FirewineXie/hermes-agent/pull/6) 从最新维护提交接回官方历史。维护者在 [Hermess desktop gate](https://github.com/FirewineXie/hermes-agent/actions/runs/42603438035/job/129113229415) 通过后保留双亲合入 `222b3748470c369050078ff3864100deb609918e`，文件树与 PR #4 一致。产品锁已指向该维护提交。

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

## 桌面验收范围

产品锁、源码校验、资源生成、Windows payload 构建、前端、Rust 和协议回归已通过。Windows 隔离 Tauri 调试窗口验证跨主机会话、历史分叉和回退及本机终端。macOS 原生窗口、正式安装升级和真实渠道扫码留待验收。当前功能及测试范围见[路线图](../ROADMAP.md)。

## 版本对比与产品动作

[v0.22.5 发布说明](https://github.com/NousResearch/hermes-agent/releases/tag/v0.22.5) 已包含用量窗口、可插拔委派、插件命令选择、导入器和 MCP 服务迁移。[v0.23.0 发布说明](https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.0) 汇总从 v0.22.0 起的更新。产品接入以两个 tag 的实际差异为准。

| 变化 | 产品动作 |
| --- | --- |
| `browser_exec` 取代旧浏览器工具，`browser.manage` 删除 `use` 和 `browser_use` | 修正浏览器命令、补全和冒烟断言，保留产品自有 Chromium 的进程边界 |
| 插件目录、依赖锁和内置 Skill 更新 | 重新生成目录及翻译，重建 payload，复测自有 Profile 的插件、工具和渠道 |
| `/model reset` 和 `/rewind` | 模型选择通过 Gateway 会话操作恢复默认模型。终端沿用官方 `/rewind`，聊天通过历史消息菜单编辑重发或分叉 |
| Cron 停止执行、补跑、时区和宽限时间 | 现有任务页可按需接入新版字段及停止接口，作为独立功能验收 |
| 批量/自动更新插件、依赖缺失和重启提示、Skill 锁 | 在现有插件与 Skill 页面按需接入官方接口，保留单项更新的确认和 Profile 隔离 |
| 流事件新增去重标识、渠道插件化、模型与 MCP 改善 | 先回归真实接收方和恢复流程。确认兼容缺口后处理 |
| Webapp、官方 Electron 多连接及群聊扩展 | 单独评估产品入口和连接生命周期 |

新版 `/browser` 补全直接消费 Gateway 子命令目录。`commands.catalog` 仍包含多个入口的目录，`desktop` 和 `desktop_subcommands` 只表达部分可用性。Windows 隔离会话实测 `/model` 标为 `hidden`，子命令目录含 `reset`，但 `slash.exec` 拒绝 `/model reset`，`config.set` 要求使用 `session.mutate` 的 `model` 操作。向该操作传 `{"model":"reset"}` 已验证能把临时模型恢复到 Profile 默认模型。`/rewind` 标为 `terminal`。迁移整个聊天菜单需要 Gateway 提供与实际执行入口一致的目录，当前按已核实的命令逐项接入。

Windows 正式锁定检出通过 `pnpm fetch:upstream` 内置校验。已生成 1050 条插件条目及 17 份翻译，相对旧快照新增 288 条、156 条既有条目的固定提交更新。`pnpm check:legal`、`pnpm --dir apps/frontend typecheck`、`pnpm build`、Rust 格式与锁定依赖编译通过，Rust 测试 308 通过、57 条件忽略。适配改动的架构和契约检查通过。`verify-composer-gateway.py` 以正式锁定源码启动真实 Gateway，覆盖浏览器新版目录、连接、状态、断开、拒绝旧动作及现有聊天命令。

`channel-management-gateway.py` 和 `channel-access-gateway.py` 对正式锁定源码通过，覆盖默认与命名 Profile 的渠道目录、配置保存、非法配置拒绝、WhatsApp 已配对分支和配对码处理。真实扫码、渠道收发、原生 Chromium 进程操作及安装包留待原生验证。

正式 Windows x64 payload 使用 `build-core-payload.py` 构建，manifest 引用 `222b3748470c369050078ff3864100deb609918e`，`verify-payload.py` 逐项核对 7505 个源码条目通过。项目默认开发环境和 payload 已切换到新版，旧目录保留在忽略区。`verify-chat-environment.py` 使用新版 payload 的启动器执行生产 Tauri 会话命令，PowerShell 与终端均选中预期 Python，两会话工具环境隔离、项目虚拟环境、恢复和非法 `client_env` 拒绝均通过。旧 `serve` 兼容路径的 `smoke-gateway.py` 通过，包括 `browser_exec` 目录断言。测试的合成 HTTP 服务在连接关闭时记录一次 socket reset，脚本全部断言通过并以 0 退出。

`verify-gateway-recovery.py` 使用新版 payload 和 Windows 无窗口 Tauri 测试验证终端重启拦截、PowerShell 重启后自动恢复、退出码 75 后手动恢复、新票据和旧历史、无重复提交及临时目录清理，全部通过。

## 本机 Web Access 与 Skill 锁定

2026-11-09 先用隔离探针复现 Web Access 的浏览器握手限制，随后在桌面客户端接入 HTTPS/WSS 转发。Windows PowerShell 的 Skill 锁定写入保护仍待修复。

- Windows x64 用锁定 PM 的 Node 26.12.1 在临时源码目录构建官方 Webapp。通过上游 assembler 把资源放入 payload，并核对 7505 个锁定源码条目。Node 与 npm 缓存只用于构建。上游安装标记工具记录正式基线、维护提交和更新归属。Windows 启动器实测显示 `v0.23.0+7`，其中 7 是 fork 相对官方基线多出的提交数。
- `scripts/verify-web-access.py --hermes <payload>/bin/hermes.exe --expect-private-conflict` 使用产品一致的私有环境与 Gateway 启动参数。实测 Webapp 默认为关闭，保存开启并重启后可读取 HTML 和脚本，HTML 不含会话凭据。Gateway 的一次性链接可在同源兑换，重放返回 403。浏览器成功签发 WebSocket 票据后，跨源和同源升级都返回 403。锁定 fork 的 `ws_host_origin_reason` 在正常 Origin 校验之前拒绝所有非空 Origin。该探针验证接收方与复现条件，未接入产品 UI。
- 启用 Webapp 后 `GET /api/config` 拒绝旧的启动令牌，返回 401。桌面启动已区分默认私有模式和手动开启的回环 Webapp。Webapp 启用时，现有桌面 HTTP 客户端使用私有控制端签发的一次性链接在本机兑换当前会话凭据，聊天仍走私有控制端签发的原生票据。
- Windows 运行 `scripts/verify-powershell-tool.py --skill-lock reproduce`，在独立临时 Profile 通过产品注册的工具验证。文件工具拒绝覆盖，PowerShell 的 `Get-Content` 能读原文，`Set-Content -LiteralPath` 却退出 0 并改写文件。锁定上游的 `command_refusal` 不识别这一写入，已有终端守卫用例也存在 Windows 路径拦截失败。修复后用同一脚本的 `--skill-lock verify` 验证允许读、拒绝写和原文保留。

在「设置 → 运行时与存储 → Web Access」填写 HTTPS 地址和监听 IP，点击「自动生成证书并保存」。客户端按访问地址签发自签证书，将证书和私钥保存在应用配置目录，后续开启复用该证书。已有 PEM 证书可从「导入已有证书（高级）」配置。访问设备需要信任所用证书。手动开启时，桌面首次平滑重启本机 Gateway，以进程级配置限定 Webapp 监听 `127.0.0.1`。浏览器使用桌面生成的 60 秒一次性链接登录。桌面校验外层 Host 和浏览器 Origin，把请求转到本机 Gateway，并沿用 Gateway 的会话和 WebSocket 票据。关闭只停止桌面监听和浏览器连接。客户端退出或 Gateway 重新启动后须手动开启。若 Gateway 已有管理员托管配置，客户端拒绝覆盖。

Windows 专项命令为 `scripts/verify-desktop-web-access.py --hermes <payload>/bin/hermes.exe`。探针使用无窗口 Tauri 运行生产转发代码，验证锁定 Gateway 的一次性链接、WS 票据、拒绝用例和关闭后连接回收。跨设备浏览器、原生设置窗口、macOS 和安装包仍待验收。

Skill 锁定需把 Windows 路径与 PowerShell 写入的检查收敛在 Gateway 的守卫中，再让产品的 PowerShell 工具复用该守卫。涉及 fork 的改动需独立批准和审核。Windows 验证覆盖实际拒绝写入和正常读取，macOS 回归现有命令。
