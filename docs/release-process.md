# GitHub 发行流程与版本说明

仓库：`https://github.com/FirewineXie/hermess-agent-desktop`。RC 发布工作流：`.github/workflows/tagged-release.yml`；正式版工作流：`.github/workflows/stable-release.yml`；可选平台补发工作流：`.github/workflows/optional-release.yml`。

## 触发和准入

未完成的功能或修复留在 `feature/` 或 `fix/`；完成后通过 PR 检查和维护者审查，手动合入 `main`。RC tag `vX.Y.Z-rc.N` 从对应 `feature/vX.Y.Z` 上已提交且完成本地检查的提交创建，无需先合入 `main`。正式版只能从已合入 `main`、且该准确提交的最新 `Build and test (Windows)` 检查通过的提交构建；RC 构建不能替代正式版的 PR 与 `main` 检查。`main` 中已合入的全部变更都会进入所选提交的正式版，应在发布前核对范围。

RC 工作流只监听 `vX.Y.Z-rc.N` 形式的 tag 推送；正式版使用 `Stable desktop release` 手动任务，输入 `vX.Y.Z` 和远端 `main` 上的完整提交 SHA。仓库中的开发态版本统一由 `apps/desktop/src-tauri/Cargo.toml` 的 `0.0.0` 提供；Tauri 从 Cargo 读取版本，两个私有 `package.json` 不再声明产品版本。`scripts/release-version.mjs` 先核对 tag、单一版本来源及 `releases/<tag>.md`，然后只在各 runner 的临时检出目录同步 Cargo 清单和 Cargo.lock 中的产品版本。安装包必须包含 tag 对应版本；代码仓库不产生版本准备提交。`pnpm fetch:upstream` 检出锁定的 fork 桌面提交，`pnpm verify:upstream` 校验官方 tag/基线、fork 分支历史、提交 SHA、来源与干净工作区。构建期间不动态查询最新 Release。PR 的同编号检查只保留最新运行，所有 PR 同时最多有一个 Windows 检查在跑；`main` 推送检查独立。pnpm 和 Cargo 下载缓存仍须经过锁文件安装和源码校验。

发布任务在对应平台的 GitHub runner 上恢复 pnpm、Cargo 和原生 Python/uv 依赖缓存；缓存缺失时自行下载并构建，任务完成后保存新缓存。pnpm 仍按锁文件安装，Cargo 先按锁文件获取依赖，再在离线模式下打包。上游 PM 按锁文件、摘要和目标平台验证工具树，运行时载荷重新构建并校验。RC 从版本分支的目标提交构建，不需要为该提交单独预热；首次构建或缓存清除后的构建可能更久，也需要 runner 能访问依赖下载来源。锁定的 Hermes 源码检出及 runner 工具链不属于这些依赖缓存。

发布 RC 前，在版本分支提交 `releases/<tag>.md`，核对内容及构建输入，并执行 `node scripts/release-version.mjs check <tag>`。在已推送、已本地检查的目标提交上创建并推送同名 RC tag：

```sh
git tag -a vX.Y.Z-rc.N -m "Hermess Agent Desktop vX.Y.Z-rc.N"
git push origin vX.Y.Z-rc.N
```

先推送分支，再推送 RC tag，以便从分支追溯对应源码。RC 工作流核对 tag 提交仍在对应版本分支历史中，构建 Windows x64 和 macOS Apple Silicon 安装包，全部成功后发布预发布 Release。不得移动或重复使用已推送的 tag；有修复时使用下一个 RC 序号。

正式版先在目标 `main` 提交中准备 `releases/vX.Y.Z.md`，核对所有已合入变更、实际验收范围、上游锁定提交及发布资源。该提交的 `main` CI 成功后，从 Actions 的 `main` 分支运行 `Stable desktop release`，填写完整 tag 与 40 位提交 SHA；也可执行 `gh workflow run stable-release.yml --ref main -f tag=vX.Y.Z -f commit=<完整SHA>`。任务验证精确提交及其最新必需检查，然后从该提交构建并核对两个默认平台的附件和 SHA-256 清单。只有这些任务都成功，最后一个任务才在同一提交创建正式 tag 并发布**刚构建的同一批附件**。构建失败不会占用正式 tag；创建 tag 后发布 Release 若发生外部故障，应人工核对远端 tag 和已生成附件，不得重指 tag 或覆盖已公开附件。

不要在版本说明、密钥或运行时资源尚未核对时推送 tag。标签一经推送会占用 Windows x64 和 macOS Apple Silicon 的 GitHub Actions 构建资源。

## 构建产物

