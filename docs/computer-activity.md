# 电脑操作提示与停止接管

适用开发版本：`v0.1.10`。提示条、Gateway 观察和 Codex 产品工具由客户端实现，不修改锁定 Hermes fork。当前验证平台为 Windows x64；状态、协议验证与实际鼠标键盘验收分别记录。

## 用户行为

提示条采用紧凑布局：正常状态为 440 × 48 逻辑像素，异常说明出现时原生窗口增高至 72，保留完整正文与停止按钮。窗口尺寸由系统按显示器缩放比例换算。

紧凑样式调整验证（2026-11-08）：浏览器渲染预览、前端类型检查、生产构建、Rust 编译及本次窗口文件格式检查通过。工作区全量 Rust 测试为 290 通过、1 失败、53 忽略，失败项为 `permission_form_runtime_fixtures_use_production_save`；全量格式检查仍报告其他编程设置文件的差异。本次尺寸调整未重跑 Windows 原生窗口与 macOS 实机验收。

电脑操作期间显示独立的置顶窗口，正文固定为 `hermess  agent desktop 正在操作电脑`，提供「停止并接管」按钮。窗口不抢焦点、不随聊天页面切换销毁，工具调用间的思考阶段继续保留。停止快捷键为 Windows `Ctrl+Shift+F12`、macOS `Command+Shift+F12`；注册失败显示说明，仍可使用按钮，快捷输入设置不能占用这一组合。

停止请求只针对已登记的电脑操作任务。多个任务共用提示窗口，全部确认结束后才隐藏；一个任务先结束不会隐藏其他任务。停止期间新观察到的电脑任务也会收到停止请求。连接丢失、工具缺少终态、停止请求失败或清理失败时保留「尚未确认停止」提示，不把 RPC 接受或超时当作已经停止。

提示由执行事件驱动，有事件传递和窗口显示延迟，不是鼠标键盘锁，也不保证窗口已显示后才允许第一条输入。

## 实现边界

