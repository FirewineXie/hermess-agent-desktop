# GitHub tag 构建与版本说明

仓库：`https://github.com/FirewineXie/hermess-agent-desktop`。工作流：`.github/workflows/tagged-release.yml`。

## 触发和准入

RC tag 可从对应 `feature/vX.Y.Z` 上已提交、完成本地检查并核对发行输入的提交创建，无需先合入 `main`。正式版 tag 只能从已合入且通过 [PR checks](../.github/workflows/ci.yml) 的 `Build and test (Windows)` 检查的 `main` 提交创建；代码通过 PR 审查后由维护者手动合并。RC 构建结果不能替代正式版的 PR 门槛。

工作流仅监听 `v*.*.*` tag 的 `push`，支持正式版本 `vX.Y.Z` 和 SemVer 预发布版本（例如 `vX.Y.Z-rc.1`），不监听普通分支推送，也没有手动触发入口。`scripts/check-release.py` 在构建前要求 tag、四处产品版本和 `releases/<tag>.md` 一致；`pnpm fetch:upstream` 检出锁定的 fork 桌面提交，`pnpm verify:upstream` 校验官方 tag/基线、fork 分支历史、提交 SHA、来源与干净工作区。构建期间不动态查询最新 Release。

发布新版本时，先修改 `package.json`、`apps/desktop/package.json`、`apps/desktop/src-tauri/Cargo.toml`、`apps/desktop/src-tauri/tauri.conf.json` 的版本，更新锁文件，新增 `releases/<tag>.md`。预发布版本须将四处版本同步为不含前缀 `v` 的完整版本（例如 `0.1.5-rc.1`），说明文件名为 `releases/v0.1.5-rc.1.md`。提交后再创建并推送同名 tag：

```sh
git tag -a vX.Y.Z -m "Hermess Agent Desktop vX.Y.Z"
git push origin vX.Y.Z
```

预发布时，在对应版本分支上将上述命令中的 `vX.Y.Z` 换成完整的预发布 tag，例如 `v0.1.5-rc.1`。先确认当前 `HEAD` 是已提交并检查过的目标提交；推送分支后再推送 tag，以便从分支追溯对应源码。同一 tag 不能在正式版和预发布版之间切换；正式版应从合并后的 `main` 创建新的 `vX.Y.Z` tag。

不要在版本说明、密钥或运行时资源尚未核对时推送 tag。标签一经推送会占用四个平台的 GitHub Actions 构建资源。

## 构建产物

| 目标 | Runner | 安装包 |
| --- | --- | --- |
| Windows x64 | `windows-2025` | 当前用户 NSIS `.exe` |
| macOS Apple Silicon | `macos-15` | `.dmg` |
| macOS Intel | `macos-15-intel` | `.dmg` |
| Linux x64 | `ubuntu-22.04` | AppImage 与 `.deb` |

每个原生 runner 先使用固定上游 PM 准备 Python/uv 和基础依赖，再验证 payload 与上游提交，归档并计算摘要后交给 Tauri 打包。安装包应包含匹配目标平台的运行时；构建失败时不创建 Release。四个构建都成功后，汇总五个安装包和 `SHA256SUMS.txt` 到对应 Release，正文取对应版本说明：`vX.Y.Z` 创建正式 Release，带预发布后缀的 tag 创建预发布 Release。安装包在上传前统一为无空格文件名，使 GitHub 附件名和校验清单一致。重跑同一 tag 时会更新已有 Release 的附件、正文和发布类型。

Release 附件在仓库的 Releases 页面查看；仓库为私有仓库，仍需有仓库访问权限。预发布仅表示构建产物已汇总。推送正式 tag 前须完成实机验证；工作流成功不能代替安装、签名、真实模型和升级验收。

「关于」页面内嵌 `legal/hermes-agent-LICENSE`；CI 和 tag 构建从锁定上游检出后运行 `pnpm check:legal`，要求它与上游许可证逐字节一致。更新通道规则见 [关于与软件更新](about-and-updates.md)。客户端可匿名检查公开 GitHub Release，并下载、校验 Windows 或 macOS 安装包；仓库仍为私有时普通客户端无法访问，也不执行自动安装。后续接入签名更新清单前，还需停止已公开版本的同 tag 附件覆盖，避免同一版本号指向不同字节的安装包。

## 当前限制

- macOS 暂采用临时签名，未配置 Apple Developer 正式签名与公证；Windows 也未配置签名证书。
- GitHub runner 构建需要能访问上游固定工具和依赖的下载来源。产物启动时是否离线可用，需要独立断网测试。
- Windows 以外目标的运行时构建和安装结果尚待 CI 及实机证据；任何一个目标失败都阻止 Release 汇总。
