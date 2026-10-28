# 设置功能迁移验收记录

基线：`runtime/upstream.lock.json` 锁定 fork 提交 `882037eb8745b505db438217513c4c94f95c93c1`（官方基线 `v0.22.5`）。本记录只描述当前工作树；“代码完成”不等于 Windows/macOS 原生实机或真实服务验收通过。

锁定 fork 中已实测的 M06、S03 问题、原始结果和待审批修复范围见[实际问题清单](hermes-fork-maintenance-request.md)；该清单不是修改 fork 的授权。

## 当前结论

2026-10-28 用户调整范围：Cloud 登录、SSH 托管更新、远端服务连接和语音设备界面暂时隐藏，先完成其余设置。网关分类现在只显示本地运行时与存储；如果已有远端连接仍在活动状态，保留“切回本地连接”作为恢复入口。语音分类只显示转写与播报的 Profile 配置，隐藏语音对话子页、麦克风和播报诊断控件；此前单独暂缓的连续语音对话按钮也不再显示，普通语音转写按钮仍保留。隐藏入口不代表相关能力已验收，四项在用户恢复范围前继续记为暂缓。

2026-10-28 用户表示部分边界功能可先忽略；当前优先设置日常读写、保存重读及 Profile 切换。fork 修复、提供商覆盖时无法核实的旧目录清理、缺失事件和真实设备联调继续列为未完成，不把暂缓视为验收通过。

2026-10-28 设置页布局调整：进入设置后隐藏会话主导航，设置分类栏占据左侧，并提供“返回”按钮回到进入设置前的页面。调试预览已检查进入设置后仅有设置分类栏、返回聊天后主导航恢复；前端类型检查与构建通过。

2026-10-28 设置页新增搜索：分类和子页始终可搜索；当前 Profile 的运行时 Schema 成功读取后，显示映射到现有表单的字段结果。选中字段可跳转至对应子页并过滤出该字段；不搜索已按用户要求隐藏的语音对话字段。Schema 读取失败时明确退化为分类/子页搜索；未保存草稿拒绝离开时保留搜索输入。前端类型检查、桌面构建、架构检查及字段路由测试通过；本轮未取得新的浏览器交互截图，不能记为调试页实际操作通过。

2026-10-28 修正调试页预览作用域：此前 Agent 配置、提供商目录、MoA、委派路由、记忆提供方和共享指标复用同一份 mock，切换 Profile 后的预览读回不能作为隔离证据。现在这些预览数据按 Profile 分开；提供商同步先返回目标冲突或就绪状态，应用后才改变目标预览目录，并保留目标主模型标记。预览仍标为 `PREVIEW_ONLY`，不等同真实 Gateway。新增定向测试 4 项且前端构建通过；当前浏览器标签仍返回 `browser.user is unavailable`，修正后的页面切换和保存尚未点击验收。

2026-10-28 调试页原始 Agent 配置的 `saveRaw` 原为空操作，可能提示保存后回读旧值；现用 YAML 解析器按当前 Profile 的预览配置执行完整替换，检查预期旧版本、重复键、根对象和 256 KiB 限制。此路径只属于 `PREVIEW_ONLY` mock，桌面端仍走原有 Gateway。新增 2 项测试、前端构建、契约与架构检查通过；页面点击仍未验收。

2026-10-28 调试页提供商模型目录的 `saveLists` 原为空操作，现按 Profile 保存并由 `loadLists` 读回；前端构建通过。该预览仅用于检验编辑交互和数据作用域，真实提供商模型发现及宿主存储仍需单独验收。

2026-10-28 设置页顶部 Profile 选择失败时不再吞掉异常：当前选择框下显示错误；切换成功、连接变化或再次选择会清除旧错误，过期请求不能覆盖新状态。前端类型检查和构建通过；调试页点击仍待复验。

2026-10-28 调试页提供商新增、编辑并设为默认时，现在同步更新当前 Profile 的主模型、接口地址和当前标记；`savedConfig`、`options`、`endpoints` 读回一致。删除当前提供商时清除其主模型提供商引用，另一 Profile 保持原值。定向 mock 接口测试 1 项、前端类型检查与构建通过；浏览器点击、真实提供商调用及原生窗口仍未验收。

2026-10-28 收紧主模型保存状态：提供商卡片的默认模型保存和模型编辑弹窗现在都在提交后重新读取目标 Profile 的配置；模型、提供商或自定义地址不一致时显示“已提交但未核实”，不提前报成功或关闭编辑弹窗。主模型子页复用同一读回结果，避免重复读取。前端类型检查和构建通过；真实 Gateway 拒绝、重读失败与 Profile 切换并发仍待原生窗口操作。

