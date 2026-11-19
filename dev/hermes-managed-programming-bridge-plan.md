# Hermes 调用产品编程能力并停用自带 Codex 运行链方案

日期：2026-11-18。状态：方案草案，尚未实施或验收。约束：不修改锁定 Hermes fork；产品内停用 Hermes 自己的 Codex 启动链，普通聊天需要编程时调用产品已集成的能力。现有编程模式的实现与验证记录见 [编程接入方案](codex-app-server-integration-plan.md) 和 [实施记录](codex-programming-implementation.md)。

## 1. 目标与成功行为

用户在 Hermes 普通聊天中提出编程任务时，Hermes 可以调用 Hermess 桌面客户端管理的编程能力。产品现有的项目、模型连接、权限、审批、Codex 运行包、会话及进程管理继续作为唯一执行入口。编程进度和结果回到普通聊天；用户也能打开对应的编程会话查看完整记录并处理审批。

一次成功操作应当可观察到：

1. Hermes 的工具目录中出现产品编程工具；未安装编程运行时或未配置模型时，工具给出明确的不可用原因。
2. 用户指定项目后，Hermes 发起编程任务，产品创建或恢复编程会话，并返回稳定的会话标识和任务状态。
3. 编程任务由产品当前的 `CodingState`、`coding_worker` 和共享进程管理器运行。模型、密钥、权限和项目目录来自产品编程配置；不从 Hermes Profile、个人 Codex 或 PATH 推断。
4. Hermes 可查询任务进展与最终结果；用户可在编程页面看到相同会话、工具活动、审批请求和终止状态。
5. 取消、审批拒绝、超时、Gateway 断开和桌面退出均有确定结果，不会把仍在执行的任务报告为已完成。

普通聊天与编程会话保留各自的历史。桥接记录二者的关联，不复制完整聊天历史到 Codex 线程，也不把 Codex 线程改成 Hermes 的会话数据库。

## 2. 已核实的现状与边界

- 当前锁文件 `runtime/upstream.lock.json` 指向 fork `FirewineXie/hermes-agent` 的 `hermess-desktop` 分支，提交 `de89d9331122e67f16f01ce5784cd9721a3aa131`，官方基线 `v0.23.0`。实施前须运行仓库的锁定源码核对流程。
- 普通聊天由 `apps/desktop/src-tauri/src/runtime/chat.rs` 向 Gateway 的 `prompt.submit` 发送请求。产品编程请求由 `apps/desktop/src-tauri/src/runtime/coding.rs` 的 `coding_session_request` 接收，发送时通过 `coding_worker` 启动受管 Worker。
- 锁定 Hermes 的 `/codex-runtime` 使用 `model.codex_bin`，缺省为 PATH 中的 `codex`；其 `agent/codex_runtime.py` 自行创建 `CodexAppServerSession`。这是独立于产品编程会话的运行链。
- 产品 Worker 使用产品传入的 `executable`、独立 `CODEX_HOME`、连接和线程标识。底层仍启动产品锁定版本的 `codex app-server`。本方案所说的“不调用 CLI”，指 Hermes 不自行寻找、配置或启动 Codex 运行链，不是否定产品受管 App Server 需要运行 Codex 可执行文件。
- 锁定 Hermes 的 `model_tools.py` 会把当前 `session_id` 作为分发参数交给普通插件工具；`tools/registry.py` 按 handler 签名转发该参数。产品已有 `powershell_tool.rs` 将自有插件部署到产品 Hermes Home 和各 Profile，证明客户端可以使用此扩展点而不改 fork。通用 MCP 工具调用不自动携带该 `session_id`，故不作为本方案的主入口。

本方案不修改锁定 Hermes fork。客户端负责工具桥接、运行配置约束和旧入口拦截。若验证发现客户端无法封闭 Hermes 自带运行链，必须如实记录缺口，不能把界面隐藏或路径缺失称为已禁用。

## 3. 建议架构

```text
Hermes 普通聊天 / Gateway
  └─ 产品部署的 Hermes 插件工具（接收 Gateway 分发的 session_id）
       └─ 仅本机、仅产品实例可访问的桥接服务
            └─ 桌面端 Coding Service（复用现有 CodingState 与请求实现）
                 └─ 受管 Programming Worker
                      └─ 产品锁定的 Codex App Server
```

桥接服务由桌面运行时持有，绑定本机回环地址，使用每次启动生成的能力令牌；不向局域网开放。产品将插件文件部署到自有 Hermes Home 与 Profile，并在受管配置中启用；插件从 Hermes 分发参数取得 `session_id`，从当前 Profile 的运行时作用域取得 Profile 身份，而不是要求模型填写这些字段。桥接服务不接受来自模型的可执行文件路径、API Key、任意 HOME、权限升级值或任意端点地址。它只引用产品已有的项目 ID、模型身份和权限配置。连接启动、配置修订、停止与退出均记录操作 ID 和结果，不记录令牌或任务正文。

