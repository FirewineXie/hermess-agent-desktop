# 上游 Hermes 源码获取与升级

产品仓库不使用 Git submodule，也不把上游源码提交进产品仓库。`upstream/hermes-agent/` 是忽略目录，构建来源是产品维护的 [Hermes fork](https://github.com/FirewineXie/hermes-agent)，由 `runtime/upstream.lock.json` 固定仓库地址、正式 Release tag 和完整提交 SHA。产品适配源文件放在 `adapters/hermess_*`，可直接审阅；检出目录中的对应差异由脚本生成。官方 [NousResearch 仓库](https://github.com/NousResearch/hermes-agent) 用于上游升级参考，不是日常构建来源。

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

`fetch:upstream` 在目录不存在时按锁定 tag 从上游仓库浅克隆，应用固定补丁并复制带 `hermess_` 前缀的产品模块；目录已存在时只核对或对干净官方基线应用适配，不覆盖其他本地改动。`verify:upstream` 检查 `origin`、tag、HEAD 完整 SHA、官方文件差异恰好等于补丁，以及产品模块字节一致。克隆失败留下不完整目录时，先检查目录内容，再删除该不完整目录并重试。构建需要可访问上游 Git 仓库；运行已打包的安装包不需要克隆源码。

## 明确升级到当时最新的正式 Release

1. 查看 [上游 Releases](https://github.com/NousResearch/hermes-agent/releases/latest)，确认其 `Latest` 正式 Release tag。不要把 `main`、预发布或 canary tag 当成正式 Release。
2. 以 `v0.22.5` 为例，分别对官方来源和产品 fork 执行 `git ls-remote --tags <仓库地址>`，核对 `refs/tags/v0.22.5` 及 `refs/tags/v0.22.5^{}`；注解 tag 有 tag 对象和 `^{}` 指向的提交，锁文件记录后者。确认 fork 保留同一提交后再更新锁文件。
3. 审查 Release 说明和当前产品依赖的接口。把 tag 与完整 SHA 一起写入 `runtime/upstream.lock.json`；升级须走产品代码审查，不在 CI 中查询“最新”。
4. 在干净目录按新锁文件运行 `pnpm fetch:upstream`、`pnpm verify:upstream`。已存在旧检出时，先保留或移走旧目录；脚本不会自动替换它。
5. 重新运行前端、Rust、协议、payload 和目标平台的安装验收。更新能力矩阵与运行时决策记录，只发布通过版本配对检查的桌面版本。

2026-10-24 查得最新正式 Release 为 `v0.22.5`，提交 `bf0203a794a07aac3ff764972ab9087baa4e4f4e`。这是本次锁定来源，不代表现有 I0 验收已覆盖该提交。