2026-10-28 提供商新增和编辑也在提交后按目标 Profile 重新读取并核对记录 ID、名称、地址、默认模型；设为默认时同时核对主模型配置。无法核实时保留表单并提示检查；新增提交前重新查询端点地址，避免上一次读回失败后重试产生重复记录。前端类型检查、构建和全量 46 项前端测试通过；实际 Gateway 新增、修改与重试仍待原生窗口验收。

2026-10-28 进一步验证锁定 Gateway 的提供商主路径：在产品隔离的 Hermes 实例中对 beta Profile 新增提供商、修改名称和默认模型，两次都从端点列表与原始配置读回 ID、地址、模型及当前标记；新建 beta 会话实际请求本机假模型端点并得到回复，default Profile 的主模型保持原值。删除后端点列表不再包含该 ID，主模型配置也不再引用该地址。隔离 Gateway 用例 1 项通过（含既有多 Profile 场景）；这不是前端点击或真实付费模型调用，Windows/macOS 原生窗口仍待验收。

2026-10-28 主模型读回补查接口地址：提供商编辑器提交与该提供商目录不同的自定义地址时，必须在目标 Profile 原始配置中读回同一地址才报告核实；沿用目录默认地址时允许运行时省略冗余的 `model.base_url`。前端类型检查与构建通过；浏览器及原生窗口操作未取得新证据。

统一设置壳层、Profile 作用域、模型提供商与 MoA、外部记忆提供方、共享指标、四类已有事件通知、录音转写、手动/自动播报、高级分组及设备偏好已经进入产品代码。浏览器预览明确使用 `PREVIEW_ONLY` mock，只用于界面和交互检查。

远程 URL 已具备令牌连接测试、宿主保存/删除与调试页切换；活动 UUID 现在驱动聊天 RPC、Profile 列表和已适配的配置 HTTP，实时事件按连接身份过滤。远程主模型、提供商、MoA、委派、记忆提供方、共享指标、用量统计与语音接口进入该路由。远程聊天页隐藏本机工作区、附件、文件与终端入口；远端自定义 Profile 创建已走远端 HTTP 并刷新远端列表，专家预设明确禁用；其他本地专属操作仍未适配；真实远端服务与原生窗口尚未验收。SSH 模式已增加系统 OpenSSH 主机探测、到远端回环网关的持久隧道、令牌鉴权、注册表保存与调试页切换；隧道由桌面进程管理，远端已有进程不由桌面接管。此代码路径尚无真实 SSH 主机及原生界面端到端验收。调试页已加入 chained 连续语音的采集、转写、发送、播报、再监听代码路径，但还没有麦克风与真实服务端到端验收。客户端直连语音已在宿主按目标 Profile 读取 Gateway 解析配置并直连受支持的 STT/TTS 提供方，服务器专属提供方继续中转；真实提供方仍待验收。Cloud、SSH 托管更新和 GPT Live 仍未完成，因此本计划不能标为“全部完成”。

## 功能编号状态

