# vendor 目录说明

`hermes-agent/` 是构建时按 `runtime/upstream.lock.json` 中的正式 Release tag 和完整提交 SHA 单独克隆的上游源码目录。它已被产品仓库忽略，不是 Git submodule，也不是本项目的源码编辑区。

## 不要直接修改 `hermes-agent/`

- 不在其中修改、打补丁或提交上游源码；产品适配代码放在本仓库自己的 `apps/`、`scripts/` 等目录。
- 不把 `hermes-agent/` 加入产品仓库，不用 `git add -f` 绕过忽略规则。
- 不将其切换到 `main`、canary 或其他 tag 来绕过锁文件。`pnpm verify:upstream` 会检查来源、tag、提交 SHA 和工作树状态；检查失败时停止构建或发布。

首次获取源码运行 `pnpm fetch:upstream`。需要升级上游时，先核对最新正式 Release，将 tag 和完整 SHA 一起更新到锁文件，再重新克隆、验证兼容性。详细步骤见 [上游源码流程](../docs/upstream-source.md)。
