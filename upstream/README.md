# 上游源码目录

`hermes-agent/` 是按 `runtime/upstream.lock.json` 从产品维护的 Hermes fork 克隆、并检出完整提交 SHA 的源码目录。它被产品仓库忽略，不是 Git submodule。锁文件另行记录官方正式 Release 的 tag 和基线提交；实际打包内容由 fork 提交决定。

`pnpm fetch:upstream` 获取锁定源码；`pnpm verify:upstream` 核对来源、提交、干净工作树、桌面维护分支历史以及官方基线。产品构建不会向检出目录应用补丁，也不复制适配器文件。不要手工编辑该目录，或用其他分支、tag 绕过锁文件。

桌面适配代码由 fork 的 `hermess-desktop` 分支直接跟踪。开发者从该分支建立开发分支，经 PR 合回 `hermess-desktop`。升级正式版时在升级分支合入官方 tag 指向的提交，再更新产品锁文件并重新验证。详细步骤见 [上游源码流程](../docs/upstream-source.md)。
