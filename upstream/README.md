# 上游源码目录

`hermes-agent/` 是按 `runtime/upstream.lock.json` 中的正式 Release tag 和完整提交 SHA 单独克隆的上游源码目录。它被产品仓库忽略，不是 Git submodule。官方基线由 Git 提交确定；产品改动保存在仓库跟踪的 `../adapters/hermess_*` 文件中。

## 产品适配方式

- `pnpm fetch:upstream` 把 `hermess_desktop_private_api.patch` 应用到三个官方入口，并复制 `hermess_private_api.py`；实际安全逻辑在带 `hermess_` 前缀的产品文件中。
- 不手工编辑检出目录。`pnpm verify:upstream` 要求工作树差异和带前缀文件与产品源码完全一致。
- 不把 `hermes-agent/` 加入产品仓库，不用 `git add -f` 绕过忽略规则。
- 不将其切换到 `main`、canary 或其他 tag 来绕过锁文件。校验失败时停止构建或发布。

首次获取源码运行 `pnpm fetch:upstream`。需要升级上游时，先核对最新正式 Release，将 tag 和完整 SHA 一起更新到锁文件，再重新克隆、验证兼容性。详细步骤见 [上游源码流程](../docs/upstream-source.md)。