插件只负责工具 Schema、可信身份读取及本机请求；桥接服务负责认证和 DTO 转换；编程会话的创建、发送、读取、停止和审批继续由现有服务处理。实施时应将 `coding_session_request` 中可复用的业务操作抽到同一内部服务，由 Tauri 命令和桥接服务调用，避免一个入口借用另一个入口的 UI 参数或复制 Worker 启动代码。

建议最小工具集合：

| 工具 | 输入 | 返回 | 约束 |
| --- | --- | --- | --- |
| `programming_start` | 项目 ID、任务文字、可选已关联编程会话 ID | 会话 ID、操作 ID、当前状态 | 仅已登记项目；创建或恢复的目标必须与项目归属相符；重复请求须幂等 |
| `programming_status` | 会话 ID、操作 ID | 运行状态、有限长度的进度摘要、审批待处理标志、最终结果 | 仅查询该桥接来源可访问的关联任务；不回传密钥和完整工具输出 |
| `programming_stop` | 会话 ID、操作 ID | 停止请求结果、最终状态或仍在收尾的状态 | 只停止产品登记的目标任务；不按进程名称查杀 |

首版审批由编程页面处理。工具返回“等待用户审批”及会话入口提示，Hermes 不替用户选择审批选项；审批完成后可继续查询。若要求直接在普通聊天里审批，须另行核对 Gateway 的交互请求与 Codex 审批选项映射，不能用简单的布尔同意代替。

## 4. 会话关联与上下文

产品持久化桥接关联：来源 Profile、普通聊天会话 ID、编程项目 ID、编程会话 ID、最近操作 ID 和状态。关联不等于共享完整上下文。Hermes 发给编程工具的任务文字应是明确的执行指令；首轮可包含用户确认的必要背景摘要，不能悄悄把整个普通聊天或隐藏凭据送入编程模型。后续调用复用已关联的编程会话，Codex 自己维护其线程上下文。

代码核查结论（2026-11-18）：桌面端 `chat_create.rs` 和 `chat.rs` 持有 Profile 与普通聊天 `session_id`，`prompt.submit` 携带该 `session_id`。锁定 Hermes 的 `agent/agent_runtime_helpers.py` 与 `model_tools.py` 将当前 agent 的 `session_id` 传入 `registry.dispatch`，`tools/registry.py` 再按插件 handler 签名转发。因此产品插件可写 `handler(args, session_id=...)`，无需模型提供或猜测会话 ID。`agent/relay_runtime.py` 的 `current_profile_key()` 从当前 Hermes Home 的作用域解析 Profile 身份；实现时须验证它与桌面 Profile 的映射，不能只信任模型参数。桥接服务以 `(产品实例, Profile, 普通聊天 session_id)` 为持久化关联键，并通过本机认证区分产品实例。

通用 MCP 路径仍不适合这里：`tools/mcp_tool_handlers.py` 发出 `session.call_tool(tool_name, arguments=args)`，未自动带当前聊天 ID；服务器配置级 headers 也不能区分同 Profile 的聊天。Gateway 另有会话级 `editor_mcp`，但 `gateway/session_local_editor.py` 明确只允许 ACP 来源，当前普通聊天不能直接复用。

同一探针还须查明插件 handler 能否收到稳定的 `tool_call_id` 或 `turn_id`；已见到 `model_tools.py` 在内部构造这些 ID，但普通插件 handler 当前只收到 `task_id`、`session_id` 和 `user_task`，因此不能未经验证就把工具调用 ID 当作现成幂等键。若无稳定 ID，产品需在受理前建立可恢复的提交记录，并对不确定结果返回“请先查状态”，避免自动重放编程任务。普通聊天能否在任务运行中主动收到进度，也取决于 Gateway 工具结果与事件机制；若只能按需调用工具，界面应将进度显示在关联的编程会话中，不能宣称普通聊天实时推送。

项目选择也必须确定：优先使用普通聊天已选择的工作区与产品项目登记的唯一匹配；有多个匹配、无工作区或目录未登记时，请用户选择项目。模型不能凭文本输入构造任意绝对路径作为编程项目。普通聊天中的模型与编程模型允许不同，界面明确显示实际使用的编程模型。

## 5. 状态、失败和生命周期

