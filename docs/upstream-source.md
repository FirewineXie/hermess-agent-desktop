# 上游 Hermes 源码获取与升级

产品仓库不使用 Git submodule，也不把上游源码提交进产品仓库。`vendor/hermes-agent/` 是忽略目录，由 `runtime/upstream.lock.json` 中的正式 Release tag 和完整提交 SHA 确定。

## 日常克隆与构建

在产品仓库根目录运行：

```sh
git clone https://github.com/FirewineXie/hermess-agent-desktop.git
cd hermess-agent-desktop
pnpm fetch:upstream
pnpm install --frozen-lockfile
pnpm verify:upstream
pnpm build
```

`fetch:upstream` 在目录不存在时按锁定 tag 从上游仓库浅克隆，然后检查 `origin`、tag 指向、HEAD 完整 SHA 和干净工作树。目录已存在时只验证，不覆盖任何本地文件。克隆失败留下不完整目录时，先检查目录内容，再删除该不完整目录并重试。CI 也先克隆锁定 tag，再构建安装包。构建需要可访问上游 Git 仓库；运行已打包的安装包不需要克隆源码。

## 明确升级到当时最新的正式 Release

1. 查看 [上游 Releases](https://github.com/NousResearch/hermes-agent/releases/latest)，确认其 `Latest` 正式 Release tag。不要把 `main`、预发布或 canary tag 当成正式 Release。
2. 以 `v0.22.5` 为例，用 `git ls-remote --tags https://github.com/NousResearch/hermes-agent.git 'refs/tags/v0.22.5' 'refs/tags/v0.22.5^{}'` 核对 tag 与其指向的完整提交 SHA。其他版本替换命令中的 tag；注解 tag 有 tag 对象和 `^{}` 指向的提交，锁文件记录后者。
3. 审查 Release 说明和当前产品依赖的接口。把 tag 与完整 SHA 一起写入 `runtime/upstream.lock.json`；升级须走产品代码审查，不在 CI 中查询“最新”。
4. 在干净目录按新锁文件运行 `pnpm fetch:upstream`、`pnpm verify:upstream`。已存在旧检出时，先保留或移走旧目录；脚本不会自动替换它。
5. 重新运行前端、Rust、协议、payload 和目标平台的安装验收。更新能力矩阵与运行时决策记录，只发布通过版本配对检查的桌面版本。

2026-10-24 查得最新正式 Release 为 `v0.22.5`，提交 `bf0203a794a07aac3ff764972ab9087baa4e4f4e`。这是本次锁定来源，不代表现有 I0 验收已覆盖该提交。
