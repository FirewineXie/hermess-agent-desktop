# 桌面客户端项目

Tauri 2 客户端负责原生窗口、宿主能力、Hermes 运行时及安装包。`src/main.tsx` 是生产界面的唯一装配入口，向 `@hermess/frontend` 注入 Tauri 适配层；`src-tauri/` 是 Rust 原生实现。

## 当前结构

- `src/adapter/`：Tauri 命令、事件、文件选择与拖放的能力实现。
- `src-tauri/src/main.rs`：Tauri 初始化与命令注册。
- `src-tauri/src/errors.rs`：原生命令的稳定错误封套；已注册的可失败命令均返回该封套，内部 Gateway/文件/HTTP 错误仍逐步细分类别。
- `src-tauri/src/diagnostics.rs`：本机工具探测与诊断日志。
- `src-tauri/src/storage.rs`：产品存储位置校验。
- `src-tauri/src/paths.rs`：产品 Windows 路径统一为普通盘符或 UNC 写法；深路径只在内部文件系统调用时临时使用扩展写法，不向进程、前端或持久化配置传出。macOS 与 Linux 保持原样。
- `src-tauri/src/runtime/mod.rs`：自有后端实例、进程、凭据和 Gateway 生命周期的统一所有者。
- `src-tauri/src/process_manager.rs`：桌面创建的产品进程统一登记、封闭新启动与按用途退出；`process_manager/windows.rs` 用 Job Object 管理进程树，`process_manager/macos.rs` 用独立进程组和随主程序退出的守护进程回收组内成员，尚不能约束主动脱组的后代。
- `src-tauri/src/runtime/channels.rs`：飞书、微信扫码接入、私聊放行或配对审批模式、配对码批准与渠道状态；扫码凭据只保留在 Rust 宿主，授权后写入自有 Hermes 配置。
- `src-tauri/src/runtime/channel_manage.rs`：按当前 Profile 代理锁定 Gateway 的渠道配置与测试接口，启用前检查必填字段，返回给前端的渠道目录只含字段元数据。
- `src-tauri/src/runtime/channel_telegram.rs`、`channel_vendor_qr.rs`：Telegram、钉钉、企微群机器人及 QQ Bot 的扫码状态与临时凭据；QQ 返回的密钥在 Rust 中解密。成功后经产品自有 Gateway 配置接口保存，不调用上游自带的自动重启。
- `src-tauri/src/runtime/modelscope.rs`：客户端自有的 ModelScope Skill 搜索、ZIP 检查与安装适配；只写入本产品的 Hermes 数据目录，不修改固定上游源码。
- `src-tauri/src/runtime/mcp_registry.rs`：公开 MCP Registry 的只读搜索、详情及可直接配置的 HTTPS 远程条目筛选；实际安装经当前自有 Hermes 的 MCP 配置接口。
- `src-tauri/src/runtime/modelscope_mcp.rs`：ModelScope MCP 广场的公开搜索与详情适配；仅在公开详情提供静态 HTTPS 地址时经当前自有 Hermes 安装，不代管 ModelScope 账号部署。
- `src-tauri/src/tray.rs`：窗口关闭时收起到系统托盘，托盘菜单可恢复窗口或退出。
- `src-tauri/src/runtime/about.rs`：读取编译时产品版本、固定上游锁与随程序内嵌的产品及上游许可证。
- `src-tauri/src/runtime/location.rs`：产品存储定位文件和所有者锁。
- `src-tauri/src/runtime/payload.rs`：固定上游资源校验与离线安装。
- `src-tauri/src/runtime/retired_payload.rs`：Windows 发行版在新 Gateway 就绪后后台清理安装目录中带相邻 `.owner` 标记的旧运行时；占用或中断时保留标记，后续启动重试。
- `agent-tools/powershell/`：本产品的 Windows PowerShell Tool。Windows 桌面程序内嵌工具代码，在自有 Hermes 根目录及各命名 Profile 中部署并启用 `powershell_execute`；各 Profile 首次部署后仍可自行禁用。工具注册到仅桌面会话启用的 `desktop_ui` 工具集，使其在延迟工具搜索开启时仍直接出现在模型工具列表中。执行时使用用户机器上的 PowerShell 7 或 Windows PowerShell 5.1，不随包安装解释器。工具启动的脚本让常用文本读写命令默认使用 UTF-8；PowerShell 5.1 写入 UTF-8 时会带 BOM，显式 `-Encoding` 仍优先。
- `src-tauri/src/runtime/chat.rs`、`models.rs`、`config.rs`、`tools.rs`：按产品能力整理的原生命令，显式声明对运行时所有者的依赖。
- 新建聊天会话可接收工作区目录；Rust 在调用网关前要求该目录是本机已存在的绝对目录，并向 `session.create` 传递明确的 `cwd`。
- `src-tauri/src/gateway.rs`：固定上游 Gateway 的 WebSocket/RPC 适配。
- `src-tauri/src/tests/`、`src-tauri/src/runtime/tests/`：Rust 单元测试；生产模块只保留 `#[cfg(test)]` 下的模块声明。

运行时所有者独占子进程、存储锁和当前 Gateway；功能命令在所有权锁内复制当前连接句柄或本地端点信息，释放锁后才等待 Gateway/HTTP。启动时声明 `--external-supervisor`，让锁定 Gateway 的终端工具保护阻止 AI 停止或重启自己的宿主；支持的重启请求由客户端接续启动。主窗口收到断线后只请求一次 Rust 恢复：自有进程存活时最多用 5 秒重新核验身份和连接，健康连接直接复用；持续不可连时停止该进程管理登记对应的整棵树，再按保存的启动参数重新拉起，原进程已退出则直接重新拉起。目录相同或占用同一端口不构成进程归属依据，不接管其他 Hermes 安装。

