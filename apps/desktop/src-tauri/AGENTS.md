# Rust 原生客户端规则

本目录同时遵守仓库根目录 [AGENTS.md](../../../AGENTS.md) 和桌面项目 [AGENTS.md](../AGENTS.md)。实现事实以 [锁文件](../../../runtime/upstream.lock.json) 指向的 Hermes 提交、当前 Rust 代码和实际验证为准。

1. 修改原生命令、事件、Gateway RPC/HTTP 或持久化字段前，先列出前端调用、Tauri 适配、Rust 参数构造、锁定 Gateway 接收方校验及返回值使用。只改实现或只改同侧单测断言都不能证明接口兼容；更改跨层字段时同步检查 `@hermess/contracts` 和所有调用方。
2. Gateway 请求字段必须从锁定 fork 的对应入口确认可用值、默认值、映射规则和语义。不得把内部名称、展示名称、其他方法的参数规则或旧文档中的值直接当作当前请求契约；每个方法分别核对。修改字段值或语义前，须提供接收方接受拟改值的证据，并确认原有行为如何变化。
3. 改动 Gateway 请求时，验证须使用当前 Rust 生产函数生成的请求形状，向锁定 Gateway 的对应入口发起成功及关键拒绝用例，并核对响应或错误。可用隔离临时 Profile 与本产品进程；不得连接或改动用户另装的 Hermes。现有脚本若构造不同请求，先修正或新增覆盖，再运行。仅 `cargo test`、格式检查、编译、插件注册检查或模拟 Gateway 的本端单测不能替代此验证。
4. 如果接收方验证未运行、失败或无法复现，停止交付该接口改动；在记录中写明阻碍和未验证范围，不得把它标为完成、提交或制作 RC tag。验证通过后还要检查本次改动涉及的入口、恢复、失败和重试路径；Windows 与 macOS 分别记录结果，单平台结果不能代表双端验收。
5. 保持 Rust 模块职责：`main.rs` 只初始化和注册，运行时所有者管理 Gateway 与产品进程，具体能力放入所属模块。生产代码不使用 `use super::*` 引入隐式依赖；单元测试放在独立 `tests/` 文件，生产模块仅声明测试模块。
6. 新增产品进程必须经共享 `process_manager` 登记并覆盖子进程树，处理创建、结束、失败、超时及托盘退出；遵守桌面规则的关闭顺序。探测子进程在 Windows 无窗口运行；不得扫描或接管外部 Hermes 实例。
7. Windows 路径在存储、IPC、前端及子进程边界保持普通 Win32 写法；深路径只在内部文件系统调用时临时转换，返回时用 `paths::plain_path`。macOS 和 Linux 路径行为保持原样。日志覆盖关键状态和结果，不输出凭据、令牌或敏感配置。
8. 修改 Rust 代码至少运行 `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check`、`cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --locked`、`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked`；涉及共享边界时运行 `pnpm check:architecture`、相关契约检查和目标 Gateway 验证。明确记录未进行的原生窗口与安装包验收。
