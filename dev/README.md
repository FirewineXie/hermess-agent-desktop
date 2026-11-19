# 开发讨论与需求验证

本目录保存产品设想、讨论中的方案、需求验证与未决技术问题。放入本目录不表示已经立项、排期或决定实现。

- 草案应区分已确认的约束、当前实现事实、需求假设与待验证问题。
- 只有明确决定实施并确认范围后，才把确定要做的部分登记到 `ROADMAP.md`；不因整理讨论文档而新增路线图条目。
- 进入实施的设计与接口文档可整理到 `docs/`，并更新引用；讨论过程与验证结论可继续留在这里。
- 不存放凭据、机器专属配置、真实用户数据或本机生成产物。

## 当前讨论

| 主题 | 状态 |
| --- | --- |
| [编程模式与 Codex App Server 接入](codex-app-server-integration-plan.md) | 已确认实施，第一版 Responses 直连、独立密钥自动解锁、GitHub 固定 tag 按需下载；代码及后端集成验证进行中，尚未完成验收，详见[实施记录](codex-programming-implementation.md) |
| [Hermes 调用产品编程能力并停用自带 Codex 运行链](hermes-managed-programming-bridge-plan.md) | 方案草案；不改 Hermes fork，产品插件可取得普通聊天会话 ID 并调用现有编程服务；Profile 映射、实际调用与自带启动链封闭性待验证 |
| [Bot Room 独立插件](gateway-bot-room-plugin-plan.md) | 需求待验证，尚未立项、未排期、未实现 |
| [桌面界面插件化与布局装配](desktop-ui-composition-plan.md) | 第一期已在 `v0.1.11` 开发分支实现，全面自定义留到后续 |