Rust 恢复总预算为 60 秒，包含等待生命周期锁；60 秒窗口内最多自动新建一次进程，手动重试可重新发起。前端本地恢复等待上限为 135 秒，为 Rust 恢复、新连接的 Profile 解析和会话恢复 RPC 留出时间，不叠加本地传输重试循环；远程保留原有重连策略。停止、退出和切换连接取消进行中的恢复。连接状态独立于运行时信息，失败时可在当前页重试；恢复持久会话并保留草稿和文件附件，原纪元的暂存图片提示重新添加，不自动重发消息。

停止和重连关闭旧 Gateway，使旧连接上的等待调用返回错误。普通 RPC 与审批/澄清回应从排队发送到收到结果均有 30 秒上限。启动期间等待后端就绪持有所有权锁，最长 60 秒；停止和连接切换可取消这一等待。Windows 的 Job Object 会在原进程退出时结束它的后代，Rust 负责按原参数重新创建受管理的 Gateway；macOS 使用现有进程组管理，其主动脱离进程组的后代不等同于 Windows Job Object 的覆盖范围。具体测试与未验收范围见根目录路线图。

桌面启动一个自有 `hermes gateway run` 进程，承载聊天会话和消息渠道。HTTP 配置接口使用 Rust 保管的随机会话令牌；聊天 WebSocket 使用网关私有控制端签发的一次性票据。Rust 直接连接私有控制端完成自有进程发现和取票请求，不再为这两步启动 Python 辅助进程；票据仍由 Gateway 签发。令牌不在根路径公布，带浏览器 `Origin` 的 WebSocket 握手被拒绝。安全逻辑和三个接入点由 [Hermes fork 的桌面分支](https://github.com/FirewineXie/hermes-agent/tree/hermess-desktop)直接跟踪；`pnpm fetch:upstream` 检出锁定 SHA，`pnpm verify:upstream` 校验来源、分支历史和干净工作区。Rust 启动时检查私有入口和浏览器握手；拥有桌面 WebView 执行权的代码仍可调用已开放的 Tauri 命令，命令权限须由 Rust 校验。扫码成功后由桌面重启这一自有网关，加载新渠道配置。

渠道扫码保存配置后，桌面通过 Hermes 现有 drain 接口暂停新任务，等待当前任务结束，再停止并重启自有网关。等待超过 60 秒或 Hermes 拒绝停止时保留旧网关，用户可继续等待或确认强制重启；单实例重启仍会短暂断线。

## 聊天媒体读取

聊天媒体通过 `DesktopApi.media` 和 `runtime/media*.rs` 适配锁定 fork Desktop 的行为，不修改 fork。前端只持有资源 ID 和 `hermess-media` URL；Rust 按调用窗口、Profile、会话和 Gateway 连接身份登记资源，在释放、窗口销毁或连接替换后拒绝继续读取。凭据和原始 HTTP 鉴权留在 Rust。

本地文件按会话实际 `cwd` 解析相对路径，支持普通 Windows 盘符/UNC、macOS 路径和 `file:` URL；远程会话路径只交给对应 Gateway 的 `/api/fs/download`，保留反向代理路径前缀。消息中的独立 HTTP(S) URL 不继承 Gateway 凭据。音视频通过有界 Range 响应读取，文件另存为使用原生保存对话框和同目录临时文件，成功后替换目标；取消或失败清理临时文件。

单次完整内嵌读取上限 32 MiB，Range 块上限 4 MiB，普通文本预览上限 2 MiB，HTML 预览保留既有 20 MiB 上限，下载上限 2 GiB。图片和音视频的实际解码能力取决于 WebView2/WKWebView；不支持的格式可另存为。PDF 内嵌查看同样依赖系统 WebView，普通 HTML 文件使用静态沙箱，`::preview` 保留既有自包含交互沙箱。

锁定接收方验证位于 `tests/test_media_gateway.py`，使用隔离 Profile 和临时文件，调用生产 Rust URL 构造函数后交给 fork 的真实 HTTP 路由与鉴权中间件；它不调用模型，也不等同于原生播放验收。

## 本地命令

从仓库根目录运行：

```sh
pnpm build
pnpm tauri:dev
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
```

离线安装包和发布仍按根目录 [发行流程](../../docs/release-process.md) 构建；普通前端构建不等于原生窗口或安装包验收。

`pnpm build` 会混淆桌面发行前端的 JavaScript，并检查产物未携带 source map；`pnpm tauri:dev` 的开发服务器仍使用可调试代码。Rust release 构建裁剪符号。Hermes 离线载荷按锁定提交原样归档，见 [发行流程](../../docs/release-process.md)。

## 设备偏好与快捷输入

宿主将设备偏好保存在产品应用配置目录的 `desktop-preferences.json`；全局快捷键由同一 Tauri 进程注册，独立输入窗通过一次性请求交给主聊天控制器。Windows/macOS 保持唤醒分别使用原生 Power Request/IOKit，不启动辅助进程。托盘退出先释放这些资源，再按既有进程管理顺序关闭产品进程。功能及验收限制见 [本批设置能力记录](../../docs/settings-models-desktop-capabilities.md)。
