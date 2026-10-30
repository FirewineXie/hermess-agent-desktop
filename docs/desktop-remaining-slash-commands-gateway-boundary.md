# 剩余桌面命令的 Gateway 边界与改动提案

日期：2026-10-30。依据本仓库 `runtime/upstream.lock.json` 锁定的 fork 提交 `882037eb8745b505db438217513c4c94f95c93c1`，基于官方 `v0.22.5`（`bf0203a794a07aac3ff764972ab9087baa4e4f4e`）。最初用户决定暂不修改 fork，`/bg` 与 `/rollback` 保持禁用；随后授权仅在客户端接入 `/bg` 提交与右侧结果标签。此文描述 `/bg` 完整任务管理与 `/rollback` 安全恢复仍缺的 Gateway 接口，不是 fork 改动授权。

## 当前剩余范围

`/bg` 的提交与完成结果展示已另行接入客户端；本提案仍适用于单任务查询、取消和重启后终态恢复。`/rollback` 仍禁用。其余标记为“禁止桌面执行”“改用界面操作”或“暂不接入”的命令不在本批开发范围。现有桌面 `/stop` 只停止主回合，不等于取消 `/bg` 任务。

## 已核实的接收方行为

### `/bg`

- `gateway/session_tui_side.py` 的 `prompt.background` 校验已附着会话、提交权限、非空 `text`，返回 `bg_*` 任务 ID；独立 agent 在后台运行，完成后只向父会话事件流发布 `background.complete {task_id,text}`。父会话历史不追加该回合。
- 运行中任务只在进程内 `_side_agents` 字典中按线程记录；`session_runtime_workers.py` 的中断函数只供整个运行时退出或 Profile 退役使用。当前 Gateway 没有按父会话和任务 ID 查询、取消后台任务的 RPC。
- `session.interrupt` 处理普通会话执行，不接受 `bg_*` 作为其独立任务目标。父会话事件流重放能覆盖窗口内事件，但不能证明 Gateway 重启后仍有可查询的任务终态。因此仅用桌面内存列表接入 `/bg` 会缺失取消和重启恢复。
- Windows 隔离 Gateway WebSocket 实测：`prompt.background` 返回 `bg_*`，父会话收到 `background.complete`，父历史仍为零条；把该任务 ID 传给 `session.interrupt` 返回 `4001 not_found`。本测试只证明当前接收方行为，不是产品侧功能验收。

### `/rollback`

- `gateway/session_tui_ops.py` 已提供 `rollback.list`、`rollback.diff`、`rollback.restore`。它按会话冻结的工作目录和 checkpoint 配置选取存储；容器后端的宿主检查点恢复会拒绝。完整目录恢复要求主回合空闲，成功后还会回退最近一轮会话历史。
- `rollback.diff` 的差异正文截断为 4000 字符。当前响应没有结构化的“将恢复、将跳过、将删除”文件清单，也没有供确认后恢复使用的文件状态栅栏。
- 现有 `CheckpointManager.restore(safe=True)` 在代理写入 ledger 为空时回退到完整目录恢复，可能覆盖用户手工修改；传入单文件路径时也不使用 `safe=True` 的手工修改保护。桌面方案要求明确列出覆盖范围并保留手工修改，直接调用当前恢复接口不能保证这一点。
- Windows 隔离目录复现：先保存含 `checkpoint version` 的检查点，再手动改为 `user edit`，不记录代理写入；`_safe_restore_plan` 返回 `ledger_empty=True`，`restore(safe=True)` 返回成功后文件变回 `checkpoint version`，`skipped_user_edits` 为空。测试主断言已打印结果，但临时 Hermes 运行时的租约文件短暂被占用，脚本在清理临时目录时以 WinError 32 退出；不把该进程退出码记作完整测试通过。
- 恢复先改文件，随后回退会话历史；如果后一步失败，文件和历史可能不一致。桌面应显示部分成功并提供可恢复的信息，不能把它当作原子操作。

## 拟议的 fork 最小接口改动

1. 为后台任务增加按 Profile、父会话和 `task_id` 授权的 `background.list` 与 `background.cancel`。列表至少返回任务 ID、父会话、提交时间、状态和可用的终态摘要；取消仅作用于该任务的 agent。终态记录应能跨 Gateway 重启查询，避免桌面把丢失事件误判为仍在运行。继续沿用 `background.complete` 事件显示结果。
2. 为检查点增加只读的 `rollback.plan`：解析并校验目标 checkpoint，返回完整的恢复、删除、跳过手工修改和无法安全判定的相对路径清单，以及工作目录、目标 hash 和计划版本。ledger 不足以判断文件归属时明确拒绝安全恢复。
3. `rollback.restore` 增加仅接受计划版本的安全恢复模式：执行前重新核对工作目录、目标 hash 与相关文件状态；过期则拒绝并要求重新预览。桌面不开放 `--all` 或无保护的单文件恢复。恢复结果分别报告文件操作与会话历史回退结果。

以上仅为接口范围，不修改官方行为或 fork 本身。若获批，先在 `hermess-desktop` 的独立功能分支开发，经独立审核和 PR 合入维护分支后，再更新产品锁文件及桌面契约、宿主适配和界面。不得在产品构建中直接改 `upstream/hermes-agent`。

## 产品侧完成标准

- `/bg`：主回合运行中可提交；有跨会话可见的任务列表、完成/失败通知、单任务取消、断连与 Gateway 重启后的状态恢复；无会话、空输入及跨 Profile 操作被拒绝。
- `/rollback`：先选 checkpoint 并展示完整文件计划与冲突，再确认执行；手工修改和未知归属文件保持原样，过期计划拒绝；文件与历史的结果分别显示。无可验证 checkpoint、非自有工作区或不支持的容器后端拒绝。
- 两项均需用与桌面生产请求一致的形状向锁定 Gateway 验证成功及关键拒绝；Windows/macOS 原生窗口另行验收，不能由单平台构建代替。
