# 前端项目规则

本项目同时遵守仓库根目录的 [AGENTS.md](../../AGENTS.md)。阅读 [README.md](README.md) 和 [架构方案](../../docs/architecture-frontend-desktop.md) 后修改代码。

1. View 组合本功能组件，状态和用例逻辑留在所属 feature；不要把拆出的状态重新集中到根 `App`。
2. 功能组件优先留在所属 feature，确实跨功能复用时才进入 `shared`。
3. 不直接导入 `@tauri-apps/*`、Rust 实现或桌面项目内部模块。宿主能力通过 `@hermess/contracts` 的接口注入。
4. 浏览器预览中的模拟数据只用于界面开发；报告验证结果时与桌面构建和原生窗口操作分开。
5. 修改前端代码至少运行 `pnpm --dir apps/frontend typecheck` 与 `pnpm build`。新增代码和文档使用 UTF-8。