| ID | 状态 | 当前产品证据 | 尚缺验证或实现 |
| --- | --- | --- | --- |
| M01 | 代码完成 | `features/settings/` 统一入口复用 `ModelSettingsView`；所有调用显式携带目标 Profile；设置页切换 Profile 先确认 Agent/委派未保存草稿，成功后清理旧草稿、模型编辑缓存及目标缓存并重新读取，拒绝旧异步回写；切换失败会在选择框下显示错误，旧请求不覆盖新状态；统一设置搜索可按分类、子页及当前 Profile 的运行时 Schema 字段导航；方向键、Enter 和 Escape 可操作结果，目录加载中明确提示范围；通用字段进入表单并筛选目标字段，回退和 MoA 字段进入专用编辑页，辅助任务字段滚动并标出对应卡片，其他字段进入高级表单；隔离 Gateway 已验证 beta Profile 提供商增删改、主模型读回及新会话调用 | Profile 切换与搜索的浏览器交互、前端经桌面宿主的提供商操作和双 Profile 原生窗口复验 |
| M02 | 部分完成 | `model.main` 子页现直接选提供商与模型 ID，经既有 `models.setDefault` 保存并按目标 Profile 回读核实；上下文、推理强度和服务档位保留在同页；隔离真实 Gateway 以本机假模型端点验证旧会话继续调用显式固定的旧模型，新建会话调用新 Profile 默认模型，且另一个 Profile 不受影响；浏览器调试页验证保存、切换 Profile 与重读显示 | 原生窗口中的配置和真实提供商调用仍待验收；浏览器使用 `PREVIEW_ONLY` mock |
| M03 | 部分完成 | `fallback_providers` 有序行编辑，提供商与模型选择、上移/下移；保留每行额外路由字段，完整行按 Schema 保存并重读；调试页验证顺序；隔离真实 Gateway 验证 beta Profile 写入/读回及 default Profile 不受影响，并用两个本机假模型端点验证主模型失败后实际请求回退模型，`message.complete` 返回回退内容且用量模型为回退模型 | 原生窗口中的配置与真实提供商回退仍待验收；浏览器使用 `PREVIEW_ONLY` mock |
| M04 | 部分完成 | 复用 `saveAuxiliary` 和任务卡片；新增 Profile 级 `GET /api/model/auxiliary` 读取运行时任务目录、插件任务名称与继承关系、当前主提供商及本地端点判定，固定到其他提供商的任务显示提示，本地端点不误报；调试页以 `?settings=model.auxiliary&previewStaleAux=1` 核对固定路由提示，改为“跟随主模型”并保存后提示消失；隔离真实 Gateway 将 beta Profile 的 `title_generation` 指向本机假模型端点，`llm.oneshot` 实际返回该端点内容且请求携带配置的辅助模型 ID | 原生窗口配置与真实提供商调用仍待验收；浏览器数据为 `PREVIEW_ONLY` mock |
| M05 | 部分完成 | `delegation.*` 继续按 Schema 校验；新增 Profile 级路由契约与结构化编辑，按 Gateway 返回的可用性禁用模式；模型路由可填写提供商或自定义 HTTP(S) 地址，以及 API 模式、推理强度、服务档位和路由密钥；每条路由可独立编辑有序回退模型及请求覆盖 JSON 对象。已有密钥只显示遮盖值，改名时带原名称以保留原密钥，清除密钥须显式操作；前端检查必填字段、地址协议、回退行、JSON 对象和重名。隔离真实 Gateway 验证仅地址路由、单路由回退链及请求覆盖参数的写入/读回，遮盖密钥改名后保留、默认路由随之更新，以及缺失描述时拒绝且旧配置不变 | 插件后端状态、新字段的调试页操作和真实子 Agent 调用仍待验收；高级路由字段的实际子任务生效范围尚未验证 |
| M06 | 部分完成 | `DesktopApi.models.moa`、Rust `GET/PUT /api/model/moa`、结构化方案编辑器；浏览器调试页验证半填参考模型保存被拒；隔离真实 Gateway 验证 beta Profile 方案保存/读回、default Profile 隔离，以及半填方案被拒且旧方案不变；以 `moa` 虚拟提供商创建 beta 会话后，确认参考模型和聚合模型分别请求本机假端点并完成回答 | `/moa` 单次命令在热会话中可完成聚合回答，但下一轮普通消息未能恢复原模型端点；锁定 fork 的恢复逻辑只按模型名和提供商重新解析，需要维护 fork 并更新锁定提交后复验；真实提供商与原生窗口仍待验收；浏览器使用 `PREVIEW_ONLY` mock |
| M07 | 部分完成 | Rust 在源/目标 Profile 内复制名称、地址、默认模型、模型目录、传输模式及上下文长度；冲突预览按 ID、名称和地址识别目标，列出公开字段差异及目标旧凭据清除风险，默认不覆盖；目标选择变化即清除旧预览与替换确认，来源 Profile 切换时关闭旧同步弹窗并忽略过期结果；覆盖时明确清除目标旧密钥并要求重认证；宿主从源 Profile 配置中提取规范模型和推理强度别名元数据，不读取明文密钥给前端；写入后重新读取目标 Profile，逐项核对公开字段、别名元数据及密钥状态，无法核实时显示单独状态。调试预览已修正为按 Profile 保存目录，并在同步应用后改变目标预览目录 | 真实双 Profile 与认证状态复验；修正后的调试页点击尚未完成；锁定 Gateway 的提供商 POST 会合并旧模型目录，通用配置 PUT 递归合并字典，原始 YAML PUT 则整文件覆盖且无服务端版本校验；DELETE 会脱离目标主模型，因此旧目录无法安全清除时当前结果为未核实，不能宣称替换完成 |
| G01 | 部分完成 | 本地运行时保留既有所有者；URL 令牌模式测试、保存和立即应用；系统 OpenSSH 主机探测及到远端回环网关的持久隧道，SSH 模式复用已验证的 HTTP/WS 令牌和 Profile 握手链路 | 真实 URL/SSH 远端与原生窗口未验收；本机工作目录、文件附件等远端操作及 Cloud 未实现；远端自定义 Profile 创建尚未对真实服务验收 |
| G02 | 部分完成 | Windows Credential Manager/macOS Keychain 持有 URL/SSH 连接令牌，文件只有摘要；凭据键绑定连接 ID 与目标摘要；事件、通知及前端工作区按连接 ID 隔离，切换失败保留原连接 | OAuth 登录、并发切换实测及 macOS 原生凭据读写未验收 |
| G03 | 部分完成 | 宿主保存/列出/删除最多 32 个 URL/SSH 连接；SSH 条目记录目标主机、远端网关端口及可选密钥路径；活动远程客户端保存 UUID、Profile 列表与独立会话归属；调试页提供切换与返回本地，活跃条目禁止删除 | Cloud 条目、完整设置及设备功能的连接路由与真实双连接隔离验收未完成；远端自定义 Profile 创建尚未实测 |
| G04 | 暂缓 | 当前无 SSH 托管更新，用户要求先隐藏界面 | 恢复范围后需要 SSH 身份验证、远端所有权与更新事务 |
| N01 | 部分完成 | 设备本地总开关及 approval/input/turnDone/turnError 四类真实事件映射 | 锁定 Gateway 未提供 backgroundDone/credits/plugin 对应事件 |
| N02 | 部分完成 | 后台判断包含失焦；完成通知仅跟随当前会话，审批/补充信息可提醒其他会话；事件与请求去重；Tauri 通知点击只回到同一连接的 Profile/会话；审批通知“允许一次/拒绝”按钮按连接与请求 ID 调用现有 Gateway 决策路径 | Windows/macOS 原生通知点击、操作按钮和请求已过期场景实机复验 |
| N03 | 代码完成 | Tauri 原生通知插件投递、设备权限读取与请求、系统通知测试、独立声音偏好及 Web Audio 试听路径 | Windows/macOS 原生呈现、权限和声音实机复验；浏览器预览不会伪报已投递 |
| C01 | 代码完成 | 记忆字段按目标 Profile 的运行时 Schema 读取、逐字段保存和重读 | 真实运行时字段全集对照 |
| C02 | 代码完成 | 声明字段、秘密不回填、OAuth start/status、超时/取消/Profile 隔离 | 真实提供方 OAuth 流程 |
| C03 | 部分完成 | context/compression/auxiliary.compression 独立分组并走 Schema；隔离真实 Gateway 的 beta Profile 设置合法的 65,536 token 上下文窗口及 200 token 压缩上限，连续提交三轮后主模型与压缩摘要分别请求本机假端点，三轮会话均正常完成且用量报告压缩次数大于零 | 真实提供商摘要质量、原生窗口配置及长期会话恢复仍待验收 |
| S01 | 部分完成 | approvals、`command_allowlist` 独立分组；聊天审批卡继续使用原 Gateway 决策；隔离真实 Gateway 的 beta Profile 让假模型尝试修改临时受保护文件，分别响应“拒绝”和“允许一次”，确认前者不改文件、后者成功改写；同一条临时文件命令在 beta Profile 加入允许列表后无审批执行，在 default Profile 仍须审批且拒绝后文件保留，beta 移除规则后也恢复审批；配置写入各自 Profile | Windows/macOS 原生审批卡操作和规则编辑界面仍待验收 |
| S02 | 部分完成 | `shared_metrics.status/set` 具名能力，写入时联动 enabled/send 并回读 Gateway 结果；隔离真实 Gateway 验证 beta Profile 收集同意和撤销、`send` 随撤销强制关闭、状态回读与 default Profile 隔离，原始配置写入了两个开关和 `offer_version` | 指标存储窗口协调、桌面门控及原生界面仍待验收 |
| S03 | 部分完成 | checkpoints 字段独立分组并走 Schema；新增按 Profile 读取 `/api/ops/checkpoints` 的已保存会话数和存储大小，调试页提供刷新及 `PREVIEW_ONLY` 标记；隔离真实 Gateway 测试通过 Profile 级配置写入/重读与检查点清单隔离。本机假模型先调用 `read_file` 再调用 `write_file`，确认 beta Profile 的工具操作自动创建检查点，随后用锁定 Hermes 的 `CheckpointManager` 从该检查点恢复原文件 | 锁定 fork 的 `rollback.list` 对 beta Profile 返回空列表，尽管 beta 检查点存储已有数据；需修复 RPC 的 Profile 作用域并复验 `rollback.list/restore`，原生窗口仍待验收 |
| V01 | 部分完成 | 语音对话字段、权限错误、录音资源清理及 `voice.max_recording_seconds` 上限已接入；Rust 宿主按连接/Profile 获取 `/api/audio/voice-config`，支持 openai-multipart、xai-stt、elevenlabs-stt、openai-speech、elevenlabs-tts 直连，relay 判定继续中转，提供方密钥不进入前端 | GPT Live 尚未接入；真实直连 STT/TTS、服务器专属提供方回退、Windows/macOS 原生音频实测 |
| V02 | 代码完成 | MediaRecorder → data URL → Profile 级转写 → 可编辑输入框；切 Profile/会话或卸载时释放采集资源并丢弃旧转写结果 | Windows/macOS 麦克风权限、超时和设备切换实测 |
| V03 | 部分完成 | Profile 级 TTS、播放/停止、`voice.auto_tts` 自动播报；新增 chained 静音检测、Profile 转写、带 `voice_turn` 的聊天提交、回复播报和再监听，停止或切换时释放麦克风与音频 | 连续对话的真实麦克风、STT、聊天、TTS 端到端验收；GPT Live 依用户后续方案再实施，系统输出设备切换待实测 |
| A01 | 代码完成 | 运行参数、工具、终端、输出限制和完整 YAML 分组；继续使用运行时 Schema；原始配置页可在 YAML 与完整 Schema 表单之间切换，未分组的运行时字段可从统一搜索进入该表单并筛选。调试预览的完整 YAML 保存不再是空操作，按 Profile 执行版本检查、解析和替换 | 高级原始配置的浏览器交互与各字段真实重启/新会话生效边界 |
| A02 | 部分完成 | 本机 localStorage 偏好、Wake Lock、F12；Tauri 宿主新增设备本地快捷键注册/持久化、冲突与无效键反馈、独立 640×168 输入窗、关联确认与主聊天发送路径。调试页已操作开关与快捷键保存，标注 `PREVIEW_ONLY` | Windows 锁屏阻止本轮原生快捷键呼出与真实聊天提交；macOS 原生行为仍待验收 |

