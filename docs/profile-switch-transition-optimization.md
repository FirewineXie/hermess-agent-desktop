# Profile 全功能隔离与集中管理方案

状态：实施中。依据 2026-10-26 的 `feature/v0.1.6` 工作树和锁定 Hermes fork `882037eb8745b505db438217513c4c94f95c93c1` 制定；工作树含未提交改动。共享作用域类型、Rust Profile 解析入口、聊天、模型、配置、个人文件、扩展、渠道、统计等调用及前端按 Profile 保存界面状态已迁移。原生窗口已验证 A → B → A 切换后 Gateway 进程不变，已访问页面的 Profile 数据立即恢复；全功能并发验收尚未完成。客户端工具页只管理共享工具，Profile 管理页只读展示各自工具集配置；已有会话的实际工具清单仍受锁定 fork 协议限制，当前产品未接入，见第 8 节。

## 1. 目标与结论

一个 Gateway 可以同时服务多个 Profile。桌面端应把 Profile 当作每项操作的明确归属，而不是全应用唯一的“当前运行模式”。用户浏览 Profile、切换会话或打开另一 Profile 的设置时，不应重启 Gateway、重置整个前端，也不应要求先改写 `selected_profile`。

建立统一的 **ProfileScope 模块**：所有功能通过它取得经过校验、固定于请求开始时的作用域；所有前端功能按同一个作用域键保存和失效数据；新增功能必须声明作用域并通过检查。ProfileScope 负责身份、归属、路由、生命周期和防串档规则；聊天、模型、MCP 等业务仍在各自功能模块实现。这样既能集中管理，也不会把所有业务代码堆进一个文件。

“所有功能支持 Profile 拆分”不等于把应用更新、窗口按钮或随包二进制复制一份给每个 Profile。**每个入口都必须显式声明其作用域**：Profile、会话、Gateway/主机，或本机工作区。Profile 和会话数据必须隔离；共享资源必须明确标为共享，并在界面上说明其影响范围。禁止未声明作用域或隐式使用全局所选 Profile。

## 2. 实施前根因与已确认的能力

- 锁定 fork 的 `gateway/session_controls.py` 在收到 `params.profile` 时会路由到被服务的对应 Profile；`ProfiledGateway` 已给部分 Gateway 方法加 `profile`。锁定 fork 的测试覆盖了按 Profile 读取 `model.options`。单 Gateway 多 Profile 的基础存在。
- 桌面客户端的 `BackendState.gateway()` 仍从 `selected_profile` 捕获请求归属。当前契约只有 `chat.listSessions(profile?)` 明确传 Profile；大多数聊天、模型、配置和扩展接口没有。前端切换时调用 `profiles.select`，再执行 `resetChat`、`resetModel`、列表重读，形成可见的“reload”。
- Rust 中聊天、模型、配置、扩展、渠道、人格、个人文件、工具、使用统计及浏览器桥接均有全局选中 Profile 的依赖或需要明确归属。`extension_request(operation, payload)` 还把多种操作藏在一个字符串入口内，不能只改表层组件。
- 锁定 fork 和路线图只证明了隔离环境中双 Profile 热加载、建会话、列会话与部分配置隔离的冒烟。原生窗口、真实模型并发及全功能隔离仍需验证。

## 3. 一个统一模块，贯穿三层

### 3.1 统一契约：Scope 描述符

在 `packages/contracts` 定义唯一规范，供前端和桌面 adapter 使用；Rust 保持对应的受检类型。建议使用判别联合，而不是可选 `profile?: string` 到处传播：

```ts
type OperationScope =
  | { kind: 'profile'; profile: ProfileName }
  | { kind: 'session'; profile: ProfileName; sessionId: string }
  | { kind: 'gateway' }
  | { kind: 'workspace'; path: string; owner?: { profile: ProfileName; sessionId: string } }
```

`ProfileName` 在桌面端校验格式、存在性与是否正在被 Gateway 服务。`session` 作用域同时携带 Profile 和 session ID，不能凭 session ID 推测归属。`gateway` 只用于真正全局的运行时、更新和设备级资源。`workspace` 是本机目录，若由会话打开，必须绑定会话身份；不能因为切换 UI Profile 就把已有终端或文件操作挪到另一会话。

接口方法必须写清作用域，例如 `chat.createSession(scope: ProfileScope, ...)`、`chat.submitPrompt(scope: SessionScope, ...)`、`models.options(scope: ProfileScope, ...)`。对于产品共享资源，方法声明 `GatewayScope` 或明确无作用域的受控白名单。禁止“未传 Profile 时自动使用 default/当前选中”。兼容旧接口时只在一处适配，并列出删除期限。

### 3.2 桌面端唯一入口：ProfileScopeResolver

在 `apps/desktop/src-tauri/src/runtime/profile_scope/` 实现作用域解析器，作为所有 Profile/会话操作进入 Gateway、HTTP、文件和子进程前的共同入口：

