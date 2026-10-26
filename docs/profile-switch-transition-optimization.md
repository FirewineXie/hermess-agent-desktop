# Profile 切换问题的根本修复方案

状态：待实施。依据 2026-10-26 工作树与锁定的 Hermes fork 核对。此文是设计方案，不代表代码已修复或原生窗口已验收。v0.1.6 工作树有未提交改动，实施时须保留。

## 1. 核心判断

Gateway 已能同时服务多个 Profile。一个 Profile 的任务运行时，用户打开另一个 Profile 的页面，不需要切换 Gateway、重建连接或清空前一个 Profile 的前端数据。Profile 在 UI 中应是**导航和请求的上下文**，而不是应用只能有一个的“全局工作模式”。

当前桌面端虽通过 `ProfiledGateway` 给支持的 Gateway 方法附加 `profile`，大多数命令仍从 `BackendState.selected_profile` 取值。现有契约中，`chat.listSessions(profile?)` 可以显式指定 Profile；`createSession`、`resumeSession`、`submitPrompt`、模型等多数方法不能。前端因而必须先 `profiles.select(name)` 改写全局选择，再把聊天、模型和页面状态清空重读。短暂“reload”是这个单一全局选择设计在 UI 上的表现。

**根治方向：每条会话、每份 Profile 数据、每个请求都明确归属 Profile；切换页面只改变当前查看的 Profile。** 不应把此前方案中的“遮住旧页面，等所有数据重读后一次提交”作为最终解法。遮罩只可作为首次进入尚未缓存 Profile 时的局部加载反馈。

## 2. 已核对的实现事实与边界

| 证据 | 当前事实 | 对方案的影响 |
| --- | --- | --- |
| `apps/desktop/src-tauri/src/runtime/profiles.rs` 的 `ProfiledGateway`、`accepts_profile` | `session.create/list/resume`、`prompt.submit`、`config.get/set`、`model.options` 等 Gateway 方法可附加 Profile | Gateway 路由基础已经存在，无须因为切换界面重启进程 |
| `apps/desktop/src-tauri/src/runtime/mod.rs` 的 `gateway()` / `gateway_for_profile()` | 前者捕获全局 `selected_profile`；后者支持显式 Profile 并校验 Profile 存在 | 应复用显式路由，逐步减少业务命令对全局选择的依赖 |
| `packages/contracts/src/index.ts` 与桌面 adapter | 只有 `chat.listSessions(profile?)` 已显式传 Profile；其他聊天、模型、扩展、配置接口仍多为隐式选择 | 根治需要同时改契约、adapter 和 Rust，单改 React 缓存不够 |
| `apps/frontend/src/App.tsx`、`useProfiles.ts`、`useChatController.ts` | 选择 Profile 后调用 `resetChat(true)`、`resetModel()` 并重读列表 | 应取消把切换等同于全局重置的流程 |
| `apps/frontend/src/App.tsx` 的扩展页 `key={selected}` | Profile 变化时整页卸载重建 | 应改为 Profile 专属数据分区，保留页面自身的导航与搜索状态 |
| `apps/desktop/src-tauri/src/gateway.rs` 转发事件 | 前端事件包含 `session_id`，当前契约没有统一的 Profile 字段 | 多 Profile 并行展示时，要建立可靠的 `session_id → profile` 归属；不能只根据当前页面判断事件属于谁 |

锁定 fork 和路线图已记录单 Gateway 热加载两个 Profile、分别创建和列举会话的隔离冒烟；**多 Profile 原生窗口和真实模型并发仍未验收**。本方案不把那次冒烟扩大解释为所有命令都已支持显式 Profile。

## 3. 目标行为

1. 侧栏持续显示多个 Profile 的会话。点击 Profile 只改变“正在查看谁”，不清空其他 Profile 的会话树，也不重启 Gateway。
2. 每个 Profile 的会话列表、打开的会话、消息、草稿、附件、模型摘要、扩展和概览数据各归各的。A → B → A 时，A 的已读取内容立即恢复；如后台数据可能变化，再静默更新对应区域，不先清空。
3. 点击其他 Profile 的会话，直接打开该会话。恢复、发送、停止、附件、模型和配置请求都带该会话或目标 Profile 的身份，不必先执行一次全局 `profiles.select`。
4. 首次查看某个 Profile 时，只有尚无数据的区域显示加载态；侧栏和页面骨架不跳变。缓存数据过期或写入成功后按 Profile 定向刷新，不做全局 reload。
5. 运行时断开、Gateway 纪元变化、Profile 被删除或停止服务时，才按真实状态失效相应缓存，并给出错误或重连状态。

## 4. 实施设计

### 4.1 解除“查看 Profile”和“运行时所选 Profile”的绑定

前端维护 `viewedProfile`，仅用于导航和渲染。桌面端持久化的 `selected-profile` 暂保留作启动默认值和旧接口兼容值；打开另一个 Profile 页面不再调用 `profiles.select`。新建会话从聊天输入框拿本次选定的 Profile；已有会话使用创建或恢复时固定的 Profile。所有隐式旧接口在迁移完成前仍须标明归属，不允许悄悄回退到 default。

### 4.2 显式 Profile 请求契约