## 本轮自动检查

本轮重复运行隔离 Gateway 用例发现：`read_file` 返回完整单行内容后，`write_file` 偶尔收到 `stale_write_blocked: true`，原因是 Hermes 将这次读取记为分页读取。测试假模型现遵循工具返回的建议，遇到该拒绝便改用 `patch`；连续两次隔离测试通过并完成检查点恢复。为何完整读取偶尔被记为分页仍待定位；详见[实际问题清单](hermes-fork-maintenance-request.md)。

- `pnpm verify:upstream`：通过，锁定提交一致。
- `pnpm --dir apps/frontend typecheck`：通过。
- `pnpm --dir apps/frontend build`：通过；Vite 仅报告既有的大 chunk 警告。
- `pnpm check:contracts`：通过。
- `pnpm check:architecture`：通过；当前登记 109 个原生命令、7 个事件，含辅助任务目录、快捷输入双窗口桥和 SSH 连接。
- `node --experimental-strip-types --test apps/frontend/tests/settingsSearch.test.mjs`：2 项通过，覆盖审批、检查点、压缩字段的表单定位，回退、辅助、MoA 字段的专用编辑页定位，其他 Schema 字段的高级原始配置定位，以及暂时隐藏的语音对话、Cloud 和 SSH 字段不会被搜索结果当作可编辑项；这不是浏览器点击验收。
- `node --experimental-strip-types --test apps/frontend/tests/delegationRoute.test.mjs`：4 项通过，覆盖路由改名时原名称与遮盖凭据引用、默认路由同步、编辑单行时保留其他路由及额外字段、旧式回退项转换与请求覆盖 JSON 校验。
- `node --experimental-strip-types --test apps/frontend/tests/previewProfileStore.test.mjs apps/frontend/tests/previewProviderSync.test.mjs`：4 项通过，覆盖调试预览的 Profile 数据隔离、提供商同步预览/应用、地址冲突拒绝自动覆盖和目标主模型标记保留；这不是浏览器点击或真实 Gateway 验收。
- 搜索定位同一设置子页时曾清除全局“未保存 Agent 配置”标记，即使草稿仍在表单；现在仅在实际切换子页并通过草稿确认后清除标记。跨子页导航原先可能再次要求确认且留下旧草稿，现由外层导航负责一次确认，内层切页时清理已放弃的字段、YAML 和辅助编辑状态。导航确认放弃后还会同步清除 Agent 与委派草稿标记，避免紧接着操作时重复确认。该修正已通过代码路径核对，浏览器交互仍待复验。
- `node --experimental-strip-types --test apps/frontend/tests/voiceConversationPolicy.test.mjs`：通过，覆盖静音等待、空闲重试和语音片段结束决策。
- `.build/hermes-venv-i1/Scripts/python.exe -m pytest tests/test_profile_gateway_live.py -q --tb=short`：通过；使用产品准备的隔离 Gateway 与临时 Profile 验证检查点配置、回退链、MoA 方案、委派模型路由及共享指标同意的写入/读回、拒绝或撤销语义与 Profile 隔离。主模型测试调用本机假模型端点，确认旧会话显式固定旧模型、新会话采用新 Profile 默认模型，另一 Profile 保持原值。回退测试让本机主模型端点返回错误、本机回退端点返回固定文本，确认两个端点均收到请求且会话完成事件与用量模型对应回退模型。辅助任务测试让 `llm.oneshot` 按 beta Profile 的 `title_generation` 路由请求本机假模型端点，确认返回内容和模型 ID。MoA 测试在 beta Profile 写入方案和自定义假端点，以 `moa` 虚拟提供商创建会话并提交提示，确认参考模型 `reference-canary`、聚合模型 `aggregate-canary` 都被请求，最终回复来自假端点。压缩测试连续提交三轮，确认主模型与摘要模型均被请求，所有轮次成功且用量中的压缩次数大于零。检查点测试让本机假模型实际调用读写文件工具，确认 beta Profile 自动生成检查点并通过锁定 Hermes 的管理器恢复文件；`rollback.list` 的跨 Profile 缺陷另列于 S03。以上均未调用真实模型；共享指标测试只打开本地收集后撤销，没有授权上传。`pytest` 只安装在忽略的开发虚拟环境中。
- 同一隔离 Gateway 用例新增真实审批轮次：beta Profile 以 `manual` 模式分别收到受保护文件写入审批；回答 `deny` 后文件保持原值，回答 `once` 后文件被修改。另一条只删除临时测试文件的命令加入 beta 的 `command_allowlist` 后无需审批并实际执行；default Profile 对同一命令仍要求审批，拒绝后文件保留；从 beta 撤销规则后再次要求审批。测试以本机假模型触发工具，不等于原生窗口审批卡验收。
- `node --experimental-strip-types --test apps/frontend/tests/providerIdentity.test.mjs`：4 项通过，含保存提供商与模型目录旧 `is_current` 标记不一致时的显示回归。
- `node --experimental-strip-types --test apps/frontend/tests/*.test.mjs`：当前工作树 45 项通过、0 失败；这不构成浏览器交互或原生窗口验收。此前一次运行中 Vite 依赖扫描打印过开发服务重启的瞬时告警，测试最终退出码仍为 0。
- `node --experimental-strip-types --test apps/frontend/tests/previewRawConfig.test.mjs`：2 项通过，覆盖原始 YAML 预览保存后的 Profile 隔离、旧版本拒绝及无效 YAML 不改数据。
- `cargo test --locked --offline --manifest-path apps/desktop/src-tauri/Cargo.toml`：96 项通过、5 项按环境条件忽略；包含快捷键语法、直连语音、Unicode 连接名称、SSH 隧道参数及注册表测试。
- `cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml`：通过。
- `cargo check --locked --offline --manifest-path apps/desktop/src-tauri/Cargo.toml`：通过；只有既有 dead-code 警告。
- `pnpm build`：桌面 TypeScript、Vite 构建及资源检查通过；Vite 仅报告既有的大 chunk 警告。
- `pnpm --filter @hermess/frontend build` 与 `pnpm --filter @hermess/desktop build`：通过，桌面产物含 `quick-entry.html`，资源检查未发现 source map。