- `src-tauri/src/computer_activity.rs` 统一持有运行身份、执行编号、活动工具和停止状态。提示窗只获取聚合状态；状态读取和停止命令校验调用窗口身份。
- `src-tauri/src/computer_activity/window.rs` 负责窗口、光标所在显示器的位置和全局快捷键。Windows 使用 `SWP_NOACTIVATE` 显示及原生隐藏接口，避免后续 `show()` 激活窗口；原生测试按系统前台窗口句柄核验。React View 位于 `apps/frontend/src/features/desktop/`，经 `ComputerActivityApi` 注入宿主。
- Gateway 在原生 WebSocket 接收处、截断展示载荷前观察 `computer_use`。仅接入本产品本地 Gateway 的已订阅会话，且 Profile 的 `computer_use.backend` 必须为锁定实现默认的 `cua`；远程连接和其他 provider 不被猜测成本机操作。命令、文件修改和搜索不触发提示。
- Gateway 停止携带观察到的 Profile、会话和 `execution_generation`，不会在过期后自动改停下一轮。单次 `tool.complete` 不释放整轮；轮次终态与已登记工具结束共同释放状态。恢复连接迁移原记录和停止句柄。未订阅的消息渠道会话、任意 Shell 自动化和未登记插件不在覆盖范围内。
- Codex 通过 App Server 的 `dynamicTools` 注册 `hermess_computer_use`，在 `item/tool/call` 中检查线程、当前轮次、名称和调用标识。worker 直接复用锁定 Hermes 的 Schema 与电脑工具实现，转换文字及图片返回值；没有启用外部 MCP 或官方桌面插件，也不读取个人 Codex 配置。协议依据见 [App Server 动态工具](https://learn.chatgpt.com/docs/app-server)。
- Codex 每次电脑调用单独审批，提供允许一次、拒绝并继续、拒绝并停止。编程的完全访问权限不会跳过这项审批。审批通过后才上报操作开始；参数无效或拒绝不会执行原生动作。驱动只从 Rust 提供的产品工具目录和打包工具目录由 PM 按锁定版本选择，不从个人 PATH 查找。
- Codex 停止复用已登记 worker 的控制通道及共享进程管理器，清理整个 worker、App Server 和原生驱动进程树后释放提示。Windows worker 以 zlib/base64 编码源码参数启动，避免新增功能使 `CreateProcess` 命令行超过 32,767 UTF-16 字符；不写入可修改的临时执行脚本。
- 日志记录提示生命周期、停止结果及非敏感的电脑工具结果码，不记录输入文字、截图、审批正文或凭据。

## 驱动与平台

Windows 需要已准备好的 Hermes Python `computer-use` 依赖与 PM 锁定的 `cua-driver`。Windows 全新产品数据目录的首次运行时准备包含 `all` 依赖；缺失驱动沿用设置中的工具安装入口。缺少 Python 组件时返回明确错误，不把本机开发测试用的依赖目录写入生产配置。

macOS 提示窗口使用所有工作空间可见设置，仍需原生核验全屏 Space、显示器与快捷键。锁定 `CuaDriver.app` 经 LaunchServices 独立启动，不受当前 worker 进程组完整覆盖；因此新增的 Codex 原生电脑工具在 macOS 明确返回尚未启用。完成共享进程管理器的独立驱动生命周期适配前，不开放这一入口。Gateway 原有 macOS 能力不扩展，强制停止 Gateway 进程组也不作为其电脑输入已停止的证明。此范围未交付双端电脑控制，不把 Windows 验证写成 macOS 通过。

## 验证

Windows 的测试使用隔离数据目录、合成 Responses 服务与测试凭据，不连接用户真实模型、个人 Codex 或其他 Hermes 实例。

锁定基线为 Hermes fork `882037eb8745b505db438217513c4c94f95c93c1`、Codex `rust-v0.167.0` 和 PM `cua-driver 0.21.0`。开发测试解释器需具备锁定的 `computer-use` 依赖；Windows 的 pywin32 必须完成正常 site/.pth 初始化，仅把其目录加入 `PYTHONPATH` 不能替代安装。本轮隔离工具安装使用 `computer_activity_codex_protocol.py --prepare-native`，真实协议测试使用 `--native --embedded`，覆盖压缩源码启动和与生产一致的受限环境。

- Rust 状态测试覆盖工具间隙、未完成输入、重复开始、旧执行的完成事件和多任务聚合；Gateway 测试核对停止参数与过期拒绝。
- `computer_activity_gateway_receiver.py` 由 Rust 生产停止请求驱动，调用锁定 Gateway dispatcher，核验接受中断、过期编号及错误 Profile 拒绝，以及工具与轮次终态事件；Agent 是可控替身，不代表真实桌面动作验收。
- `computer_activity_codex_protocol.py` 使用真实锁定 App Server 与产品 worker，验证动态工具注册、新建与恢复、独立审批、拒绝与取消。`--native` 仅执行真实驱动的 `list_apps`，不点击、输入或截取用户屏幕；其余审批测试使用可控后端。
- Windows 原生窗口测试加载生产前端，通过真实 IPC 点击停止按钮，核验固定文案、不抢焦点、同时停止多个任务及全部结束后隐藏。
- `shared_takeover_stops_real_codex_worker_and_driver_tree` 使用生产 Rust worker、真实 App Server 和驱动执行无输入的等待，验证共享接管能打断任务并回收其进程树。

本版本尚未验收：macOS 原生窗口与电脑工具、Linux、安装包升级、真实模型的连续截图/点击/输入、多显示器实机切换、真实全局按键、Gateway 渠道触发的未订阅会话。逐次执行结果以路线图记录为准。

原生测试先在另一个终端运行生产预览 `pnpm --dir apps/desktop exec vite preview --host 127.0.0.1 --port 1438 --strictPort`，再执行：

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked computer_activity -- --include-ignored --test-threads=1
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked shared_takeover_stops_real -- --ignored --test-threads=1
```

Windows 本轮已通过上述原生/接收端专项、真实驱动停止专项、Python 11 项，以及前端和 Rust 的仓库规定检查；全量 Rust 290 项通过、52 项按环境要求忽略，专项显式执行的结果不与默认忽略混淆。没有制作安装包、提交、PR 或发布 tag。
