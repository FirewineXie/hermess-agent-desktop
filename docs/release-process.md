# GitHub tag 构建与版本说明

仓库：`https://github.com/FirewineXie/hermess-agent-desktop`。工作流：`.github/workflows/tagged-release.yml`。

## 触发和准入

工作流仅监听 `v*.*.*` tag 的 `push`，不监听普通分支推送，也没有手动触发入口。`scripts/check-release.py` 在构建前要求 tag、四处产品版本和 `releases/<tag>.md` 一致；上游子模块必须等于 `runtime/upstream.lock.json` 的提交，且源码工作区干净。

发布新版本时，先修改 `package.json`、`apps/desktop/package.json`、`apps/desktop/src-tauri/Cargo.toml`、`apps/desktop/src-tauri/tauri.conf.json` 的版本，更新锁文件，新增 `releases/vX.Y.Z.md`。提交后再创建并推送同名 tag：

```sh
git tag -a vX.Y.Z -m "Hermess Agent Desktop vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

不要在版本说明、密钥或运行时资源尚未核对时推送 tag。标签一经推送会占用四个平台的 GitHub Actions 构建资源。

## 构建产物

| 目标 | Runner | 安装包 |
| --- | --- | --- |
| Windows x64 | `windows-2025` | 当前用户 NSIS `.exe` |
| macOS Apple Silicon | `macos-15` | `.dmg` |
| macOS Intel | `macos-15-intel` | `.dmg` |
| Linux x64 | `ubuntu-22.04` | AppImage 与 `.deb` |

每个原生 runner 先使用固定上游 PM 准备 Python/uv 和基础依赖，再验证 payload 与上游提交，归档并计算摘要后交给 Tauri 打包。安装包应包含匹配目标平台的运行时；构建失败时不创建 Release。四个构建都成功后，汇总五个安装包和 `SHA256SUMS.txt` 到**草稿 Release**，正文取对应版本说明。重新运行工作流会更新同一草稿 Release 的资产和正文。

草稿只说明构建完成，不等于三平台安装、签名、真实模型和升级验收通过。正式公开发布前仍需按 `桌面端迭代方案.md` 的发布门槛完成实机验证。

## 当前限制

- macOS 暂采用临时签名，未配置 Apple Developer 正式签名与公证；Windows 也未配置签名证书。
- GitHub runner 构建需要能访问上游固定工具和依赖的下载来源。产物启动时是否离线可用，需要独立断网测试。
- Windows 以外目标的运行时构建和安装结果尚待 CI 及实机证据；任何一个目标失败都阻止 Release 汇总。