## 调试页检查

本轮尝试复验 `?settings=security.approvals`：本地调试服务对该地址返回 HTTP 200；应用内浏览器控制返回 `browser.user is unavailable`，随后自动审批拒绝启动隐藏的无头 Chrome 进程。因此没有取得本轮可核实的渲染或交互结果，S01 新增的真实审批行为证据来自隔离 Gateway 测试，不能写成调试页已操作。

浏览器调试页 `?settings=security.checkpoints` 已显示 Profile 级检查点存储状态、刷新按钮和 `PREVIEW_ONLY` 标记；刷新交互已检查。真实 Gateway 的工具写入和检查点恢复由隔离测试验证，调试页本身仍只显示模拟数据。浏览器预览已检查统一设置窄窗口布局、Profile 选择、提供商同步的冲突预览与应用结果、MoA 结构化编辑。预览不请求麦克风/通知系统许可，也不作为原生能力验收。Windows/macOS 原生窗口、真实模型、真实 OAuth、系统通知及麦克风/TTS 仍需分别记录。

`?settings=model.main` 在浏览器调试页已核对主模型选择与保存后回读、Profile 切换后的显示；720×900 窄窗口中分类导航横排，主模型表单完整可见。此预览的主模型数据来自 `PREVIEW_ONLY` mock，真实 Gateway 的会话生效边界由上述隔离测试单独验证。