- `programming_start` 只表示请求已受理，不表示 Codex 完成。长任务由 `programming_status` 查询；最终状态取产品会话的 `completed`、`failed` 或 `stopped`，不从插件连接是否正常推断。
- 重复调用必须靠操作 ID 幂等，防止 Gateway 重试导致同一任务执行两次。同一编程会话运行中再次发起不兼容任务时返回冲突，不隐式覆盖。
- 桥接断线后依持久化关联恢复查询；Gateway 断开不自动杀掉已受理任务。用户显式停止时调用现有 `Stop` 路径并等待确认。桌面退出遵守共享进程管理器的关闭顺序。
- 编程运行时未安装、模型失效、项目目录改变、认证失败、沙箱不可用、审批超时和线程恢复失败，都返回可区分的错误状态与重试建议。失败不得悄悄改由 Hermes 的 Codex 运行时或系统 PATH 执行。
- 产品普通聊天的 `/codex-runtime` 入口改为返回“请使用集成编程能力”，不再转发 `slash.exec`。前端命令目录不再将它列为可用；`submit_chat_prompt` 对直接提交的同名斜杠命令也须拒绝，不能只拦一条 UI 路径。别名和大小写处理以锁定 Gateway 的真实解析结果为准。

### 5.1 停用 Hermes 自带 Codex 启动链

禁用目标是产品自有 Hermes Gateway 的 `codex_app_server` 运行模式及其 `model.codex_bin` 启动路径，不是禁用产品编程 Worker 内受管的 `codex app-server`。按下列顺序实施和验证：

1. 启动 Gateway 前逐个检查产品自有 Profile 的有效模型配置。若 `model.openai_runtime` 已是 `codex_app_server`，不得带着它启动；使用带修订校验的配置迁移回 `auto`，保存原值和操作结果，并提示旧会话可能需要重建或重新选择模型。不能静默把旧 Codex 线程当作普通聊天线程恢复。
2. 所有产品提供的配置写入入口拒绝再次写入 `model.openai_runtime=codex_app_server`，包括图形化配置编辑、导入、Profile 创建与 Gateway 配置操作。不能删除用户其他模型或 MCP 设置。保存后复读有效配置；失败则不启动或不继续受影响的 Gateway。
3. 桌面普通聊天的命令执行和消息提交两条路径拦截 `/codex-runtime` 及已确认的等价入口；`commands.catalog` 的界面展示同步移除。旧会话和重启路径重新检查有效配置，不能依赖一次性 UI 状态。
4. 核对 Gateway 是否可能在运行中通过其他入口（例如远端 RPC、Dashboard、插件或配置文件变更）重新启用该模式。若存在，客户端须在请求边界或运行时配置审计处拒绝并使受影响 Gateway 停止接受新轮次；仅定时回写配置存在竞态，不能算硬性禁用。
5. 对产品启动的 Gateway 做进程与配置验证：Hermes 普通聊天触发编程任务时，新增的 Codex 进程只能归属产品 `coding_worker` 登记的进程树；产品关闭后这些进程全部回收。验证不能只根据 PATH 中没有 `codex` 推断。

不修改 fork 的前提下，客户端无法约束用户直接运行另一份 Hermes、任意第三方插件自行启动程序，或具备同一用户权限的外部进程修改文件。本方案的禁用承诺仅覆盖产品自有 Gateway 和产品暴露的普通聊天入口。第 4 步若无法做到请求前阻断，则“完全禁掉 Hermes 自带调用”在该约束下不可验收，必须先报告实际剩余入口。

## 6. 实施顺序与验收门槛

1. 用锁定 Gateway 做产品插件探针：证明插件工具发现、真实聊天 `session_id` 与 Profile 作用域、工具调用 ID、超时和取消行为；检查受管 Profile 插件启用不覆盖用户现有设置。
2. 抽取产品 Coding Service 的内部调用入口，保留现有前端、Tauri 契约和编程页面行为；增加桥接关联存储、幂等与权限校验。
3. 实现本机桥接服务及 Profile 受管插件部署、更新、禁用和退出清理；确保只由产品实例访问，令牌轮换时旧连接失效。
4. 接通任务发起、状态、停止及用户审批提示；普通聊天显示关联编程会话的入口和最终结果。处理空态、重复发送、失败、重试、切换聊天和重启恢复。
5. 验证 `/codex-runtime` 和配置写入均被产品边界拒绝，旧配置迁移及旧会话有明确结果；确认普通 Hermes 聊天和独立编程页面没有回归。

验收必须包含真实锁定 Gateway 的插件工具请求与接受/拒绝响应，证明两个同 Profile 普通聊天分别关联不同编程会话，重启后仍可续接；覆盖真实产品 Worker 和锁定 Codex App Server 的执行、项目及模型来源校验、重复请求、审批等待、停止与退出进程树回收。还须覆盖 `/codex-runtime` 命令、直接消息提交、配置导入/编辑、已有 `codex_app_server` Profile、旧会话恢复以及 Gateway 运行中配置变化，确认不会由 Hermes 独立启动 Codex。Windows 与 macOS 分别验证原生窗口和平台专属路径/进程行为；一端的构建或模拟服务结果不能作为双端验收。记录实际命令、环境、结果及未验收范围。

本文件是方案草案。协议探针通过并确认会话关联策略后，才能定实施范围和版本；仅整理此文档不更新 `ROADMAP.md`。