1. 验证 Profile 名、归属、是否被本产品 Gateway 服务，拒绝未知或未启用 Profile；不得改走 default。
2. 在请求开始时生成不可变的 `ResolvedProfileScope`，内含固定 Profile 名、Gateway 句柄、Profile home、HTTP 鉴权目标、当前 Gateway 纪元。随后异步等待期间不再读取可变的 `selected_profile`。
3. 提供统一的 `gateway_for(scope)`、`http_for(scope)`、`home_for(scope)` 与会话归属校验。各业务模块调用这些能力，仍由各自模块决定方法、参数和返回值。只有已核实 Gateway 方法支持 `profile` 时才附加该字段；HTTP 路径使用现有 Profile 专属授权与路由；本地文件和子进程只使用解析出的 Profile home。
4. 对会话建立 `(profile, sessionId)` 归属记录或从 Gateway 返回的权威信息核实；发送、停止、恢复、补发、附件和审批不得仅凭当前 UI 选择定位。未知归属失败关闭，并给出可恢复错误。
5. `profiles.list`、Gateway 状态和所服务 Profile 集合作为拓扑输入；Profile 创建、热加载、停服、重连、纪元变化时更新解析器的拓扑。仅在这些边界验证或失效，不在每次点击时重新列出全部 Profile。

实现可拆成 `scope.rs`、`gateway.rs`、`http.rs`、`session.rs` 等小文件，统一通过 `ProfileScopeResolver` 公共入口使用；遵守仓库单个非生成代码文件不超过 1000 行的规则。`runtime/mod.rs` 仍持有进程和 Gateway 生命周期，解析器不创建第二个所有者，也不扫描或接管用户已有 Hermes。

### 3.3 前端统一入口：ProfileWorkspace

在 `apps/frontend/src/app/profile-scope/` 建立一个上下文模块，管理 `viewedProfile`、Profile 拓扑、作用域键、缓存失效和事件分发。界面切换仅修改 `viewedProfile`；不会调用 `profiles.select`、`resetChat`、`resetModel` 或整页 remount。

- Profile 数据键：`(gatewayEpoch, profile, resource)`；会话数据键：`(gatewayEpoch, profile, sessionId, resource)`。加载结果携带发起时的作用域和请求版本，过期结果不能覆盖另一 Profile。
- 各功能控制器继续拥有自己的数据与操作；统一模块提供作用域上下文、缓存键、失效事件和订阅机制。不要把聊天消息、模型表单、MCP 逻辑全部塞进 ProfileWorkspace。
- A → B → A 时立即展示 A 已有数据。首次打开 B 时只给缺数据的区域显示加载态。写入成功、后台事件或重连后按作用域定向刷新；“无需 reload”指不做切换触发的全量清空，并不意味着永远不读取新数据。
- 会话运行事件按固定会话归属写回对应 Profile，即便用户正在看另一个 Profile。审批/澄清请求及取消事件须核实归属；当前转发事件没有统一 Profile 字段，应在桌面端补充经验证的归属或维护可靠映射。不能把归属不明的事件直接写给当前页面。

前端只从 `DesktopApi` 获取宿主能力，ProfileWorkspace 不直接导入 Tauri 或 Rust。`profiles.select` 保留为“下次启动默认查看的 Profile”偏好兼容入口；正常浏览和发消息不调用它。

## 4. 全功能作用域清单

下表是迁移覆盖范围，也是新增功能填写的模板。实施前须逐命令补齐“当前 Rust 命令 / Gateway 或 HTTP 方法 / 显式 Profile 支持 / 测试”矩阵；不能仅凭本表推断所有上游方法都已支持。