`?settings=model.auxiliary&previewStaleAux=1` 在浏览器调试页显示一条固定到其他提供商的辅助任务提示；对应卡片显示实际固定路由，编辑为“跟随主模型”并保存后提示消失。另一次预览将主模型切换到同一提供商，再返回辅助模型页，提示也随重新读取消失。真实 Gateway 的 `/api/model/auxiliary` 已在隔离测试中核对 beta/default Profile 的任务路由隔离和 `local_endpoint` 判定；原生窗口仍待复验。

旧调试地址 `?settings=voice.conversation` 现在显示语音分类的转写与播报导航，不再显示语音对话子页；`?settings=gateway.connection` 只显示本地运行时与存储。两项已在浏览器调试页读取实际页面结构核对。未知子页地址会回到该分类首个可见子页。

此前调试页曾显示 SSH 连接表单并以虚构令牌检查保存交互；用户随后要求隐藏远端服务和 SSH 界面，因此当前 `?settings=gateway.connection` 已回退到本地运行时与存储，不能再将旧表单截图视为当前界面。Rust 宿主的 SSH 隧道路径仍未通过真实主机验收。

高级设置 `?settings=advanced.desktop` 已在浏览器调试页操作系统级快捷输入开关、改为 `CommandOrControl+Shift+K` 并应用；页面继续标注 `PREVIEW_ONLY`。独立输入页按 640×168 视口核对了标题、文本框、发送键和状态行。Tauri 新宿主进程启动后，Windows 锁屏阻止了原生窗口交互；因此未把快捷键注册、呼出、提交与隐藏记为原生验收。

