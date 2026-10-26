# 接口契约项目规则

本项目同时遵守仓库根目录的 [AGENTS.md](../../AGENTS.md) 和 [架构方案](../../docs/architecture-frontend-desktop.md)。

1. 只放前端与桌面客户端共同承诺的数据和能力，不引入 React、Tauri 或上游 Hermes 源码依赖。
2. 新接口按产品能力命名，定义参数、返回值、错误和事件取消订阅语义；不要永久扩张临时 `invoke` 方法。
3. 修改契约时同步修改调用者、实现者和对应验证；新增代码与文档使用 UTF-8。
4. 契约包只存放共享类型、接口和 Schema；不要在 `packages/contracts/` 中提交 fixture 或机器专属开发配置。Schema 样本由包外测试代码构造，Rust 测试放在桌面项目的测试文件中。