先梳理每个命令实际使用的 Gateway/HTTP 能力，再按功能扩展 `DesktopApi`、Tauri adapter、Rust 命令。优先覆盖聊天全链路：`createSession(profile, cwd)`、`resumeSession(profile, id)`、`listSessions(profile)`、`submitPrompt(profile, sessionId, text)`、停止、事件补发、思考强度、命令目录、技能分发、附件以及请求回应。模型选项与默认模型、Profile 概览、扩展和配置读写也应接受明确目标 Profile。Rust 在信任边界校验 Profile 存在且正在服务，然后用 `gateway_for_profile` 或已有 `profile_http_auth_for` 路由；Gateway 不接受 `profile` 参数的方法须使用该方法实际支持的 Profile 定位方式，不能直接拼参数。

不能假定只凭 `session_id` 就能唯一确定 Profile。会话状态、事件序号、缓存键至少使用 `(profile, sessionId)`。审批/澄清请求的回应目前走共享 Gateway 的 request ID；迁移时核实 request ID 与 Profile 归属和取消事件的关联，再确定是否要扩展前端事件契约。任何归属不明的事件不得写入当前查看的 Profile。

命令按功能分批迁移，每批保留旧调用兼容并做路由验证。涉及配置或凭据的 HTTP 请求应复用现有隔离边界；不修改锁定 Hermes fork，除非客户端适配确实无法实现并按仓库规则另行提出证据。

### 4.3 前端按 Profile 保存状态

会话列表使用 `sessionsByProfile[profile]`，聊天使用 `(profile, sessionId)` 作为状态键；Profile 概览、扩展、模型信息也分别缓存到所属 Profile。`viewedProfile` 改变时只选取对应状态，不执行 `resetChat`、`resetModel` 或整页强制 remount。聊天草稿、附件和运行中会话在离开时保留；返回时展示本地已有状态，并由该 Profile 的事件或后台读取更新。

首次读取、写入后的定向失效、手动刷新及重连后的重验需要明确规则。缓存不是永不更新：Gateway 中其他任务或渠道可能修改会话与配置。列表可在打开时展示缓存并后台刷新；保存 Skill/MCP、模型或配置后只失效相关 Profile 的相关数据；Gateway 纪元改变时按受影响范围重验。后台结果需带发起时的 Profile 和请求版本，过期结果不能覆盖新值。

扩展页移除 `key={selected}`；分类、搜索词和目录检索属于页面状态，已安装 Skill 与 MCP 属于目标 Profile。Profile 概览的技能、MCP、记忆卡片也按 Profile 缓存，首次加载时保持卡片尺寸。

### 4.4 逐步去除全局选择

`profiles.select` 最终只承担“记住下次启动时默认查看哪个 Profile”的偏好功能，而不是跨 Profile 访问的前置操作。兼容期必须明确哪条旧命令仍依赖全局选择，避免一部分操作按会话 Profile 路由、另一部分误写全局所选 Profile。全部入口迁移完成并经过回归后，前端正常浏览和聊天流程才停止调用它。

## 5. 推荐实施顺序

1. 建立命令矩阵：逐项记录当前前端入口、契约方法、Rust 命令、Gateway/HTTP 是否支持显式 Profile，以及事件归属。优先核对发送、恢复、停止、审批、附件和模型写入，防止“看 B，操作 A”。
2. 扩展聊天全链路的显式 Profile 参数，加入跨 Profile 同时有会话与任务的路由测试；再把前端聊天状态改为按 Profile/会话分区。
3. 改侧栏与导航：点击 Profile 或其他 Profile 会话直接查看目标数据，不执行 `profiles.select`；保留已有数据并后台定向刷新。
4. 迁移模型、概览、扩展及配置接口，删除 `resetModel` 式全局切换和扩展页 `key`；补齐首次加载与数据变化时的定向失效。
5. 清理旧全局选择的业务用途，保留启动偏好兼容；实测切换交互和并发场景。代码实施后按仓库规则更新 `ROADMAP.md`。

## 6. 验收标准

| 场景 | 通过条件 |
| --- | --- |
| A → B → A | A 的已读取会话、消息、草稿、模型摘要立即出现；没有整页空白和全量重读 |
| 首次打开 B | 未缓存区域各自加载；侧栏、导航和页面布局保持稳定 |
| A、B 同时有任务 | 切换查看不重启 Gateway；两边任务、事件、审批和结果按 Profile 归属更新 |
| 从 A 直接点击 B 的会话 | B 会话直接打开；发送、停止、附件和模型操作均路由 B |
| 扩展与配置写入 | 修改 B 后只更新 B 的相关缓存；A 的配置和页面状态不受影响 |
| 请求乱序、断线和重连 | 旧结果不能覆盖新状态；Gateway 纪元变化后缓存按规则重验；无跨 Profile 数据混用 |

验证应分别记录前端路由/状态测试、契约与架构检查、Rust 路由测试、Windows 原生窗口中两个真实 Profile 的并发操作。构建或锁定 fork 的隔离冒烟不能代替原生窗口验收。具体耗时再用原生窗口时间线测量；本方案的目标是消除不必要的重置与请求，而不是仅把等待遮住。