| 功能 | 目标作用域 | 必须处理的行为 |
| --- | --- | --- |
| Profile 管理、人格与预设 | Profile；列表与创建是 Gateway 拓扑 | 浏览、应用人格、创建、启用、启动偏好分开；创建后只刷新目标 Profile 与拓扑 |
| 聊天与会话 | 新建为 Profile；已有为会话 | 创建、列表、恢复、发送、停止、思考强度、用量、命令、技能、附件、审批、补发全部固定到会话所属 Profile |
| 模型 | Profile；会话模型选择为会话 | 候选、凭据、默认模型、自定义端点、运行时检查及会话选择按目标归属；保留各 Profile 的界面草稿 |
| Agent 配置 | Profile | 字段、原始 YAML、辅助模型、并发版本与保存都按 Profile；写入只失效目标配置 |
| 记忆与个人文件 | Profile | 读取、保存、版本冲突按 Profile home；不同 Profile 的编辑草稿分开 |
| Skill、MCP、扩展 | 安装和启用为 Profile；公开目录搜索可为 Gateway/网络共享 | 搜索结果可复用，已安装状态、连接、启停、编辑、卸载和凭据严格按目标 Profile；拆解 `extension_request` 的操作清单 |
| 客户端工具与能力（FFmpeg 等） | 应用安装/本机设备 | 随包清单、可下载目录、安装状态、版本、本机探测与安装操作全局共享；切换 Profile 不重读为另一份数据，也不为每个 Profile 安装一次 |
| Agent 工具集与会话可用工具 | 配置属于 Profile；运行结果属于会话 | 仅当界面要展示或修改 Agent 的启用工具集时才按 Profile/会话查询；缺少可靠路由时说明无法读取，不把客户端工具页当作该配置页 |
| 渠道与扫码 | Profile；本机服务状态可为 Gateway | 状态、发起、轮询、取消固定到发起 Profile；切换页面不能让扫码结果写到另一 Profile |
| 定时任务 | Profile；聚合列表为显式多 Profile 查询 | 创建、更新、运行、暂停、恢复和执行记录都携带任务所属 Profile；聚合页不靠全局选择 |
| 使用统计 | Profile；另设明确的“全部 Profile”聚合才可跨 Profile | 当前统计接口经隐式选中 Profile 的配置请求读取，须改为显式 Profile 或服务端可信聚合 |
| 工作区、文件预览、终端、浏览器桥接 | 本机工作区；由会话发起时再绑定会话 | 文件和终端不会因为浏览 Profile 改变归属；浏览器实例、CDP 连接和清理以固定 Profile/会话为键 |
| 运行时、诊断、更新、窗口、随包资源 | Gateway/主机；日志可按 Profile 过滤 | 共享进程与安装包不复制；产品日志注明 Profile，窗口和软件更新明确为全局；各 Profile 页面均可访问但范围一致 |

凡在界面中展示为“某 Profile 的数据”的能力，都必须有真正的 Profile 归属。若底层能力当前只支持全局值，需先补路由或明确标成全局，不能用切换 `selected_profile` 冒充隔离。

### 4.1 工具页的修订边界

用户安装和管理的是**一套客户端能力**。FFmpeg、Git、Node 等随包或可下载的程序，以及本机程序探测，都属于这台设备上的 Hermess Desktop。A 安装 FFmpeg 后 B 可直接使用；A/B 切换不触发安装、卸载、重复扫描或重新下载。工具页的安装状态、版本和进度只保留一份应用级状态，缓存按安装目录/清单版本失效，而不是按 Profile 或会话 ID 建键。安装成功、卸载或更新后刷新这份全局状态，并向所有正在显示工具页的视图发布同一变化。

Agent 的“是否允许/实际会调用哪些工具”是另一件事。现有 Gateway 按 Profile 配置及会话计算工具集，MCP 和 Skill 还有各自的 Profile 配置。只有在 Agent 设置或会话详情明确展示这些信息时，才走带 Profile/会话归属的查询；页面要把“已安装在本机”和“此会话可用”标成两个不同事实，不得用安装状态推断会话权限。普通工具页以客户端能力为主，不依赖 `tools.list` / `tools.show` 才能加载 FFmpeg 等本机工具。

实施顺序：先把工具页的本机探测、随包/下载目录、安装进度和错误状态移出 ProfileWorkspace，改用应用级状态；切换 Profile 时不重新发起这些查询。Agent 工具集配置在对应 Profile 的管理页查看，其他 Agent 字段进入该 Profile 的 Agent 设置，Skill/MCP 在该 Profile 的扩展管理中查看；客户端工具页提供进入 Profile 管理的入口，不混入 Agent 工具列表。配置列表使用 Hermes 已有的 Profile 作用域 HTTP 接口，只表示当前配置；若产品以后要求“查看 B 已有会话的实际可用工具”，再单独解决 `tools.list` / `tools.show` 的命名 Profile 路由缺口。验收用 A 安装或探测 FFmpeg、切到 B 后状态立即一致、无重复安装/探测；另测 A/B 工具集配置各归其主，且不会被误显示成全局安装状态。

## 5. 新增功能的强制门槛

新增 `DesktopApi` 方法或 Tauri 命令时，必须在统一作用域登记表声明 `profile | session | gateway | workspace`，并说明读取、写入、事件和缓存失效范围。动态入口如 `extension_request(operation, payload)` 必须有逐 operation 的登记，未知 operation 拒绝；长期应改为具名、可类型检查的方法。

新增功能的验收至少包含：A/B 两个 Profile 数据不同、A/B 同时操作、切换中请求返回乱序、错误或未服务 Profile 不回退 default，以及写入 B 不改变 A。会话功能还测事件、停止、审批与补发。扩展 `pnpm check:architecture` 或独立检查脚本：扫描契约方法和 Tauri 注册命令，要求与登记表一一对应；检测新代码调用 `state.gateway()`、`selected_profile()`、`profile_home()` 等旧隐式入口，除显式白名单外失败。检查脚本是门槛，运行时仍须由 `ProfileScopeResolver` 校验，不把静态检查当安全边界。

