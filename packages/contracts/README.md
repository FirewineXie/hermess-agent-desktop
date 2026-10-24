# 前端与客户端接口契约

本工作区项目定义 `@hermess/frontend` 与 `@hermess/desktop` 的共享类型和宿主能力接口。`src/index.ts` 已按运行时、聊天、模型、Agent 设置、工具、诊断、事件和原生文件选择分组，并定义两端共用的 DTO。前端只调用具名能力；新增原生命令或事件时需同步扩展契约和桌面适配层。

`schema/` 目前定义运行时启动结果、Gateway 实时事件、审批/澄清请求和事件补发结果；`fixtures/` 放对应样本。`pnpm generate:contracts` 从 Schema 生成 `src/generated/` 内的 TypeScript 类型；CI 使用 `pnpm check:generated-contracts` 检测漂移，`pnpm check:contracts` 验证样本结构。Rust 测试将原生 `BackendInfo`、实时事件和请求序列化结果与共用样本比较。补发结果目前由 Gateway 原样透传，靠上游固定版本冒烟和契约样本校验，其余跨语言 DTO 仍待逐项迁移。

本项目不依赖 React、Tauri 或 Hermes 源码。接口变更须同时检查前端调用与桌面实现，不能靠两边各自维护一份不一致的类型。
