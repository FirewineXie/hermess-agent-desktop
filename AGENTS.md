# 仓库工作约束

本文件适用于本仓库中的自动化开发代理。贡献流程与验证命令见 [CONTRIBUTING.md](CONTRIBUTING.md)；具体实现事实以当前代码、锁文件和实际验证为准。

1. 修改前检查 `git status`，保留已有未提交改动，不对他人的工作树执行破坏性重置。克隆后运行 `pnpm setup:hooks`；开发必须在从最新 `main` 建立的任务分支进行，不要直接向 `main` 提交或推送。
2. 不使用 submodule，不修改 `vendor/hermes-agent` 的源码。用 `pnpm fetch:upstream` 克隆 `runtime/upstream.lock.json` 锁定的正式 Release tag，并以完整 SHA 和干净工作树验证；上游接口行为须按固定提交核实。最新 Release 仅在明确升级时重新选择，不在每次构建时动态选择。
3. 只管理本产品创建的进程、数据与凭据。连接、存储、升级和卸载改动须保留与用户现有 Hermes 安装的隔离边界。
4. 不从 `cankao/Hermes-CN-Desktop` 直接复制代码或素材。参考其设计时，按本项目实际技术栈和许可重新实现。
5. 使用仓库真实存在的脚本和检查。按改动范围验证，并如实记录平台、命令、结果及未验收范围；不得把计划、脚本冒烟或 CI 构建写成原生实机验收。
6. 改动发布流程时遵循 `docs/release-process.md`；未经版本与资源核对，不推送发布 tag。所有新写代码和文档使用 UTF-8。
7. 完成改动后推送任务分支并提交 PR；等待 `Build and test (Windows)` 检查成功、处理审查意见后才合并。失败、跳过、取消或未完成都不得视为通过。当前 GitHub 方案无法对私有仓库启用分支保护，因此必须主动执行这条规则，不得以平台未拦截为由直接推送 `main`。仅从通过 CI 的 `main` 创建发布 tag。详见 `CONTRIBUTING.md`。