回退模型行编辑器已在浏览器调试页核对：现有回退行显示提供商和模型，新增半填行时保存按钮禁用，移除后恢复。委派路由的默认/模型/Profile 三模式在调试页显示；切到模型路由后显示命名路由编辑和默认路由。两项仍需锁定 Gateway 真实读写及行为验收。

本轮补齐语音录音上限、会话切换期间的麦克风及异步转写清理、过期自动播报隔离和手动播报停止状态。前端类型检查、构建及架构检查通过。麦克风权限、真实转写与音频输出仍须在原生窗口操作；浏览器调试页只可检查界面状态。

对照锁定上游 `GET/POST /api/providers/custom-endpoints` 修正提供商同步：原先只复制默认模型，且同名覆盖可能沿用目标端旧密钥；现复制列表接口可提供的模型目录、`api_mode` 和 `context_length`，写入空密钥清除目标凭据。仅同名项可在显式选择后覆盖；同 URL 异名项仍报冲突。新增密钥清除与公开字段复制测试；Rust 格式、离线编译及全量测试通过（73 项通过、5 项条件忽略）。上游列表只暴露模型 ID，模型别名的详细元数据不在同步范围内。

新增 URL 令牌模式的真实连接测试入口：Rust 校验并规范化 URL，通过公开状态接口识别 OAuth，再用同一令牌请求受保护的 `/api/profiles`，最后对 `/api/ws?token=` 发 RPC ping，收到 pong 才报告通过。测试不保存或应用连接，浏览器预览明确拒绝真实测试。使用本地假 HTTP/WS 服务验证完整通路、错误令牌拒绝，以及 URL 规范化；全量 Rust 测试 77 项通过、5 项条件忽略。真实远端服务与原生窗口仍待验收。所有其他网关子项继续按上表保留未完成状态。

浏览器预览现可通过 `?settings=gateway.connection` 直达该页；Chrome 无头截图确认导航、表单、说明在 1440×900 下可见。该截图只证明布局渲染，未提交令牌或操作原生窗口。尝试启动隐藏的浏览器调试进程以执行交互时，自动审批拒绝了进程启动，因此未将交互列为已验收。

本轮加入宿主连接注册表与系统凭据库：URL 连接在再次探测成功后写入独立摘要文件，令牌按连接 ID 与规范化 URL 的摘要存入 Windows Credential Manager/macOS Keychain；删除时清除两处，元数据写失败尝试回滚凭据。Windows 上用随机测试 ID 完成凭据写入、读取、地址不匹配与删除测试；注册表文件读写和重复地址边界由单测覆盖。`?settings=gateway.connection` 与 `?settings=gateway.saved` 两页在 1440×900 Chrome 截图中可见。macOS 交叉编译被本机缺少 Apple Clang/SDK 阻断，不能算 macOS 验收。保存的连接尚未应用到聊天、设置或事件流。

远程 WebSocket 传输已在 `GatewayClient` 与本地私有票据传输之间分开：本地继续要求服务端确认桌面子协议，远程令牌 URL 不要求本地私有票据，并以 `desktop_local=false` 声明客户端能力。连接探测和后续传输共用 URL 路径、WS/WSS 与令牌编码逻辑；前缀路径及特殊字符编码由测试覆盖。当前远程传输没有接入保存连接的“应用”操作；全局事件、Profile、配置及会话仍只属于本地实例，不能以该传输函数存在推断远程连接已可用。

本次增量检查：`cargo fmt --check`、`cargo check --locked --offline`、`cargo test --locked --offline` 与 `git diff --check` 通过；Rust 测试 81 项通过、5 项条件忽略。编译器提示新增的 `connect_remote` 尚无调用方，这与活动连接路由仍未接入的状态一致。

网关事件、审批请求和断线信号现由宿主附带连接身份；本地身份为 `local`，远程传输接口只接受 UUID。聊天与桌面通知只处理当前 `BackendInfo.connection_id` 的实时事件，避免未来切换连接时旧 WebSocket 的推送进入当前界面。后端信息、事件及请求 Schema、契约样本、预览 mock 与原生序列化测试已同步。Profile/配置/会话请求尚未绑定远程 UUID，因此 G01-G03 仍为部分完成。

