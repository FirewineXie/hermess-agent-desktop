# 前端与客户端接口契约

本工作区项目定义 `@hermess/frontend` 与 `@hermess/desktop` 的共享类型和宿主能力接口。当前 `src/index.ts` 已提供运行时、工具和诊断能力接口；聊天、模型与 Agent 配置仍经临时 `invoke` 方法迁移。后续补齐能力分组、跨语言 DTO、规范源与契约样本。

本项目不依赖 React、Tauri 或 Hermes 源码。接口变更须同时检查前端调用与桌面实现，不能靠两边各自维护一份不一致的类型。
