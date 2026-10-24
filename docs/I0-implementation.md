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
12. `session.create` 结果改为保留运行时与持久化 ID；后端连接断开后可在开发态 UI 手动重连并用持久化 ID 恢复。脚本在假模型流式输出中断开首条 WS，第二条 WS 通过 `session.resume` 重附着同一运行时会话，并核对 `session.events.since` 水位与 `gateway.ready` 进程纪元。另用慢速流式假模型在中途调用 `session.interrupt`，收到 `interrupted` 与最终 `message.complete`。这些是协议级测试，窗口操作与重放渲染仍未验收。
13. 上游 `pm bundle` 在 `.build/payload-win32-x64-i0` 生成 Windows x64 完整 payload，包含 manifest、自带 Python 3.14.9、PM runtime、工具仓库、venv、uv 缓存及三个启动器。总计 6,181,600,280 字节、117,396 个文件。`scripts/verify-payload.py` 校验发行仓库快照的 6,922 个条目与固定提交一致；上游工作树仍干净。
14. 用 payload 的 `bin/hermes.exe` 在独立数据根、禁用按需安装和不可达公共代理下运行完整假模型冒烟，鉴权、聊天、工具、审批、澄清、中断和重附着均通过。此测试不能替代物理断网；默认 bundle 过大，不是首版核心包。封装决策与构建入口限制见 `docs/ADR-0001-runtime-and-process.md`。
15. 为避免后续 bundle 构建入口借用机器现有 Hermes PM 状态，增加产品级 `scripts/build-payload.py`；在产品 `.build/pm-bootstrap` 私有目录执行 `pm status`，该目录实际生成工具与 PM 状态。尚未通过此新入口重复全量 bundle。
16. 将完整 payload 冒烟的数据根改为产品 `.build` 下含“中文 空格”的临时路径，鉴权、流式对话、工具、审批、澄清、运行中断和重附着再次通过。这验证了当前 Windows 数据根路径，不等于 payload 安装路径迁移验收。
17. 用产品外置脚本调用上游 PM/assembler，只暂存 Python、uv 与基础 venv，生成 1,536,868,250 字节、55,760 文件的 Windows 核心候选包；发行源码 6,922 条目与锁定 SHA 匹配。在中文空格数据根、禁用按需安装与不可达公共代理下，核心包通过同一套假模型冒烟。首次尝试纯离线构建发现全量包缓存缺 `ruamel-yaml`、`wheel` 轮文件，构建阶段随后补齐。
18. `scripts/verify-offline-rebuild.py` 从核心候选包内的 uv 缓存、Python 与固定源码，离线重建独立 PM runtime 和基础应用 venv；按上游 assembler 的 `.pth` 规则绑定源码后，`hermes_cli` 与 `tui_gateway` 导入成功。该证据覆盖依赖重建，不覆盖正式产品的原子修复与失败回滚。
19. 将 1.54 GB 核心候选包复制到产品 `.build/中文 空格 安装/payload`，从新路径执行源码校验及完整假模型冒烟；发行源码、鉴权、聊天、工具、审批、澄清、中断和重附着均通过。该实验验证了 Windows 核心包复制后的中文空格安装路径，不代表 NSIS 安装和升级已验收。
20. Rust 在产品数据根持有 OS 文件锁，第二个进程对同一根的获取失败，释放后可重新获取；`cargo test storage_lock_` 使用独立测试进程验证该边界。`scripts/verify-coexistence.py` 并行运行固定上游源码 CLI 与产品核心包：两套数据根、凭据和会话列表隔离，停止产品后来源 CLI 仍可 ping。来源 CLI 是隔离测试实例，未直接操作用户现有官方安装。
21. 开发态 UI 的手动重连现在记录每个会话收到的 `seq` 与 `gateway.ready` 进程纪元；重附着后调用 `session.events.since`，按序补回遗漏事件，并去重重连期间缓冲的实时事件。纪元变化或事件窗口截断时回退到 `session.resume` 快照；续传响应里的待处理审批与澄清请求也重新注册到 Rust 代理。固定核心包的假模型冒烟、`pnpm build` 与 `cargo check` 通过。该机制仍未在原生窗口中操作验收，截断回退时并发快照与事件的展示一致性还需专项验证。
22. 为 Windows 离线候选包增加 release 启动路径：Tauri 资源中的归档和校验清单经大小、SHA-256、上游提交与 payload 清单校验后，解包到主要存储位置的产品运行时目录，再从那里启动后端。运行时准备持有独立 OS 文件锁，并在暂存目录校验后重命名启用。真实核心包归档包含 55,764 个普通文件，归档大小 1,590,661,120 字节；首次解包测试通过，解包后的启动器再次通过完整假模型网关冒烟。直接把 55,760 余个文件作为 NSIS 资源时因 Windows 深路径失败，因此改为单归档资源；NSIS 候选包已构建成功，大小 352,547,605 字节，SHA-256 为 `11148EFFAD6065DD8193621F260451343AB999774F014A28A95D7B04389BA629`。
23. 在当前 Windows 用户会话把该 NSIS 候选包静默安装到产品 `.build/安装 测试`：退出码 0，程序、归档及收据均落在该中文空格安装路径；安装后归档大小仍为 1,590,661,120 字节，SHA-256 与收据一致，HKCU 卸载登记指向测试安装目录。静默卸载退出码 0，程序、归档和 HKCU 登记均被移除。该实验覆盖当前机器的安装和卸载落盘，不等于干净机器、安装向导、自选位置 UI、签名或原生窗口聊天验收。

