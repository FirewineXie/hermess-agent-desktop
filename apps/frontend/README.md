# 前端项目

React 界面代码位于 `src/`。桌面客户端通过 `mountApp(root, api)` 注入宿主能力；浏览器预览使用明确的模拟实现，不连接真实 Hermes，也不代表原生窗口验收。

## 当前结构

- `src/public.tsx`：公开装配入口。
- `src/App.tsx`：页面装配、导航及跨页面协调。
- `src/features/`：五个 View 各自落位。聊天的会话、事件补发、审批、附件状态在 `chat/useChatController.ts`；模型配置与选择在 `models/useModelController.ts`；运行时启动与存储状态在 `runtime/useRuntimeController.ts`。各功能组件留在所属目录。
- `src/app/DesktopContext.tsx`：宿主能力注入。
- `src/features/models/components/ProviderCard.tsx`：提供方模型清单和本地编辑状态。
- `src/preview/`：浏览器预览的模拟宿主。
- `src/locales/`：界面文案与 Agent 配置翻译。

## 本地命令

从仓库根目录运行 `pnpm install --frozen-lockfile` 后，可使用：

```sh
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend build
pnpm --dir apps/frontend dev
```

预览地址为 `http://127.0.0.1:1421`。生产桌面 UI 由 `apps/desktop` 装配和构建。前端源码不得直接导入 `@tauri-apps/*`，也不得使用原生命令或事件字符串；通过 `DesktopApi` 的具名能力调用宿主。
