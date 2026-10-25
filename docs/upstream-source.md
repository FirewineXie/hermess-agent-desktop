# Hermes 源码获取与升级

产品仓库不使用 Git submodule，也不提交 Hermes 源码。`upstream/hermes-agent/` 是忽略目录。桌面私有 API 和三个上游接入点直接由 [Hermes fork](https://github.com/FirewineXie/hermes-agent) 的 `hermess-desktop` 分支跟踪，产品构建不应用补丁。

`runtime/upstream.lock.json` 同时记录官方正式 Release 的 `tag`/`baseCommit` 和 fork 的 `branch`/`commit`。构建内容只由 fork 的完整 `commit` 决定；分支名用于确认该提交仍属于维护分支，不能代替 SHA 锁定。

## 日常克隆与构建

在产品仓库根目录运行：

```sh
pnpm fetch:upstream
pnpm install --frozen-lockfile
pnpm verify:upstream
pnpm build
```

`fetch:upstream` 在目录不存在时克隆 fork 的 `hermess-desktop` 分支历史并检出锁定 SHA；目录已存在时只校验，不覆盖已有工作树。`verify:upstream` 核对 fork 来源、HEAD、干净工作树、两个提交在维护分支中的祖先关系，以及官方 tag 指向的基线提交。旧版带产品补丁的检出不符合新锁文件；迁移时先保留旧目录，再重新获取。构建需要访问 fork 和官方 Git 仓库；已打包的安装包运行时不需要访问它们。

## fork 分支约束

产品功能先在客户端适配层实现，不因现有 Hermes 接口缺少某个外部来源就直接修改 fork。所有 fork 代码改动（包括官方版本升级）默认禁止；确需修改时，先记录客户端不可适配的具体限制或版本升级原因、最小改动范围及影响，取得用户明确审批后才可修改。批准修改不等于批准合并；代码仍须经独立审核、PR 和既有门槛。未获审批时保持 fork 与锁文件不变。

fork 的 `main` 保持只读，tags 不允许创建、改写或删除。`hermess-desktop` 是默认分支和唯一正式桌面集成分支，禁止强推与删除，改动必须通过 PR 和 `Hermess desktop gate`。开发者从该分支创建开发分支，PR 只合入该分支。Git 不记录分支创建时的命令；PR 检查验证开发分支继承了桌面基线提交。

## 升级官方正式 Release

本节仅适用于已按上述规则取得审批的升级。

1. 确认 [官方 Releases](https://github.com/NousResearch/hermes-agent/releases/latest) 中要采用的正式 tag，核对 tag 解引用后的完整提交 SHA；不要把 `main`、预发布或 canary 当作正式 Release。
2. 从 fork 的 `hermess-desktop` 创建升级分支，在升级分支合入该官方 tag 指向的提交，解决与桌面私有 API 的冲突；不改 fork 的 `main`，也不需要在 fork 创建 tag。
3. 在 fork 的升级分支运行私有监听、令牌及 WebSocket 边界检查，通过 PR 合入 `hermess-desktop`，保留合并历史。
4. 在产品版本分支审查新的官方基线和 fork 提交，将完整 `baseCommit` 与 `commit` 写入锁文件。用干净目录运行 `pnpm fetch:upstream`、`pnpm verify:upstream`，重新验证前端、Rust、协议、payload 和目标平台安装包。
5. 更新能力矩阵和运行时决策记录。只有产品 PR 检查通过、合入 `main` 且发布资源核对完成后，才能创建新的产品发布 tag。

当前官方基线是 `v0.22.5`（`bf0203a794a07aac3ff764972ab9087baa4e4f4e`）。fork 桌面提交及产品版本的验收范围以当前锁文件和验证记录为准。
