# 托盘退出时清理插件本地服务

本功能用于正常点击托盘“退出 Hermess”时，清理本产品各个本地 Profile 的插件服务。它补充共享进程管理器，不替代 Windows Job Object 或 macOS 进程组，也不承诺在崩溃、强制结束时执行命令。

## 当前实现

- `apps/desktop/runtime/plugin_services.py` 保存服务控制注册表，负责枚举 Profile、绑定准确的 Profile 目录、调用插件 CLI 和解析状态。
- `apps/desktop/src-tauri/src/runtime/plugin_services.rs` 负责存储所有权、受管理的辅助进程、超时、有限并发、待处理记录和关联日志。
- `apps/desktop/src-tauri/src/tray.rs` 接入正常退出流程。没有增加前端能力、Tauri 命令或 Gateway 接口，没有修改锁定 Hermes fork。

退出先关闭普通新进程入口，取消运行时启动/恢复，保存本地清理上下文并继续持有存储锁；然后结束终端、浏览器、编程任务、临时进程和 Gateway，回收剩余受管进程，再执行插件服务检查。清理命令通过 `process_manager::spawn_shutdown` 启动，Windows 使用无窗口标志；最后再回收清理辅助进程并退出。

Profile 枚举复用锁定 Hermes 的 `list_profile_names`，不依赖选中的 Profile、远端连接或存活的 Gateway。无身份信息的残留目录和带删除标记的 Profile 不作为当前 Profile；历史待处理记录仍保留，目录已缺失时报告失败，不重新创建 Profile。

## 注册新的服务

在 Python 文件的 `SERVICES` 中增加 `Service` 定义：

| 字段 | 含义 |
| --- | --- |
| 注册表键 | 稳定服务标识，用于去重、日志及待处理记录 |
| `plugin` | 当前 Profile 的 `plugins/` 下的插件目录名 |
| `markers` | 相对 Profile 目录的服务配置或进程记录路径；发现候选不代表服务运行 |
| `status` | 交给插件 `register_cli` 的查询参数数组 |
| `stop` | 同一 CLI 的停止参数数组 |
| `state_pattern` | 状态输出的整行正则，第一组须归一为 `ready`、`starting` 或 `stopped` |
| `stopped_output` | 未配置输出；只有全部服务标记均不存在时才允许视为已停止 |

当前桥接器支持使用 `cli.py`、`register_cli(parser)` 和 `args.func(args)` 的 Profile 本地插件。新插件若使用其他 CLI 协议，需要增加执行或解析适配，不重复编写退出协调、进程回收和日志逻辑。当前没有自动执行所有插件命令，也没有对外开放任意清理命令注册。

每个 Profile/服务分别执行 `status → stop → status`；已停止则不调用 stop。停止命令成功不等于服务已停止，必须复查。不同目标最多并发 2 个；查询和枚举单次 5 秒，停止单次 10 秒，目标清理阶段总预算 30 秒。超时后回收辅助进程树，未确认的目标仍待处理，退出结果记录为不完整，不按进程名扫描强杀。

待处理记录位于本产品存储目录的 `control/plugin-service-cleanup.json`，仅保存 Schema 版本和 Profile/服务标识，不保存命令、绝对路径或凭据。检查前保存全部候选，每完成一个就原子更新剩余集合；失败或中断的目标在下一次正常退出时重试。该记录不是启动时自动清理任务。

## OpenViking

首批注册 `openviking.quick-local`，发现标记为 `openviking/ov.conf` 和 `openviking/server-process.json`，调用插件 `local status`、`local stop` 控制入口。

产品锁定的插件目录指向 OpenViking 提交 `9f150ece247ad683494ab172d738023bd6dc6170`。锁定 Hermes 只为当前激活的记忆提供方注册顶层 CLI，因此直接运行 `hermes openviking ...` 会漏掉已经切换提供方的 Profile。桥接器在独立受管进程中，按锁定 Hermes CLI 的合成包加载方式加载当前 Profile 的 `cli.py`，不导入提供方 `__init__.py`，不修改 Profile 配置，调用相同的命令处理函数。先固定精确的 `HERMES_HOME`，不进入会读取 `active_profile` 的 Hermes 主 CLI，因此默认 Profile 不会被重定向。

服务归属和停止沿用插件自身的 PID、创建时间、命令/配置路径、端口和鉴权检查；找不到进程记录时由插件自身尝试归属验证及恢复记录。桌面只使用本产品数据根内的插件源码和 Profile，不加载系统 PATH、项目插件或用户另一套 Hermes 的控制代码。云端/Custom 连接没有 Quick Local 标记时不参与清理。

插件源码已经删除时，控制命令会不可用；配置损坏、输出未知或归属验证失败也可能无法停止。以上情况均记录失败并保留待处理目标，不声称已经完成回收。本次没有扩展插件卸载和 Profile 删除流程；若需保证删除前完成清理，应另行在其删除入口接入这一能力。

## 验证

```powershell
.build/hermes-venv-i1/Scripts/python.exe -m unittest discover -s tests -p test_plugin_services.py -v
.build/hermes-venv-i1/Scripts/python.exe scripts/verify-plugin-services.py --hermes .build/hermes-venv-i1/Scripts/hermes.exe
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
pnpm check:architecture
pnpm verify:upstream
```

隔离验证脚本从上述固定提交下载插件 CLI 源码到忽略的 `.build` 临时目录，调用生产 Rust 清理函数和相同的内嵌桥接器。服务端使用测试构造的 HTTP/进程替身；插件的 CLI、归属校验、遗失记录找回和停止进程树代码均为真实固定源码。覆盖默认与命名 Profile、切换提供方、活动 Profile 不串用、外部服务保留、缺失命令保留待处理以及命令超时回收。

Windows 上的该验证不等于完整 OpenViking 模型服务、原生托盘操作或安装包验收。macOS 使用共享流程和现有受管进程组，尚须在原生环境验证 CLI 及退出行为。