代码评审模板增加一句：**此功能的数据和动作属于哪个作用域，跨 Profile 测试在哪里？** 若答案是“使用当前选中 Profile”，视为未完成。

## 6. 分阶段实施与兼容

1. **基线矩阵**：枚举全部契约方法、Tauri 命令和 `extension_request` 操作；按上表归类，记录锁定 fork 的实际路由方式和现有失败/降级行为。优先测发送、配置写入、扫码、浏览器和审批的跨 Profile 归属。
2. **中央解析器与契约**：先建立 Scope 类型、解析器、显式错误和登记表；保留旧接口作短期兼容，但新增功能不准走旧隐式入口。此阶段验证不重启 Gateway、不修改用户外部 Hermes。
3. **聊天全链路**：按 Profile 固定创建、恢复、发送、停止、附件、事件与审批；前端按 Profile/会话保存状态。只有此链路通过 A/B 并发回归后，才停止聊天页调用 `profiles.select`。
4. **其余 Profile 功能**：模型、配置、记忆、扩展、工具、渠道、定时任务、统计、人格和浏览器桥接分批迁移。每批同时改契约、adapter、Rust、前端状态与针对性测试，不出现“界面已切新 Profile、写接口仍用旧全局值”的中间可发布状态。
5. **清理旧全局选择**：移除普通业务对 `selected_profile` 的依赖；保留启动默认 Profile 偏好。去掉扩展页强制 `key`、全局 `resetChat/resetModel` 切换流程。更新架构检查和 `ROADMAP.md`，明确未完成能力和原生验收范围。

不计划改锁定 Hermes fork。若某项功能经实际源码和验证确认无法在客户端按 Profile 路由，应列出具体方法、缺口、替代方案和影响，再按仓库规则申请 fork 改动；不能为绕过缺口而偷偷切全局 Profile。

## 7. 完成定义与验证

- A → B → A：三个入口（Profile 行、聊天选择器、扩展目标）均不出现整页空白；A 的会话、消息、草稿、模型与扩展状态立即恢复，必要更新在各自区域后台进行。
- A、B 同时有会话和任务：发送、停止、审批、补发、浏览器与终端操作保持原归属；切换查看不重启 Gateway，不打断另一 Profile。
- B 的模型、人格、配置、记忆、Skill、MCP、渠道、任务和统计均与 A 隔离。客户端工具安装、探测、版本和进度在 A/B 间一致；共享的窗口、更新、随包资源清楚标识为全局。
- 未服务、被删除或未知 Profile 请求失败关闭；请求乱序、断线和 Gateway 纪元变化不混用缓存或事件；桌面端实际路由与界面显示一致。
- 新增功能若没有作用域声明、对应跨 Profile 测试，或继续使用旧隐式入口，架构检查失败。

验证分层记录：前端状态与路由测试、契约/架构检查、Rust 作用域和命令测试、锁定 fork 的隔离冒烟、Windows 原生窗口两个真实 Profile 的并发实操。构建和冒烟不能替代原生窗口验收。实施代码后按仓库规则更新 `ROADMAP.md`，保留已有未提交工作。

## 8. 2026-10-26 实施核对与上游缺口

