# 参与 Hermess Agent Desktop 开发

本项目仍在内测。提交代码或文档前，请先阅读 [README.md](README.md)、[能力矩阵](docs/capability-matrix.md) 和与改动相关的 [运行时决策记录](docs/ADR-0001-runtime-and-process.md)。版本计划见 [产品路线图](ROADMAP.md)；计划中的能力不能写成已经验收的能力。

## 分支与提交

- `main` 作为长期主干，合入的变更应保持可构建。按 [README 的按版本开发流程](README.md#按版本开发) 检查并复用 `feature/vX.Y.Z`；只有该版本分支在本地和远端都不存在时，才从最新 `origin/main` 创建。紧急修复使用从最新 `origin/main` 创建的 `fix/...` 分支；不要直接向 `main` 提交或推送。仅在确需维护旧版本时建立 `release/vX.Y` 分支。
- 提交信息采用 Conventional Commits，例如 `feat: add attachment preview`、`fix: preserve runtime location`、`docs: update capability matrix`。标题使用简短英文祈使句；必要时在正文解释原因和兼容影响。
- 保持改动聚焦。涉及架构、运行时契约、平台验收或发布状态时，同步更新对应文档与证据，避免只修改结论。

克隆仓库后运行 `pnpm setup:hooks`，安装仓库提供的本地 Git hook：在 `main` 上直接提交或向远端 `main` 直接推送会被拒绝。hook 仅作用于启用它的本地检出，可以被跳过，不能替代远端分支保护。

## 合并流程

1. 在版本分支或修复分支完成改动、本地检查和提交，推送分支并向 `main` 提交 Pull Request。
2. 等待 [PR checks](.github/workflows/ci.yml) 的 `Build and test (Windows)` 作业成功，并处理代码审查意见。该作业验证锁定上游、前端构建、Rust 格式、编译和测试。
3. 若检查失败，继续在同一分支修复并重新运行 CI；不得用未验证的新提交合并。检查被跳过、取消或尚未结束都不算通过。
4. CI 全部通过后，维护者检查 PR 差异并手动合并；版本分支在该版本开发结束后再删除，修复分支合并后可删除。当前由一人维护，可由 PR 作者自行审查和合并，不要求另一人批准。合并后的 `main` 也会运行同一工作流；若失败，立即修复。

当前仓库为私有仓库，现有 GitHub 方案对 `main` 分支保护接口返回“需要 GitHub Pro 或公开仓库”，因此上述合并门槛目前由维护者逐次执行；本地 hook 只拦截已启用它的检出，GitHub 尚未强制拦截直接推送。若将来具备分支保护能力，应启用“必须经 Pull Request 合并”和必需状态检查 `Build and test (Windows)`。RC tag（如 `v0.1.5-rc.1`）可从对应的 `feature/vX.Y.Z` 已提交、完成本地检查并核对发行输入的提交创建，无需先合入 `main`；正式版 tag `vX.Y.Z` 只能从已合入且通过 CI 的 `main` 创建。tag 构建仍由 [发行工作流](.github/workflows/tagged-release.yml) 单独完成。

## 项目边界

- `upstream/hermes-agent` 是按 `runtime/upstream.lock.json` 中 fork 维护分支及完整提交 SHA 单独检出的忽略目录，不是 submodule。`pnpm fetch:upstream` 获取锁定的 fork 源码，不在产品构建中应用补丁或修改检出目录；`pnpm verify:upstream` 校验来源、分支历史、官方正式 Release tag/基线及干净工作区。fork 的桌面改动只经开发分支 PR 合入 `hermess-desktop`；产品升级须审查新官方 tag 和 fork 提交，日常构建只使用锁定 SHA。

- 本产品自行实现桌面层。参考项目 `cankao/Hermes-CN-Desktop` 用于研究，不直接复制其源码、图标或素材；需要复用具体文件时，先核对该文件的许可。
- 产品只管理自己创建的后端进程、数据根和凭据。修改连接、重连、安装、升级或卸载逻辑时，验证不会误连、重启、覆盖或停止用户已有的 Hermes 实例，也不会误删所选目录的父目录。
- 区分脚本测试、CI 构建、安装包测试、原生窗口操作和真实模型测试。报告平台、架构、测试方式与剩余未验收项；构建成功不能表述为实机运行通过。

具体的克隆和升级操作见 [上游源码流程](docs/upstream-source.md)。

## 本地验证

在仓库根目录执行与改动相关的检查：

```sh
pnpm install --frozen-lockfile
pnpm fetch:upstream
pnpm verify:upstream
pnpm build
cd apps/desktop/src-tauri
cargo fmt --all -- --check
cargo check
cargo test
```

首次安装依赖时运行 `pnpm install --frozen-lockfile`；之后可直接运行其余检查。仓库当前没有 `pnpm typecheck` 或 `pnpm test:unit` 脚本，不要照搬参考项目的命令。仅修改文档时，核对链接、命令和事实即可；修改前端或 Rust 代码时，运行对应的构建和检查。修改网关、运行时或安装包时，还要执行相关的协议冒烟、payload 校验或原生平台手动验证，并在 PR 中写明实际命令与结果。

## Pull Request

PR 描述请包含：

1. 背景与变更目的。
2. 主要实现点，以及涉及的上游接口或产品边界。
3. 实际运行的测试命令、平台与结果；未运行的检查和原因。
4. 对用户可见行为、配置、数据、安装、升级或发布流程的影响。
5. 尚未验证的场景和后续事项。

不要提交本地生成物、日志、私有配置、token、密钥、`.env`、安装包或大体积依赖。提交前检查 `git status` 和暂存差异，特别留意意外加入的运行时资源。

## 发布约束

发布前遵循 [发行流程](docs/release-process.md)，先在 `main` 预热所需平台的原生依赖缓存并确认 job 成功。`vX.Y.Z` 生成正式 Release，`vX.Y.Z-rc.1` 等预发布 tag 生成预发布 Release；默认等待 Windows x64 与 macOS Apple Silicon 构建成功，macOS Intel 和 Linux x64 按需补发。推送 tag 前须确认四处产品版本、`releases/<tag>.md`、上游锁定提交及安装包输入一致。正式发布还须逐项确认安装、签名、升级和真实模型验收。Release 工作流成功只证明构建产物已汇总。