## 尚未完成

- 上游全量与产品核心候选 payload 已组装和校验，核心依赖离线重建通过；Windows 离线归档与首次解包已验证。仍需可选工具按需分层、完整产品修复、独立构建入口全量验证、来源摘要记录及物理断网验收。
- 正式产品的数据根选择、私有发现、完整身份鉴权、跨重启进程归属与退出验收。开发态已加入跨进程存储锁，仍需实际多窗口与用户现有官方安装共存验收。
- 断线自动重连；事件重放已经接入开发态 UI 并通过协议冒烟与编译，原生窗口渲染和截断并发场景尚未验收。运行中断、历史恢复、审批、澄清已有脚本级闭环。
- 本机解释器复用后的隔离依赖环境、托管兜底下载、离线导入。
- 正式的自选安装/存储位置 UI 与升级事务；中文空格安装和数据路径已在脚本级验证。
- macOS/Linux 的构建、签名、安装与实机验收。

## 构建环境结论

原有 Rust stable 与 1.95.0 安装的标准库异常，依赖编译提示缺少 `core` 或只有 metadata stub。另装 1.94.0 MSVC 后可正常编译；项目以 `rust-toolchain.toml` 固定该构建工具链。原有工具链未被覆盖。

## 上游接口事实

- `hermes serve --host 127.0.0.1 --port 0 --isolated` 已在 Windows 的隔离 venv 与上游完整 payload 中验证；其他平台和正式生命周期仍待验收。
- `HERMES_DESKTOP_READY_FILE` 当前只发布端口，不能单凭端口证明身份。
- 该固定提交的专用 `serve` 没有 canonical gateway 的私有控制端点；其 loopback WebSocket 接受每次启动的 `HERMES_DASHBOARD_SESSION_TOKEN`。I0 已验证该路径的 `ping`，没有声称原生票据已通过。正式连接仍需进程身份、端点与鉴权的完整共存测试。
- `HERMES_DESKTOP=1` 单独不构成归属证明；固定提交还检查每次启动的 `HERMES_DASHBOARD_SESSION_TOKEN` 或 SSH 启动身份。
- 因此本样机没有在未实现完整鉴权与归属前擅自启动后端。
