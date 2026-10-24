# 桌面客户端项目规则

本项目同时遵守仓库根目录的 [AGENTS.md](../../AGENTS.md)。阅读 [README.md](README.md)、[架构方案](../../docs/architecture-frontend-desktop.md) 和 [运行时决策记录](../../docs/ADR-0001-runtime-and-process.md) 后修改代码。

1. 自有 Hermes 实例的锁、子进程、令牌、端口与 Gateway 连接由同一个运行时所有者控制；不得扫描端口接管外部实例。
2. Tauri TypeScript 只负责能力接口的宿主实现和生产装配，不承接页面 JSX 或聊天状态逻辑。
3. Rust `main.rs` 只负责初始化、状态注入和命令注册；功能实现放在所属模块，不把新逻辑继续堆进单个大文件。
4. 保持固定上游协议与发布资源路径，修改命令或事件格式时同步修改契约和相关验证。
5. 按改动范围运行前端构建、Rust 格式、编译、测试及 Gateway 冒烟；原生窗口与安装包分别验收。新增代码和文档使用 UTF-8。
