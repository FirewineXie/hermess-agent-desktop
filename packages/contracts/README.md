# 前端与客户端接口契约

本工作区项目定义 `@hermess/frontend` 与 `@hermess/desktop` 的共享类型和宿主能力接口。`src/index.ts` 已按运行时、聊天、模型、Agent 设置、工具和诊断分组，并定义两端共用的 DTO。前端只调用具名能力；新增原生命令时需同步扩展契约和桌面适配层。

`schema/backend-info.schema.json` 定义运行时启动结果的 JSON 格式，`fixtures/backend-info.json` 是两端共用的样本。`pnpm check:contracts` 检查样本满足格式约束；Rust 测试将原生 `BackendInfo` 序列化后与同一文件比较。新增跨语言 DTO 时应同时增加规范和双端验证，避免只靠 TypeScript 编译掩盖序列化差异。

本项目不依赖 React、Tauri 或 Hermes 源码。接口变更须同时检查前端调用与桌面实现，不能靠两边各自维护一份不一致的类型。
