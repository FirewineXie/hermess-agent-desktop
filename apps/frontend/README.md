# 前端项目

React 界面代码位于 `src/`。桌面客户端通过 `mountApp(root, api)` 注入宿主能力；浏览器预览使用明确的模拟实现，不连接真实 Hermes，也不代表原生窗口验收。

## 当前结构

- `src/public.tsx`：公开装配入口。
- `src/App.tsx`：页面装配、导航及跨页面协调。
- `src/features/`：各 View 的控制器在所属功能目录。聊天的会话、事件补发、审批、附件状态在 `chat/useChatController.ts`；模型配置与选择在 `models/useModelController.ts`；运行时启动与存储状态在 `runtime/useRuntimeController.ts`；客户端集成工具的应用级清单、安装和本机探测状态在 `tools/useToolsController.ts`；Agent 配置读写、草稿与保存状态在 `agent-settings/useAgentSettingsController.ts`。各功能组件留在所属目录。
- `src/app/DesktopContext.tsx`：宿主能力注入。
- `src/features/models/components/ProviderCard.tsx`：提供方模型清单和本地编辑状态。
- `src/features/agent-settings/components/`：配置字段、分组树、辅助模型任务卡片与完整 YAML 编辑器；View 组合组件并呈现控制器状态。
- `src/features/settings/`：统一设置壳层、分类/子页导航、按当前 Profile 运行时 Schema 定位字段的设置搜索、设备偏好和共享指标；各业务读写仍由所属 feature 与 `DesktopApi` 具名能力负责。
- `src/features/notifications/`、`src/features/voice/`：设备本地通知偏好与 Gateway 事件映射，以及 Profile 级录音转写、TTS 试听和自动播报。
- `src/features/about/`：「关于」四个 Tab、RC/正式版渠道偏好及纯版本比较规则；无可信发行源时不报告更新结果。
- `src/features/channels/`：飞书和微信二维码、扫码状态及接入后的排空重启；其他 Hermes 消息渠道显示只读状态。超时后提供继续等待和确认强制重启，凭据不进入前端状态。
- `src/features/workspaces/`：本地工作区目录快捷入口、当前新会话目录选择；选中的目录在创建新会话时传给桌面宿主，恢复旧会话不改其原目录。
- `src/preview/`：浏览器预览的模拟宿主。
- `src/locales/`：界面文案与 Agent 配置翻译。
- `tests/`：前端纯逻辑测试，与 `src/` 中的产品代码分开。

## 本地命令

从仓库根目录运行 `pnpm install --frozen-lockfile` 后，可使用：

```sh
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend build
pnpm --dir apps/frontend test:recovery
pnpm --dir apps/frontend dev
```

预览地址为 `http://127.0.0.1:1421`。生产桌面 UI 由 `apps/desktop` 装配和构建。前端源码不得直接导入 `@tauri-apps/*`，也不得使用原生命令或事件字符串；通过 `DesktopApi` 的具名能力调用宿主。

浏览器预览可用 `?settings=gateway.connection`、`?settings=gateway.saved`、`?settings=notifications.alerts` 等分类和子页 ID 直接打开指定设置页，便于截图和布局调试；`?previewRemote=1` 只模拟 `PREVIEW_ONLY` 远程连接的界面状态。参数只由预览入口与模拟宿主读取；预览不执行远程连接、系统凭据、原生通知或系统权限操作。
