# 桌面 `/handoff` 的锁定 Gateway 边界

日期：2026-10-30。适用锁定 fork：`882037eb8745b505db438217513c4c94f95c93c1`。本文是客户端无法直接完成会话移交的证据和接口提案，不是修改 fork 的授权。用户已决定暂不修改 fork，`/handoff` 继续禁用；以下提案仅供今后重新评估。

## 当前接收方事实

- Hermes Desktop 的输入处理会调用 `handoff.request`，再轮询 `handoff.state`，超时尝试 `handoff.fail`（`upstream/hermes-agent/apps/desktop/src/app/session/hooks/use-prompt-actions/index.ts`）。
- 这些 RPC 当前只在旧 `tui_gateway/methods_session.py` 注册。Hermes Desktop 的 `api/canonical-protocol.ts` 把它们列为 sidecar 专有会话方法，并说明 owner 会话不在 sidecar 的会话表中，调用会得到 `session not found`。
- 本产品的聊天由 `gateway/session_controls.py` 中的 owner authority 管理。其方法表接入了 `session_ancillary`、`session_tui_ops` 等，但没有接入 `handoff.request/state/fail`；`gateway/session_commands.py` 对本地会话的 `/handoff` 明确返回从经典 CLI 执行的提示。因此不能把 `/handoff` 加入现有 `slash.exec` 白名单，也不能只移植 Hermes Desktop 的前端调用。
- 隔离的锁定 Gateway WebSocket 用真实桌面会话 ID 请求 `handoff.request {session_id, platform: "telegram"}` 返回错误；`scripts/verify-composer-gateway.py` 将此作为当前接收方拒绝路径核对。该测试没有发送消息平台内容，也没有修改用户 Profile。
- `gateway/run_adapters.py` 已有按 Profile 扫描持久化移交请求并执行转移的 watcher。缺口是 owner 会话能够安全写入、查询和撤销同一 Profile 的移交请求的入口。

## 建议的最小 fork 接口范围

在 owner authority 所属模块增加 `handoff.request`、`handoff.state` 和 `handoff.fail`，复用既有数据库移交状态及 watcher，不改消息平台发送器。请求须绑定已附着的当前 Profile 和会话；`request` 在回合运行中拒绝，验证目标平台已启用且有 home channel，并只对该会话创建持久化待处理请求。`state` 仅返回该会话的目标平台、状态和非敏感错误；`fail` 只能将仍为 `pending` 的请求置失败，不覆盖 watcher 已领取的 `running/completed` 状态。三种方法都应检查会话归属与能力，并明确重复请求、断连重试和 Gateway 重启后的响应。

fork 变更须在独立分支实现、独立代码审核并经 PR 合回维护分支，然后更新产品锁文件。产品侧再接 `/handoff <platform>` 的目标候选、操作状态、失败与结果不明恢复；用与 Rust 生产请求相同的形状对锁定 Gateway 验证成功、忙碌、未知/未配置平台、跨 Profile、重复请求及超时状态。Windows/macOS 原生窗口分别验收。当前开发分支继续拒绝 `/handoff`，不宣称已实现。
