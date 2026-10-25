# Hermess 对上游 Hermes 的适配

本目录属于产品仓库，可直接查看和审查。所有产品适配文件以 `hermess_` 开头；`upstream/hermes-agent/` 是按锁文件获取的官方源码检出，不作为产品改动的提交位置。

- [`hermess_private_api.py`](hermess_private_api.py)：桌面私有 API 的实际规则，包括 loopback 绑定、令牌页面和浏览器 WebSocket Origin。
- [`hermess_desktop_private_api.patch`](hermess_desktop_private_api.patch)：在固定上游的三个入口调用上述产品模块，不在补丁中放业务规则。

`pnpm fetch:upstream` 应用补丁并复制产品模块到忽略的检出目录；`pnpm verify:upstream` 检查官方 SHA、补丁差异、模块内容和意外改动。构建核心 payload 时先归档固定上游提交，再应用相同补丁及产品模块，最后编译字节码。升级上游版本时须重新核对三个接入点和适配测试。
