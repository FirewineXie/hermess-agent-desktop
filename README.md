# Hermess Agent Desktop

基于固定提交的 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 开发的独立 Tauri 2 桌面客户端。当前是内测阶段，Windows x64 已完成部分脚本和安装包验收；Windows、macOS 和 Linux 的安装包已在 GitHub Actions 构建成功，macOS 与 Linux 仍需实机安装和运行验收。完整进度见 [I0 实施记录](docs/I0-implementation.md)。

**[查看产品路线图（ROADMAP）](ROADMAP.md)**：按版本查看正在开发的功能、验证状态和后续计划。当前准备发布 `v0.5.0-rc.1` 候选版本，正式版 `v0.5.0` 尚未发布。

**[前端与桌面客户端架构演进方案](docs/architecture-frontend-desktop.md)**：目标项目边界、View 与组件拆分、客户端模块、接口契约和迁移验收。方案正在分阶段实施，当前开发与构建命令仍以本 README 为准。

工作区项目：[前端](apps/frontend/README.md)、[桌面客户端](apps/desktop/README.md)、[接口契约](packages/contracts/README.md)。三个项目的当前实现状态以各自 README 为准。

## 当前能力

- 中文聊天界面、模型配置、流式回复、会话历史、停止、审批与澄清。
- 本地文件和图片附件，含原生选择、拖入及短文本预览。
- 独立数据根、固定上游提交、运行时归档校验与首次解包。
- 按正式或预发布版本 tag 触发 GitHub Actions 构建 Windows x64、macOS Intel/Apple Silicon、Linux x64 安装包；全部成功后汇总到对应类型的 Release。

这些能力在各平台的验证层次不同。当前的 Windows 假模型和静默安装结果不代表原生窗口或真实模型已通过验收，详见 [能力矩阵](docs/capability-matrix.md)。

## 本地开发

参与开发的分支、提交、验证和 PR 约束见 [CONTRIBUTING.md](CONTRIBUTING.md)。

产品功能与版本进度见 [路线图](ROADMAP.md)。**每次开发完成后，提交或提出 PR 前必须更新路线图中对应版本的内容**：记录本次新增或修复的功能、当前状态、实际验证范围及未完成项；发布 tag 后再标记为已发布。不能把开发分支或构建通过写成发布或实机验收。

### 按版本开发

每次开始开发前，先检查当前工作区的 `git status`、当前分支、已有工作区和本地/远端版本分支，并获取最新的 `origin/main`。确定本次计划发布的版本号（例如 `v0.5.0`）后：

1. 如果 `feature/v0.5.0` 已存在，就在该分支继续开发；若它已由另一个工作区检出，则使用那个工作区。保留所有未提交改动，不强行切换或重建分支。
2. 如果本地没有该分支，但远端已有，先检出并跟踪远端分支；如果本地和远端都没有，才从最新的 `origin/main` 创建 `feature/v0.5.0`。
3. 开发期间如 `main` 有新的修复，将其同步到版本分支并重新验证。版本完成后通过 PR 合入 `main`；PR 检查及合并要求见 [贡献流程](CONTRIBUTING.md)。合并后的 `main` 通过 CI、版本文件和发布资源核对后，再创建发布 tag `v0.5.0`。

紧急修复从最新的 `origin/main` 创建独立的 `fix/...` 分支，验证后通过 PR 合入 `main`，并将修复同步到仍在开发的版本分支。`feature/v0.5.0` 是可继续提交的开发分支；`v0.5.0` 是发布提交的 tag。若无法从计划确定下一个版本号，先明确版本号，不凭现有 tag 猜测。

```sh
git clone https://github.com/FirewineXie/hermess-agent-desktop.git
cd hermess-agent-desktop
pnpm setup:hooks
pnpm fetch:upstream
pnpm install --frozen-lockfile
pnpm verify:upstream
pnpm build
```

原生构建需 Node 24、pnpm 10.25、Rust 1.94、CPython 3.14 及对应系统的 Tauri 依赖。开发态启动可运行 `pnpm tauri:dev`；完整离线候选包需先按 [发行流程](docs/release-process.md) 准备固定上游运行时。

上游 Release 的选择、锁定和升级步骤见 [上游源码流程](docs/upstream-source.md)。

## 版本构建

推送正式 tag `v主版本.次版本.修订号` 或预发布 tag（例如 `v0.5.0-rc.1`）会触发 `.github/workflows/tagged-release.yml`。tag 必须与根包、桌面包、Cargo 和 Tauri 的版本一致，并包含 `releases/<tag>.md` 的版本说明。四个平台全部构建成功后，才会建立带五个安装包和 SHA-256 文件的对应类型 Release。具体步骤见 [发行流程](docs/release-process.md)。

## 许可

本项目自行编写的代码采用 [PolyForm Noncommercial 1.0.0](LICENSE)。商业使用需要版权所有人另行授权；版权所有人保留自行商用的权利。`upstream/hermes-agent` 由 `pnpm fetch:upstream` 按锁定 Release tag 单独克隆，不纳入产品仓库，仍遵循上游自己的 MIT 许可证。其他第三方组件和资源也遵循各自许可证。本仓库的非商业许可不限制他人按 MIT 条款使用上游 Hermes Agent。

GitHub 仓库的初始提交曾包含 MIT 许可和一行 README；后续更改许可不会撤销此前已经授出的权利。产品代码首次上传时使用上述非商业许可。
