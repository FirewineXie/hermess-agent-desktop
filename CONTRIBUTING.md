# 参与 Hermess Agent Desktop 开发

本项目仍在内测。提交代码或文档前，请先阅读 [README.md](README.md)、[能力矩阵](docs/capability-matrix.md) 和与改动相关的 [运行时决策记录](docs/ADR-0001-runtime-and-process.md)。阶段计划见 [桌面端迭代方案](桌面端迭代方案.md)；计划中的能力不能写成已经验收的能力。

## 分支与提交

- `main` 作为长期主干，合入的变更应保持可构建。所有人（包括自动化代理）从最新 `main` 建立短期分支，例如 `feature/...`、`fix/...`、`docs/...`；不要直接向 `main` 提交或推送。仅在确需维护旧版本时建立 `release/vX.Y` 分支。
- 提交信息采用 Conventional Commits，例如 `feat: add attachment preview`、`fix: preserve runtime location`、`docs: update capability matrix`。标题使用简短英文祈使句；必要时在正文解释原因和兼容影响。
- 保持改动聚焦。涉及架构、运行时契约、平台验收或发布状态时，同步更新对应文档与证据，避免只修改结论。

## 合并流程

1. 在任务分支完成改动、本地检查和提交，推送分支并向 `main` 提交 Pull Request。
2. 等待 [PR checks](.github/workflows/ci.yml) 的 `Build and test (Windows)` 作业成功，并处理代码审查意见。该作业验证锁定上游、前端构建、Rust 格式、编译和测试。
3. 若检查失败，继续在同一分支修复并重新运行 CI；不得用未验证的新提交合并。检查被跳过、取消或尚未结束都不算通过。
4. CI 全部通过且审查完成后合并 PR，再删除任务分支。合并后的 `main` 也会运行同一工作流；若失败，立即修复。

仓库管理员应在 GitHub 的 `main` 分支保护规则中启用“必须经 Pull Request 合并”和必需状态检查 `Build and test (Windows)`，避免仅靠手册约束。发布 tag 只能从已合入且通过 CI 的 `main` 提交创建；tag 构建仍由 [发行工作流](.github/workflows/tagged-release.yml) 单独完成。

## 项目边界

- `vendor/hermes-agent` 是按 `runtime/upstream.lock.json` 中正式 Release tag 和完整提交 SHA 单独克隆的忽略目录，不是 submodule。运行 `pnpm fetch:upstream` 获取源码；不要修改该目录，也不要让产品运行时自动追踪上游主干。升级上游时先确认 GitHub 最新正式 Release，审查新 tag 与提交，更新锁文件，再重新核对受影响的协议、封装与能力验收。日常构建只使用锁定版本。

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

发布前遵循 [发行流程](docs/release-process.md)。`vX.Y.Z` tag 会触发四个原生 runner 的构建；先确认四处产品版本、`releases/<tag>.md`、上游锁定提交及安装包输入一致。预发布 Release 表示构建产物已汇总，不代表各平台安装、签名、升级或真实模型已验收；正式发布须依据 [桌面端迭代方案](桌面端迭代方案.md) 的门槛逐项确认。