- 已实施：`ProfileScope` / `SessionScope` / `GatewayScope` / `WorkspaceScope` 契约；Rust `resolve_profile` 固定请求的 Gateway、Profile home 和 HTTP 目标；前端普通切换只改变查看的 Profile，不再调用 `profiles.select` 或清空聊天和模型状态；聊天事件与审批按已核实会话归属分发，归属未知的审批不展示给页面。当前 69 个原生命令和 5 个事件纳入架构登记检查，动态扩展操作有声明清单。
- 已验证：Windows 原生窗口使用 default 与 coder 两个已服务 Profile，A → B → A 的聊天草稿和思考强度立即恢复，Gateway 子进程未因切换更换；Profile 概览返回时立即显示已缓存卡片；扩展目标切换返回时旧卡片先显示，目标刷新在区域内发生。模型配置页显示 default 的 1 个候选、coder 的 9 个候选，再切回 coder 时 9 个候选立即恢复。`pnpm --filter @hermess/frontend typecheck`、`pnpm build`、`pnpm check:architecture`、`pnpm check:contracts`、`pnpm check:generated-contracts`、`cargo fmt --all -- --check`、`cargo test --locked` 通过（57 项通过、3 项按条件跳过）。隔离环境的 `scripts/smoke-gateway.py` 通过自有 Gateway、鉴权拒绝、聊天、附件、重连、中断、历史、文件工具、澄清和审批拒绝；假模型服务在主动断连时输出连接异常，脚本成功退出。此冒烟不是双 Profile 并发验证，也不代表模型写入、渠道扫码、定时任务并发、终端和真实模型运行已完成原生验收。
- 工具范围修订及客户端实施：FFmpeg 等客户端能力按应用统一安装和展示，不属于 Profile 拆分任务。现有 `list_bundled_tools`、`list_downloadable_tools` 和 `install_downloadable_tool` 命令没有 Profile 参数，下载命令使用应用公共的 Hermes home。锁定 fork 的 PM 安装目录取进程级 `HERMES_HOME` 根目录，不受 Profile 的请求级 home 覆盖影响；产品回归测试验证 A/B 两个 Profile 读取同一安装目录。工具页现仅展示随包、可下载和本机探测结果；应用级控制器缓存这些状态，Profile 切换不再触发重读；Gateway 换代与断线会拒绝旧读取/安装回调。运行中新增可下载程序后，已有 Gateway 的进程 PATH 不会被另一个安装子进程改变，界面现明确提示重启自有运行时后使用；Profile 切换本身不重启。Profile 管理页新增只读“工具集”标签，通过客户端 `list_profile_toolsets` 和 fork 已有的 `/api/tools/toolsets`，使用目标 Profile 的本机 HTTP 凭据读取当前配置；明确不把它当作已有会话实际工具。Skill、MCP 保持在各 Profile 的扩展管理中。客户端已经移除无人使用的 `tools.list` / `tools.show` 原生命令、前端适配接口和工具组组件。锁定 fork 对命名 Profile 的这两个会话工具读取缺口仍存在，但当前产品不再调用它们。本次没有修改 Hermes fork，也未做原生窗口复验。上游 Profile 工具集 HTTP 与本机票据作用域测试共 13 项通过；产品回归测试 `tests/test_profile_toolsets_native_ticket.py` 验证两个 Profile 的本机凭据读取各自配置，以及共用客户端安装目录（2 项通过）；桌面接入经过类型检查、构建、架构/契约检查和 Rust 编译，尚未原生操作验收。
- 工作区实机验收：coder 下打开终端，`cmd.exe` 在产品工作目录启动；切到 default 时其标签与输出不出现，返回 coder 后原终端和输出立即恢复，随后通过界面关闭了测试终端。最初一次实测发现 Windows 规范化路径带 `\\?\` 前缀导致 `cmd.exe` 回退 `C:\Windows`；已把路径范围校验与终端启动目录分开，复测修复。工作区命令显式接收 `WorkspaceScope`，文件访问限制在作用域根目录内，终端后续操作与事件核对创建时固定的作用域。
- 锁定 fork 的既有 Profile 路由与运行时隔离单测在产品准备的 venv 中复跑，`test_profile_routing.py` 与 `test_profile_isolation_runtime.py` 共 28 项通过。这些单测验证上游已有能力，不覆盖本产品全部原生命令，也不消除上述工具读取路由缺口。
- 异步归属补强：侧栏其他 Profile 的会话列表、扩展页刷新和定时任务聚合读取加入请求版本校验；旧请求完成后不能覆盖较新结果。自定义模型端点删除和 MCP 编辑的先读后写共用首次解析的 Profile 作用域，后续 HTTP 请求核对当前 Gateway 句柄、纪元、端口和存储归属；中途重连则以冲突失败，不重新解释成新 Gateway 上的写入。前端类型检查、桌面构建、架构检查和 Rust 单测复跑通过（57 项通过、3 项按条件跳过）。
- 人格子进程使用解析作用域里固定的 Hermes 路径和 Profile home；渠道扫码记录发起时的 Gateway 纪元，轮询时拒绝旧纪元，确认后的配置写入仍使用同一次解析的作用域。Rust 单测复跑通过（57 项通过、3 项按条件跳过）；扫码的跨重连原生流程尚未操作验收。
- 模型配置的直连 HTTP 请求在获取鉴权票据前后核对固定作用域；浏览器桥接在确认会话、连接浏览器及缓存连接结果时核对 Gateway 纪元，旧请求不能把新 Gateway 标记为已连接。Rust 完整单测复跑通过（57 项通过、3 项按条件跳过）；浏览器桥接目前未注册为前端原生命令，真实网页操作仍待单独验收。
- 待启用 Profile 的“重试”在 Gateway 重启后重新读取服务集合，确认目标已被服务才切换查看；渠道扫码卡片、轮询进度和忙碌状态按 Gateway 纪元与 Profile 保存。切去另一 Profile 不取消扫码，返回原 Profile 可继续轮询；Gateway 换代后旧二维码不显示。前端类型检查和架构检查通过；这两处界面交互仍待原生窗口复验。
- Profile 列表刷新时，若上次查看的 Profile 或启动偏好已不在当前服务集合，界面选用当前正在服务的 default 或首个 Profile；不会替用户改写启动偏好。前端类型检查通过，此入口尚未做原生窗口复验。
- 聊天断线事件不再调用首次渲染时捕获的单个状态写入函数，而是清理该 Gateway 纪元下已打开过的各 Profile 的运行态、开放请求与澄清卡片；消息记录仍保留在各自 Profile。前端类型检查通过，断线并发场景尚未原生复验。
- 模型选择浮层的定位回调随 Profile 作用域更新；聊天思考强度仅在同一 Profile 内切换会话时清空，A → B → A 返回同一会话时保留缓存值，再后台读取确认。前端类型检查与架构检查通过，两个页面的该边界尚未原生复验。
- 同一 Gateway 纪元的会话事件回放补上经当前会话确认的 Profile 归属，避免被事件分发器丢弃。Gateway 纪元变化时不再把恢复快照写入旧缓存键：记录每个 Profile 最近会话 ID，新纪元中查看该 Profile 时从 Gateway 快照恢复；显式新建空会话会清除该记录。渠道触发的正常或强制重启均使用这条新纪元恢复路径，强制重启期间不提前清除记忆。前端类型检查通过；真实断线、换代和双 Profile 并发恢复尚未原生验收。
- 模型候选及配置的并发读取加入 Profile 内请求版本校验；较早的自动读取不能覆盖随后手动刷新或保存后的新结果。Agent 配置和个人文件原有各自的请求版本校验保留。前端类型检查通过，模型刷新乱序尚未原生验收。
- ProfileWorkspace 在运行时公布新 Gateway 纪元或停止时清除旧纪元缓存，并以代次拒绝断线后迟到的写入；若运行时缺少 `replay_epoch`，停止/新启动也强制换代。同一纪元的 A → B → A 保留各自状态。普通 Profile 切换只在目标当前纪元缺少会话列表或模型目录时读取，启动回调不再重复发请求。前端 `test:profile-workspace` 两项通过；原生重连与双 Profile 并发尚未操作验收。
- Rust 的显式 Profile 列表刷新与解析器缓存缺失读取共用同一拓扑锁；列表和服务状态完成读取后才更新缓存，避免两次并发刷新以旧响应覆盖新拓扑。Rust 完整单测通过（57 项通过、3 项按条件跳过）；Profile 创建和热加载的真实乱序仍待原生验收。
- 核对非图片附件时发现客户端 `file.attach` 未列入命名 Profile 的 Gateway 路由白名单，已补上。客户端对白名单外方法现直接报错，不能静默发送到启动 Profile。架构检查额外核对聊天、模型和浏览器桥接中使用的 Gateway 方法是否列入命名 Profile 路由清单，覆盖先选择方法名再发请求的附件分支。隔离启动的真实 Gateway 测试验证同一进程为 default/beta 各建会话，附件分别进入各自目录（1 项通过）。另发现锁定 fork 的 `file.attach` 实际以会话 ID 判定归属：把 default 会话 ID 和 `profile: beta` 一起发送，它仍接受请求，但文件落在 default 目录。因此客户端必须始终绑定并核对 `(profile, sessionId)`，不能把 `profile` 字段当作 Gateway 的错配拒绝保证；本次未修改 Hermes fork。Rust 路由测试与架构检查通过，该附件流程仍待双 Profile 原生窗口操作验收。
- 定时任务聚合页现在使用 ProfileWorkspace 的 Gateway 代次作为组件身份：Gateway 换代即清除旧进程任务、选择和编辑状态，并重新从各已服务 Profile 读取；普通 Profile 切换不换代。即使运行时未提供 `replay_epoch`，停止或重新启动时强制增加代次。前端 ProfileWorkspace 测试 3 项、类型检查与架构检查通过；真实 Gateway 重连时停留在任务页的界面行为仍待原生窗口验收。
- 客户端中央作用域模块现按 Gateway 连接记录 `session.create`、`session.list`、`session.resume` 确认的 `(Profile, sessionId)`；即使两个 Profile 恰好使用同一会话 ID，也分别保存归属。其余带 `session_id` 的 Gateway 请求及审批/澄清回答先核对这对身份。未知或与目标 Profile 不一致时在客户端拒绝，并通过专门错误码提示先恢复该 Profile 的会话或切回所属 Profile；业务参数里夹带与已解析作用域冲突的 `profile` 也直接拒绝。新 Gateway 连接重新建立记录，Profile 列表刷新不清掉同连接记录。真实 Gateway 隔离测试确认用 beta 恢复 default 会话会报错，而 `file.attach` 的错配字段不会报错，因此恢复可作为归属确认，附件必须经过客户端校验。Rust 全套单测、真实 Gateway 隔离测试、前端类型检查、桌面构建及契约/架构检查通过；这套拒绝路径仍待原生窗口操作验收。
- 工具页的应用级缓存补上 ProfileWorkspace 的 Gateway 代次：离开工具页期间若运行时停止/重启，即使后端没给 `replay_epoch`，返回工具页也会重读新运行时；普通 Profile 切换不触发重读。原生窗口已看到共享工具页 18 项、default/coder 各自管理页的工具集配置，以及切换时自有 Gateway PID 不变；FFmpeg 等安装和真实缓存失效仍待操作验收。
- 后续源码核对发现管理页概览和扩展页虽保留缓存画面，A → B → A 仍会重复请求；现改为同一次页面停留中复用已成功读取的数据，离开管理页后再进入或修改扩展配置、手动刷新时重新读取。模型设置页去掉随 Profile 改变的组件重建键。前端类型检查、ProfileWorkspace 状态回归和架构检查通过；窗口内请求数量尚未复验。
- 作用域边界复核：动态扩展操作先解析目标 Profile，具体操作仍由客户端白名单约束，未知操作报错；配置及扩展 HTTP 响应返回后再次核对固定 Gateway 连接。Cron 立即运行曾由产品子进程写入本地存储并通知调度器；现已移除此路径，改由 Rust 后台请求固定 Profile 的 Dashboard `/trigger`。原生操作尚未验收。
- 定时任务聚合页出现部分 Profile 读取失败时，失败 Profile 的创建入口被禁用并明确标记；读取成功的 Profile 仍可创建任务，不让单个 Profile 故障冻结全部任务操作。读取中暂不允许提交，防止旧错误状态尚未核清时重复创建。前端类型检查通过；原生页面尚未复验。
- 已使用与当前锁定提交相同 ref 的 Windows payload 虚拟环境执行产品 Cron worker，隔离临时 Profile home 的 `jobs.list` 成功返回空列表；随包 `.pth` 指向 payload 内 Hermes 源码。证明打包解释器能导入模块，不代表安装包 UI 已验收。
- 个人文件操作发现“先解析 Profile home、配置读取又重新解析 Profile”的跨重连混用风险。现把读取、保存、版本检查和保存后返回值固定在同一 `ResolvedProfileScope`，文件访问前后核对连接纪元。Rust 单测和架构检查通过；双 Profile 原生写入尚未实操。
- 同样收束 Agent 配置的多步先读后写、使用统计的两次 HTTP 读取，以及模型候选文件路径：一次操作只解析一次 Profile，文件读写与模型 HTTP 返回后检查原 Gateway 纪元。源码与 Rust 单测、架构检查已核对；原生 A/B 写入和跨重连过程仍待验收。
- 人格列表和应用的产品子进程在返回后也核对首次解析的 Gateway 纪元，避免重连期间的旧响应进入当前 Profile 页面。代码与 Rust 检查通过，原生操作待验收。
- Profile 缓存失败路径补全：管理页概览/性格有旧缓存但新读取失败时，返回该 Profile 会重试；扩展标签读取失败或切换中取消后不标记为已加载。前端类型检查和构建通过，窗口流程未复验。
- 统计接口核对：`/api/analytics/usage` 与 `/api/analytics/models` 在 Dashboard 路由中存在，客户端两次请求现显式带已验证 Profile。隔离本机票据测试证明 default/beta 各自定位自己的数据库且错配票据拒绝。测试夹具固定 `DEFAULT_DB_PATH` 曾造成无参数请求读默认目录；恢复生产动态路径规则后该请求也能正确路由，因此没有证据称生产环境已有跨 Profile 统计读取故障。原生统计页待验收。
- 产品所用的本机 HTTP 票据路径又增加配置和扩展实测：隔离 Dashboard 中 default/beta 设不同模型配置、MCP 和 Skill，分别读取 `/api/config/raw`、`/api/mcp/servers`、`/api/skills`，返回数据均归目标 Profile。原生窗口的展示和写入流程仍待验收。
- 定时任务联通测试把 Gateway 与桌面读取接在一起：同一个隔离 Gateway 在 beta 创建任务并暂停/恢复后，产品 Cron worker 从 default home 读到空列表、从 beta home 读到该任务 ID。验证两条路径对任务 Profile 归属一致；原生操作仍未验收。
- 原生窗口打开定时任务页时实测“部分 Profile 的任务读取失败”与“还没有定时任务”同时出现。对当前自有 Gateway 的 default/coder 分别请求，旧客户端使用的 `/api/jobs` 均返回 404 `No such API endpoint`；该路由只属于可选 API Server，不属于本产品正在连接的私有 Dashboard。初版修复在客户端使用 Gateway `cron.manage` 负责创建、暂停、恢复，并用固定 Profile home 的产品子进程处理其他操作。后续核对发现私有 Dashboard 另有 `/api/cron/jobs` 路由；当前列表、详情和编辑已改为按 Profile 调用该路由。立即运行初版曾以产品子进程提交给调度器，现按用户选择改由 Rust 后台请求 Dashboard `/trigger`，不等待任务执行完毕；页面提供手动刷新。后台请求失败只记录在桌面进程日志中，页面的“已发起”不代表执行成功。错误页标出失败的 Profile、提供重试，读取失败时不再误报“没有任务”。Hermes 创建任务可能已写入 Cron 存储、却在首次外部调度注册时返回 `job_saved: true`；客户端保留这一部分成功状态，刷新列表并提示勿重复创建。隔离 Gateway 用例验证 beta 创建/暂停/恢复及 Dashboard 按 Profile 列表、详情、编辑；触发执行与原生任务页尚未复验。
- 待验收：双 Profile 同时有运行中会话时的发送、停止、审批、补发和事件；模型、配置、个人文件、Skill、MCP、渠道、任务与统计的 A/B 差异和写入隔离；Gateway 纪元变化及请求乱序；浏览器桥接。终端已完成单实例 Profile 往返检查，尚未验证两个 Profile 各有终端时的并发输入。

## 9. 完成条件验收矩阵（2026-10-26）

| 完成条件 | 当前证据 | 状态 |
| --- | --- | --- |
| A → B → A 不重启 Gateway，聊天草稿、模型候选、Profile 概览和扩展卡片立即恢复 | 当前开发版原生窗口在 default/coder 往返后仍是同一桌面进程 PID 45868 与 Gateway 子进程 PID 42060；已访问的 Profile 概览立即显示缓存，模型候选 default 为 1 个、coder 为 9 个。早前已观察聊天草稿、思考强度与扩展卡片返回恢复 | 主流程已原生观察；未证明双 Profile 同时执行模型任务 |
| 会话与事件保持 `(Profile, sessionId)` 归属，错误目标拒绝 | 客户端归属表与 Gateway 隔离测试覆盖错配恢复；同一隔离 Gateway 上两个 WebSocket 客户端并发为 default/beta 建会话，随后验证各自附件目录与错配恢复，测试通过。Rust、契约和架构检查通过 | 双客户端并发建会话已验证；双运行会话事件及原生操作待验收 |
| Profile 私有数据与配置隔离 | 配置、Skill、MCP、工具集和统计的本机票据 A/B 测试通过；定时任务 Gateway 写入及 Dashboard 按 Profile 读取通过隔离测试；原生窗口显示 default/coder 的模型候选分别为 1/9、近 30 天会话数分别为 28/1，coder 人格文件位于 `profiles/coder/SOUL.md` | 自动验证覆盖主要路由；原生读取差异已观察，各页面 A/B 写入待验收 |
| 集成工具归应用，Profile 工具集归管理页 | 当前原生工具页显示 18 项客户端集成工具和“所有 Profile 共用”，可进入 Profile 管理页只读“工具集”；扩展页可明确选择安装/连接目标 Profile；客户端不再调用 `tools.list/show` | 页面归属已原生复验；安装与缓存失效待验收 |
| 定时任务不依赖私有 Dashboard 缺失的 `/api/jobs` | 原生窗口曾复现 404 与错误空态；改为 Gateway `cron.manage` 加 Dashboard `/api/cron/jobs` 后，原生任务页显示空列表、没有失败提示，新建弹窗可选择 default/coder；立即运行现请求 Dashboard `/trigger`，产品 Python 脚本已移除 | 列表与目标选择已原生复验；触发执行、真实写入与运行待验收 |
| 工作区与终端不串 Profile | 早前原生窗口完成 coder → default → coder 单终端往返；作用域和路径修复经 Rust 测试 | 双终端并发输入待验收 |
| 浏览器桥接不串 Profile/会话 | Rust 现有桥接按 Profile 保存 Chromium 实例，并用 `session.resume` 核对目标会话；但 `open_visible_browser` / `close_visible_browser` 未注册为 Tauri 命令，当前前端也无调用入口 | 当前产品没有可操作的桥接界面；不能记为已完成原生验收，后续启用时须补入口与会话并发验证 |
| 断线、乱序及 Gateway 纪元变化不接纳旧结果 | ProfileWorkspace 代次、响应后纪元检查和架构检查已覆盖代码路径 | 自动验证通过；跨重连原生操作待验收 |
| 新功能必须声明作用域 | `pnpm check:architecture` 对 69 个原生命令、5 个事件及动态扩展清单执行登记检查 | 检查通过；后续新功能仍需持续执行 |

本次 Windows 解锁后继续操作当前开发版，以上“当前原生窗口”证据均在解锁后的同一桌面进程取得。Agent 配置页已读取当前运行时配置，渠道页已显示当前实例状态；渠道扫码完成后的重启提示属于配置生效流程，不代表浏览 Profile 时会重启。此次没有修改用户模型、人格、渠道或任务数据，也没有执行真实双 Profile 发送、扫码、任务写入、Gateway 断线恢复与安装包验收；这些仍是交付前的独立检查项。
