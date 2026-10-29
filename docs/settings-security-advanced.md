# v0.1.8 安全设置与高级配置整合

更新日期：2026-10-29。状态：客户端实现及本地检查通过，未发布；Windows 原生真实配置流程及 macOS 实机待验收。

## 页面与配置归属

统一设置新增两个 Profile 级分类，切换时保护未保存草稿及保存中的请求。

| 分类 | 子页 | 配置来源 |
| --- | --- | --- |
| 安全 | 审批与允许列表 | `approvals.*`、`security.approval.*`、根字段 `command_allowlist` |
| 安全 | 隐私与安全 | 其余 `security.*`、共享指标配置与专用同意接口 |
| 安全 | 检查点 | `checkpoints.*` 与只读 `/api/ops/checkpoints` 存储清单 |
| 高级 | 运行参数 | 其余 `agent.*`；主模型推理强度、请求速度及工具执行策略归已有专用页 |
| 高级 | 工具 | `toolsets`、`toolsets.*`、`tools.*`、`agent.tool_use_enforcement` |
| 高级 | 终端 | `terminal.*`，按当前平台的运行时 Schema 展示 |
| 高级 | 输出限制 | `tool_output.*` |
| 高级 | 完整配置 | 未分配字段的 Schema 编辑器、所有专用/受限字段目录及完整 YAML |

字段归属由 `configuration/model.ts` 统一决定。模型、委派、MoA、记忆及上下文的字段保留在已有专用页；完整 Schema 目录提供跳转，不增加重复编辑表单。敏感字段和客户端未知类型不进入通用表单，仍能在完整目录中发现。完整 YAML 是显式的整份文档编辑入口，包括专用页管理的配置；直接改共享指标原始键不等于通过专用同意流程记录选择，应使用隐私页保存同意状态。

`AgentSettingsView`、`useAgentSettingsController`、独立 `agent` 页面状态和 Profile 内嵌 Agent 编辑器已删除。Profile 概览改为跳转统一运行参数/工具页。字段树、类型/翻译辅助函数与 YAML 输入组件继续复用；没有旧路由别名、旧状态迁移或双写逻辑。未修改锁定 Hermes fork。

## 保存与失败行为

- 普通字段：校验 Schema/类型后按当前 Profile 保存，重新读取 Schema 与实际配置核对；不一致保留草稿并明确报错。
- 允许列表：逐行增删改，提交整个字符串数组，包括清空为 `[]`；不把新行追加到旧值。
- 对象字段：客户端适配层读取原始文档并准确替换对应子树，再经完整文档接口保存，避免运行时普通配置接口的深合并保留已删除键；其他配置段保留。
- YAML：仅切换 YAML 模式才读取原文；保存前确认，Rust 限制 256 KiB、要求根节点为映射，拒绝重复键及无效 YAML。提交前重新读取原文，发现外部改动则拒绝覆盖。提交后读取实际文件，补齐同一份运行时默认值后做语义比对，包含未知字段、空值及删除效果。
- 运行时会重写 YAML 格式、注释并省略默认值，不能承诺原始文本逐字保留。客户端的同类字段/YAML/同意写入串行化；上游接口没有原子比较并交换，读取检查与写入之间的外部并发修改仍无法彻底排除，其他专用配置写入也不因此获得全局事务保证。
- 请求按页面/Profile/连接生命周期隔离；保存中禁用编辑及离开，失败保留草稿。重新读取、切换模式、切页及切 Profile 均有未保存修改保护。修复 React StrictMode 重复挂载时共享指标读取被旧请求阻塞的问题；重复点击当前页或当前 Profile 不再清除未保存标记。

共享指标通过 `/api/shared-metrics/consent` 读写并回读核对 `enabled/send/decided`，关闭收集同时关闭发送；尚未作选择时即使两个开关均关闭，也能明确保存拒绝。外部管理的配置不可在此编辑。受同意流程管理的三个键不进入通用 Schema 表单。

检查点清单只展示当前 Profile 的会话目录、文件数与占用；清单为空、加载中及请求失败分别显示。没有接入恢复、清理或删除按钮；锁定上游非默认 Profile 的 `rollback.list` 已知问题没有添加兼容逻辑。

## 实际验证

平台：Windows x64。以下结果不等于双平台原生验收。

| 检查 | 结果 |
| --- | --- |
| `pnpm --dir apps/frontend build` | 类型检查及生产构建通过；有体积提示 |
| `node --experimental-strip-types --test apps/frontend/tests/*.test.mjs` | 53 项通过，其中新增配置归属/类型/列表测试 3 项 |
| `pnpm --dir apps/desktop build` | 桌面类型检查、混淆构建与资源检查通过 |
| `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check` | 通过 |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | 98 项通过、5 项按环境忽略；新增 YAML/替换/默认值比对 3 项 |
| `pnpm check:architecture`、`pnpm check:contracts`、`pnpm check:generated-contracts` | 通过，103 个宿主命令、8 个事件 |
| `pnpm verify:upstream` | fork `882037eb8745b505db438217513c4c94f95c93c1` 与官方 v0.22.5 基线校验通过 |
| 使用准备好的 Hermes Python 运行 `tests/settings-runtime.py` | 实际锁定运行时的 Schema、Profile 字段/列表隔离、YAML 删除键/整段、同意状态与检查点清单隔离通过；仅使用临时测试目录 |
| 同一 Python 在锁定上游运行 `test_web_server_approvals_broadcast.py`、`test_shared_metrics_consent_windows.py` | 25 项通过 |
| `scripts/smoke-gateway.py --python <准备好的 Hermes Python>` | 自有网关、鉴权拒绝、流式聊天、附件、重连、中断、历史、文件工具、澄清和拒绝审批通过；假 HTTP 服务退出时有连接重置日志 |
| PREVIEW_ONLY 页面交互 | 列表保存回读、Profile 隔离、首次拒绝同意、运行参数保存、取消离开保留草稿、Schema 目录、YAML 失败保留草稿、StrictMode 同意读取及 720px 布局已核对 |

Windows 本地开发客户端已重新编译运行，使用独立开发标识和开发数据根，与已安装版本隔离；确认开发窗口存在、进程响应及 `backend_ready`。真实审批策略执行、配置重启后生效、完整原生窗口操作与 macOS 尚需用户调试，不记为验收通过。安装包未构建、未创建 PR/tag。

## 本地调试顺序

1. 打开“Hermess v0.1.8 本地调试”，进入设置选择测试 Profile。
2. 安全 → 审批与允许列表：编辑规则，保存后切页返回确认；测试删除所有规则。
3. 安全 → 隐私与安全：保存共享指标选择，重新读取；检查关闭收集会关闭发送。
4. 安全 → 检查点：检查当前 Profile 的配置和存储清单，切另一个 Profile 对比。
5. 高级 → 运行参数/工具/终端/输出限制：修改测试字段，检查回读；需要时新建会话或重启运行时验证实际行为。
6. 高级 → 完整配置：检查专用页跳转，编辑 YAML，分别验证取消、保存、外部改动冲突与失败后的草稿保留。
