# Hermess Agent Desktop

基于固定提交的 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 开发的独立 Tauri 2 桌面客户端。当前是内测阶段，Windows x64 已完成部分脚本和安装包验收；Windows、macOS 和 Linux 的安装包已在 GitHub Actions 构建成功，macOS 与 Linux 仍需实机安装和运行验收。完整进度见 [I0 实施记录](docs/I0-implementation.md)。

## 当前能力

- 中文聊天界面、模型配置、流式回复、会话历史、停止、审批与澄清。
- 本地文件和图片附件，含原生选择、拖入及短文本预览。
- 独立数据根、固定上游提交、运行时归档校验与首次解包。
- 按版本 tag 触发 GitHub Actions 构建 Windows x64、macOS Intel/Apple Silicon、Linux x64 安装包；全部成功后汇总到预发布 Release。

这些能力在各平台的验证层次不同。当前的 Windows 假模型和静默安装结果不代表原生窗口或真实模型已通过验收，详见 [能力矩阵](docs/capability-matrix.md)。

## 本地开发

参与开发的分支、提交、验证和 PR 约束见 [CONTRIBUTING.md](CONTRIBUTING.md)。

```sh
git clone https://github.com/FirewineXie/hermess-agent-desktop.git
cd hermess-agent-desktop
pnpm fetch:upstream
pnpm install --frozen-lockfile
pnpm verify:upstream
pnpm build
```

原生构建需 Node 24、pnpm 10.25、Rust 1.94、CPython 3.14 及对应系统的 Tauri 依赖。开发态启动可运行 `pnpm tauri:dev`；完整离线候选包需先按 [发行流程](docs/release-process.md) 准备固定上游运行时。

上游 Release 的选择、锁定和升级步骤见 [上游源码流程](docs/upstream-source.md)。

## 版本构建

仅推送 `v主版本.次版本.修订号` 形式的 tag 才触发 `.github/workflows/tagged-release.yml`。tag 必须与根包、桌面包、Cargo 和 Tauri 的版本一致，并包含 `releases/<tag>.md` 的版本说明。构建任务需要四个平台全部成功，才会建立带五个安装包和 SHA-256 文件的预发布 Release。具体步骤见 [发行流程](docs/release-process.md)。

## 许可

本项目自行编写的代码采用 [PolyForm Noncommercial 1.0.0](LICENSE)。商业使用需要版权所有人另行授权；版权所有人保留自行商用的权利。`vendor/hermes-agent` 由 `pnpm fetch:upstream` 按锁定 Release tag 单独克隆，不纳入产品仓库，仍遵循上游自己的 MIT 许可证。其他第三方组件和资源也遵循各自许可证。本仓库的非商业许可不限制他人按 MIT 条款使用上游 Hermes Agent。

GitHub 仓库的初始提交曾包含 MIT 许可和一行 README；后续更改许可不会撤销此前已经授出的权利。产品代码首次上传时使用上述非商业许可。
