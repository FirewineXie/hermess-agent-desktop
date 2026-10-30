# v0.1.8 通知扩展事件 N01

日期：2026-10-29。状态：七类通知的客户端实现及本地检查完成，Windows/macOS 原生投递与真实服务验收待完成。未修改 Hermes fork。

此前把 N01 的缺口归因于“锁定 Gateway 没有事件”不准确。锁定提交 `882037eb8745b505db438217513c4c94f95c93c1` 已有以下真实来源；缺口在产品 Rust 的事件转发白名单及前端消费路径。

## 来源与行为

| 通知种类 | 真实来源 | 产品行为 |
| --- | --- | --- |
| `backgroundDone` | `background.complete`，携带 `task_id/text`；其他会话的 `message.complete` | 后台子任务完成或其他会话结束时提醒；失败显示失败标题，主动中断不报完成 |
| `credits` | `notification.show`，`key` 以 `credits.` 开头 | 转发额度不足、用量/窗口预警、恢复等运行时消息；不从普通错误文本猜测额度状态 |
| `plugin` | `notification.show`，`key` 以 `plugin-message:` 开头 | 接收插件通过 `PluginContext.post_message` 发给本地会话的消息，包括同一消息的内容更新 |

锁定源码证据：`tui_gateway/contracts/events.py` 声明事件；`tui_gateway/methods_prompt.py` 发出后台子 Agent 完成；`agent/credits_tracker.py` 和 `gateway/run_turn_progress.py` 产生并投影额度通知；`gateway/plugin_messages.py` 为本地插件消息生成稳定通知键并发布事件。

Rust 仅新增转发 `background.complete`、`notification.show`、`notification.clear`，沿用会话所有权登记、Profile 绑定和载荷大小限制。先将扩展通知的文本截取为最多 1024 个字符，再执行 32 KiB 载荷检查，避免长任务或插件正文导致整条提醒被丢弃；最终系统通知正文最多 300 个字符，普通聊天事件不因此改变。未知会话所有者不生成可点击通知，避免错误跳转到当前 Profile。没有新增原生命令、后台进程或网络轮询。

前端通知设置现包含审批、补充信息、当前会话完成、当前会话失败、后台任务与其他会话、额度、插件七类独立开关。偏好仍为设备级；沿用当前产品偏好键，不读取旧 settings 分支的历史键。

扩展三类属于非阻塞提醒，只在窗口隐藏或失焦时投递系统通知，可以来自任一已知会话；审批与补充信息继续允许在前台提醒其他会话。当前会话的普通完成/失败仍使用原来的独立开关。通知点击复用原有宿主目标注册与回调，定位原 Profile/会话，不新增自动扣费、插件执行或其他操作按钮。

后台完成纳入已有完成提示音开关；额度、插件消息不播放完成提示音。`terminal.close` 仅代表终端标签关闭，没有任务结果，未将它当作后台任务成功事件。插件安装/升级也不会凭空产生插件通知，必须由运行时实际发布消息。运行时的诊断抑制配置或提供商本身不提供额度消息时，客户端不会轮询、推算余额或伪造提醒。

## 去重与撤销

- 后台任务按连接、Profile、会话和任务 ID 去重。
- 额度与插件按相同作用域下的通知键管理状态：同内容重发不重复提示，内容或等级变化可重新提醒，过期序号不能覆盖新状态。
- `notification.clear` 清除该键的活动状态并保留序号水位，之后真正的新状态可以再次提醒。此处清除的是客户端去重状态，不承诺撤回已经进入操作系统通知中心的历史横幅。
- 作用域历史最多保留 1000 项；网关纪元变化后重建，切换语言不会重建去重历史。页面隐藏/失焦及偏好只在事件到来时判断，不在回到后台或重新打开开关时补发旧消息。

## 验证

平台：Windows x64。测试输入均在测试代码中构造，没有使用真实余额或用户插件消息。

| 验证 | 结果 |
| --- | --- |
| 前端类型检查、桌面生产构建 | 通过；构建有既有体积提示 |
| `node --experimental-strip-types --test apps/frontend/tests/*.test.mjs` | 59 项通过；新增通知事件测试 6 项，覆盖任务去重、键状态、撤销/乱序、插件更新、未知所有者、后台条件及容量上限 |
| Rust 格式与全量单测 | 100 项通过、5 项按环境忽略；新增事件白名单与长文本截取测试 2 项 |
| 架构、契约、生成契约、锁定上游校验 | 通过 |
| 准备好的 Hermes Python 运行 `tests/notification-producers.py` | 2 项通过，直接调用锁定运行时本地插件发布函数，验证会话、键、编辑及未连接观众结果 |
| 锁定上游 `test_credit_producer_suppression.py`、`test_background_thread_profile_scope.py` | 8 项通过 |
| 锁定上游 `test_plugin_post_message.py` | 标准 pytest 首次因缺少 pytest-asyncio 无法执行 5 个异步用例；随后通过仅位于忽略目录的 asyncio 执行适配器实际运行，5 项通过，未修改上游文件或安装依赖 |
| `scripts/smoke-gateway.py --python <准备好的 Hermes Python>` | 普通 Gateway 冒烟通过；假 HTTP 服务连接关闭时有连接中止/重置日志 |
| `settings-capabilities-preview.html?notifications` | PREVIEW_ONLY：使用生产通知 Hook，重复事件仅记录一次、额度撤销后重发、开关阻止投递及点击定位已操作检查；不投递真实系统通知 |

Windows 开发客户端已由现有开发 watcher 重新编译运行，后台已记录 `backend_ready`。上述检查不等同 Windows/macOS 系统横幅、真实插件会话、真实额度服务和通知点击的端到端验收。原生通知桥未改动，继续分别使用 Windows WinRT 与 macOS Tauri 通知适配。
