# 设置迁移中发现的 Hermes fork 实际问题

状态：仅列问题及待审查的修复范围；尚未获批修改 fork。产品锁定提交仍为 `882037eb8745b505db438217513c4c94f95c93c1`，本文件不改变锁文件或 fork 源码。

## 已复现的问题

| 编号 | 操作与预期 | 实际结果 | 影响 |
| --- | --- | --- | --- |
| M06 `/moa` 单次命令 | 在 beta Profile 的已建立普通会话执行 `slash.exec` 的 `/moa Answer this one-shot canary`，将返回的 `type: send` 消息提交；聚合轮次结束后再提交普通消息，预期恢复原模型和端点 | 聚合轮次请求了 `reference-canary` 与 `aggregate-canary`，且完成回答。下一轮普通消息的 `message.complete.status` 为 `error`，错误文本包含 `custom didn't respond in time`；裸 `custom` 和命名 `custom:moa-canary` 均复现 | 用户使用一次性 MoA 后，原会话后续普通对话不可用 |
| S03 `rollback.list` | beta Profile 的假模型实际调用 `read_file` 和 `write_file`，生成检查点；同一会话调用 `rollback.list`，预期列出该快照 | beta 的 `CheckpointManager.list_checkpoints(workspace)` 返回非空，且可把文件恢复为原内容；Gateway 响应为 `{"enabled": true, "checkpoints": []}` | 设置页无法依靠 Gateway 提供的清单选择并恢复 beta Profile 的检查点 |

两项均通过 `tests/test_profile_gateway_live.py` 使用产品准备的隔离 Gateway、临时 Hermes Home 和本机假模型端点复现。M06 的失败双轮实验和 S03 的失败 RPC 断言没有当作常规通过项留在测试里；撤回诊断断言后，既有隔离测试有通过记录，但下述不稳定性仍未解决。这是当前锁定版本的 Windows 本机证据，不是对真实模型或 macOS 的验收。

另有一项**检查点测试波动，已查明拒绝原因**：重复运行时，`read_file` 返回单行完整内容，但 Hermes 偶尔将该次读取标成分页读取；随后 `write_file` 返回 `stale_write_blocked: true`，提示改用 `patch`，所以目标文件保持 `ORIGINAL`。这不是“写入成功却丢失”的证据，也不能直接认定为 fork 缺陷。测试假模型现按工具提示在该拒绝后改用 `patch`，连续两次隔离测试通过；为何完整读取偶尔被记为分页读取仍待单独定位。

## 代码定位与尚待验证的原因

- **M06：**`tui_gateway/methods_tools.py::_cmd_moa` 记录原 `model`、`provider` 和 `model_override`；`tui_gateway/prompt_turn.py` 在轮次后用模型名和提供商再次调用 `_apply_model_switch`。原端点、API 模式和完整 live agent 运行时没有随这个记录保存。代码中已有 `_snapshot_agent_model_runtime` / `_restore_agent_model_runtime`，但 `/moa` 未用这条快照恢复路径。该差异与复现结果吻合；具体失败调用目标仍需在 fork 修复测试中记录。
- **S03：**`tui_gateway/methods_tools.py` 的 `rollback.list`、`rollback.restore` 使用 `_rpc`；该装饰器转到 `scoped=False` 的 `_guarded`。`session_registry.py::_with_checkpoints` 直接使用会话 agent 的检查点管理器。缺少 Profile 作用域是明确的代码差异；它是否为唯一原因，需在加作用域后的双 Profile 回归测试中确认。

产品前端只能发送 `slash.exec`、`prompt.submit`、`rollback.list/restore` 并显示结果，不能可靠修复 Gateway 内部已经切换的 live agent 或猜测缺失的 checkpoint hash。

## 待审批的修复范围

- 在 fork `hermess-desktop` 的独立修复分支中，让 `/moa` 保存 live agent 的完整模型运行时快照，单次轮次结束时恢复原模型、提供商、端点、密钥来源、API 模式及原会话覆盖状态；冷会话首次构建也要验证。复用 fork 现有的 `_snapshot_agent_model_runtime` / `_restore_agent_model_runtime` 路径或等价既有机制，避免另建一套模型切换状态。
- 将 `rollback.list`、`rollback.restore` 改为会话所有者的完整 Profile 作用域，保持现有 busy、参数和安全拒绝语义。检查其他同类检查点 RPC 是否共用未绑定入口。
- 在 fork 测试中添加失败先行的双轮 MoA 测试和双 Profile 检查点清单/恢复测试；通过 fork 规定的检查与独立代码审核后提交 PR，不直接合入维护分支。PR 合入后更新产品锁定 SHA、复验 `pnpm verify:upstream` 和产品隔离 Gateway 测试。

## 边界

不改 Hermes 官方版本、不接触用户默认 Hermes 安装、不改变模型密钥进入前端的规则。此申请只覆盖上述两项已经用产品真实 Gateway 路径复现、且无法由客户端可靠修复的行为。
