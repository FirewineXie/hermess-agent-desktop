# 前端项目

React 界面代码位于 `src/`。桌面客户端通过 `mountApp(root, api)` 注入宿主能力；浏览器预览使用明确的模拟实现，不连接真实 Hermes，也不代表原生窗口验收。

## 当前结构

- `src/public.tsx`：公开装配入口。
- `src/App.tsx`：迁移中的共享页面状态；将继续按功能收敛。
- `src/features/`：Agent 设置、工具和运行时页面已各自落位，聊天与模型的纯逻辑和部分组件已拆出，View 与状态仍待继续收敛。
- `src/app/DesktopContext.tsx`：宿主能力注入。
- `src/preview/`：浏览器预览的模拟宿主。
- `src/locales/`：界面文案与 Agent 配置翻译。

## 本地命令

从仓库根目录运行 `pnpm install --frozen-lockfile` 后，可使用：

```sh
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend build
pnpm --dir apps/frontend dev
```

预览地址为 `http://127.0.0.1:1421`。生产桌面 UI 由 `apps/desktop` 装配和构建。前端源码不得直接导入 `@tauri-apps/*`。