| 目标 | Runner | 安装包 | 发布方式 |
| --- | --- | --- | --- |
| Windows x64 | `windows-2025` | 当前用户 NSIS `.exe` | tag 自动构建 |
| macOS Apple Silicon | `macos-15` | `.dmg` | tag 自动构建 |
| macOS Intel | `macos-15-intel` | `.dmg` | 按需手动补发 |
| Linux x64 | `ubuntu-22.04` | AppImage 与 `.deb` | 按需手动补发 |

每个原生 runner 复用缓存或自行获取 Python/uv 工具及 uv 下载依赖，再验证 payload 与上游提交。Windows 将 payload 归档并计算摘要交给 Tauri 打包，NSIS 使用 zlib 压缩。安装器将新 payload 解到 `runtime/payload.next`，必要文件校验后再切换到固定的 `runtime/payload`；若安装器记录的旧 payload 归档摘要与新包一致，则跳过解包和目录切换。不同摘要时，旧目录改名为带时间戳的 `payload.old-*`；新 Gateway 启动成功后，客户端在后台只清理带本产品标记的旧目录，未清理完的目录在后续成功启动时重试，卸载时也予以清理。安装器仍会复制新包中的归档资源；这里的复用不等于跳过资源复制。macOS/Linux 将已验证的展开后 payload 直接作为应用资源打包。安装包应包含匹配目标平台的运行时；两个默认目标都成功后，汇总两个安装包和 `SHA256SUMS.txt` 到对应 Release，任一默认目标失败则不创建 Release。正文取对应版本说明：`vX.Y.Z` 创建正式 Release，带预发布后缀的 tag 创建预发布 Release。安装包在上传前统一为无空格文件名，使 GitHub 附件名和校验清单一致。

覆盖安装时若旧 `payload` 暂时被占用，Windows 安装器会短时重试；交互安装允许关闭占用程序后再次尝试。切换失败时保留旧目录和已完整解压的 `payload.next`，下一次运行在摘要及必要文件匹配时直接复用暂存目录。

打包脚本在归档前会暂时把 payload 移到另一目录，运行清单指定的基础 Python，确认它和其子进程都能从搬迁后的源码及依赖目录导入 Hermes；检查结束后恢复原路径。此检查覆盖随包辅助解释器的目录可迁移性，不等于安装程序和原生窗口验收。

需要 macOS Intel 或 Linux x64 时，在 GitHub Actions 运行 `Optional desktop release target`，填写**已存在 Release** 的完整 tag 和所需目标；CLI 也可使用 `gh workflow run optional-release.yml --ref main -f tag=vX.Y.Z -f target=darwin-x64`（Linux 使用 `linux-x64`）。工作流从该 tag 检出源码，重新核对版本、上游与许可证，然后构建选定目标。补发完成后，读取现有 Release 附件，验证默认目标及所选目标的安装包数量和格式，并重写覆盖全部现有安装包的 `SHA256SUMS.txt`。相同 tag 的默认发布与补发串行运行；若所选平台已有附件，则拒绝再次补发，不覆盖已公开安装包。SHA-256 清单会为新增平台重写；上传附件后若清单更新失败，先核对远端状态再人工恢复。

桌面前端的发行构建在 Vite 写出内容哈希前混淆 JavaScript；`scripts/check-desktop-assets.mjs` 要求产物包含 JS 且没有独立或内联的 source map。开发服务器不混淆，前端工作区的浏览器预览构建也不作为桌面发行物。Rust release 配置裁剪符号。上述处理只增加阅读成本；离线载荷仍包含与锁定 fork 提交逐字节一致的 Hermes Python 源码，本产品的 PowerShell 工具代码也仍作为 Python 插件部署。不得以混淆或字节码生成宣称安装包无法逆向。

Release 附件在公开仓库的 Releases 页面查看。预发布仅表示构建产物已汇总。启动正式版任务前须完成计划内的实机验证；工作流成功不能代替安装、签名、真实模型和升级验收。

「关于」页面内嵌 `legal/hermes-agent-LICENSE`；CI 和 tag 构建从锁定上游检出后运行 `pnpm check:legal`，要求它与上游许可证逐字节一致。更新通道规则见 [关于与软件更新](about-and-updates.md)。客户端可匿名检查公开 GitHub Release，并下载、校验 Windows 或 macOS 安装包；当前不执行自动安装。公开版本原则上不覆盖同 tag 附件，避免同一版本号指向不同字节的安装包；本次 `v0.1.6` 的明确重新发行须在 Release 说明中告知旧附件撤换和重新校验要求。

## 当前限制

- macOS 暂采用临时签名，未配置 Apple Developer 正式签名与公证；Windows 也未配置签名证书。
- GitHub runner 构建需要能访问上游固定工具和依赖的下载来源。产物启动时是否离线可用，需要独立断网测试。
- Windows 以外目标的运行时构建和安装结果尚待新流程 CI 及实机证据；默认目标失败会阻止 Release 创建，可选目标失败不会撤销已创建的默认 Release。