宿主新增对已保存 URL 连接的应用准备：按 UUID 从注册表取摘要，按绑定目标从系统凭据库读令牌，重新运行 HTTP/WS 探测，然后建立长期 Gateway WebSocket、读取并校验 Profile 列表；任一步失败均保留旧活动远程客户端。成功后宿主持有 UUID、目标、令牌和客户端，活跃条目不能删除。该命令虽已进入宿主契约，前端调试页尚未提供按钮，且聊天、设置与事件请求尚未切到该客户端，因此不能宣称“立即应用”完成。

后续增量已把上述命令接入 `?settings=gateway.saved`：调试页可连接已保存 URL 或切回本地；切换时提示未保存的 Agent/个人文件草稿并清理旧聊天和模型工作区。宿主聊天 RPC、Profile 列表、主模型和提供商配置、通用配置 HTTP、记忆 OAuth、委派、共享指标与音频接口按活动连接路由；远程 HTTP 保留网关路径前缀并追加且校验 `profile`，请求前后核对连接 UUID 与客户端指针。旧本地 Profile 解析在远程模式下拒绝，避免写入本地实例。远程会话创建不传本机工作目录，本机路径附件明确拒绝。上述为代码路径，尚无真实 URL 网关会话和原生窗口验收。浏览器预览使用 `PREVIEW_ONLY` 条目，1440×900 截图显示“连接 URL 网关”按钮及保存连接列表；预览调用会被 mock 拒绝，不证明真实切换成功。

补充验证：本地假 HTTP 服务检查远程配置请求的 `/prefix/api/config?profile=writer` 路径和 `X-Hermes-Session-Token` 请求头；Rust 全量测试 84 项通过、5 项条件忽略，前端/桌面构建、契约与架构检查通过。前端 Profile 工作区测试增加同一 Gateway epoch 下不同连接 UUID 的隔离，4 项通过。标题栏在远程状态显示连接名称；运行时页将本地启动、停止和重连按钮在远程状态禁用，避免把远端当本产品自有进程。真实连接切换、远程聊天和配置写入仍需原生窗口与远端服务验收。

远程聊天界面进一步隐藏本机工作区选择、文件附件和文件/终端面板，拖入本机文件不会加入远程草稿；切换连接时关闭已打开的文件/终端面板。用量统计的两条 HTTP 请求固定在同一个活动连接与 Profile 目标上，切换期间会拒绝过期结果。桌面构建重新通过；远程实际用量数据仍需真实服务验收。

补上前端调试热重载后的宿主状态恢复：`current_remote_connection` 只返回连接 ID、标签、Gateway 纪元与 Profile 摘要，前端初始化先读取宿主活动远端；若存在则恢复远端身份并跳过本地自动启动。已保存连接的活动行可主动重新连接。此只读查询不证明远端当前健康；断线后的重连与真实原生窗口热重载仍待操作。桌面构建与架构检查通过，原生命令清单现为 101 项。

调试预览以 `?previewRemote=1` 明确显示 `PREVIEW_ONLY` 远端聊天状态；1440×900 Chrome 一次性截图核对聊天区隐藏了本机附件与目录选择，侧栏工作区在远程状态禁用。该截图不证明远程会话成功。

通知桥从 WebView `Notification` 换成锁定版本 `tauri-plugin-notification`/`@tauri-apps/plugin-notification` 2.6.0：宿主注册插件与最窄通知权限；适配层先注册点击监听，再检查/请求系统权限并投递；点击目标只在活动连接 ID 一致时定位。前端按隐藏或失焦判断后台，完成提醒仅限当前会话，审批和补充信息可提醒其他会话，重复请求只提醒一次。设备设置页显示系统权限并提供请求按钮，浏览器 mock 明确拒绝真实投递。`?settings=notifications.alerts` 在 1440×900 预览截图中核对权限行与开关布局；前端类型检查、桌面构建、契约与架构检查、Rust 格式/编译及全量测试通过（84 项通过、5 项条件忽略），通知策略 2 项测试通过。Windows 的正式产品通知需在安装后的应用核对，macOS 也未在本机验证；桌面点击、权限、操作按钮及声音仍不得记为实机通过。[Tauri 通知插件文档](https://v2.tauri.app/plugin/notification/)说明 Windows 安装态要求，[2.6.0 发布记录](https://v2.tauri.app/release/notification/v2.6.0/)说明该版增加桌面点击/操作回调。

审批通知现注册中英双语的“允许一次/拒绝”原生操作按钮。点击后从本次通知绑定的连接、Profile、会话及 `srq-` 请求 ID 进入既有 `answer_gateway_request`，由 Gateway 校验待决请求；其他通知不提供审批操作。macOS 回调可能返回按钮标题而非 ID，因此适配层同时识别两种值，独立测试 1 项通过。未在原生窗口点击前不宣称操作按钮生效。
