# 桌面客户端项目

Tauri 2 客户端负责原生窗口、宿主能力、Hermes 运行时及安装包。`src/main.tsx` 是生产界面的唯一装配入口，向 `@hermess/frontend` 注入 Tauri 适配层；`src-tauri/` 是 Rust 原生实现。

## 当前结构

- `src/adapter/`：Tauri 命令、事件、文件选择与拖放的能力实现。
- `src-tauri/src/main.rs`：Tauri 初始化与命令注册。
- `src-tauri/src/errors.rs`：原生命令的稳定错误封套；已注册的可失败命令均返回该封套，内部 Gateway/文件/HTTP 错误仍逐步细分类别。
- `src-tauri/src/diagnostics.rs`：本机工具探测与诊断日志。
- `src-tauri/src/storage.rs`：产品存储位置校验。
- `src-tauri/src/runtime/mod.rs`：自有后端实例、进程、凭据和 Gateway 生命周期的统一所有者。
- `src-tauri/src/runtime/location.rs`：产品存储定位文件和所有者锁。
- `src-tauri/src/runtime/payload.rs`：固定上游资源校验与离线安装。
- `agent-tools/powershell/`：本产品的 Windows PowerShell Tool。Windows 桌面程序内嵌工具代码，启动自有 Hermes 实例前部署并注册为 `powershell_execute`；使用用户机器上的 PowerShell 7 或 Windows PowerShell 5.1，不随包安装解释器。
- `src-tauri/src/runtime/chat.rs`、`models.rs`、`config.rs`、`tools.rs`：按产品能力整理的原生命令，显式声明对运行时所有者的依赖。
- `src-tauri/src/gateway.rs`：固定上游 Gateway 的 WebSocket/RPC 适配。

运行时所有者仍独占子进程、存储锁和当前 Gateway；功能命令在所有权锁内复制当前连接句柄或本地端点信息，释放锁后才等待 Gateway/HTTP。停止和重连关闭旧 Gateway，使旧连接上的等待调用返回错误。普通 RPC 与审批/澄清回应从排队发送到收到结果均有 30 秒上限。启动期间等待后端就绪仍持有所有权锁，最长 60 秒，尚未改为可中断启动。

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
