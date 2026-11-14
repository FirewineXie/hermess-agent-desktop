# Hermess Dashboard 插件开发样例

把本目录复制到自己的 Git 仓库根目录。样例用 JavaScript 和宿主 React SDK，入口已是可安装产物。Node.js 用于本地检查，Hermess 加载样例时直接执行入口脚本。

## 修改并验证

1. 修改 `plugin.yaml` 和 `dashboard/manifest.json` 中的 `name`、`version`，保持两处一致。给 `tab.path` 选一个独立路径。
2. 修改 `dashboard/index.js`。`register()` 注册一个页面，`registerSlot()` 注册插槽组件。两个调用的插件名都与 Dashboard 清单一致。使用立即执行函数包裹入口代码，便于宿主重新扫描和加载。
3. 在样例目录运行 `npm run check`，检查清单和入口脚本的实际注册。若使用 JSX 或 TypeScript，先构建为同样格式的 JavaScript 入口，再把产物和清单一起提交到插件仓库。
4. 将仓库发布到 Hermess 可访问的 HTTPS Git 地址。在 Hermess 中打开「专家管理 → 对应 Profile → 插件」，填写 `owner/repo` 或 HTTPS 地址，安装并启用。插件位于仓库子目录时，可使用 `owner/repo/path/to/plugin`。
5. 从左侧「更多 → Dashboard Starter」打开页面，点击计数按钮。打开普通聊天，顶部显示 `Dashboard Starter · chat:top`。插件管理页的「Dashboard 界面状态」显示实际页面注册和实际插槽。停用后回读，页面入口和聊天贡献应移除。

本地编辑和检查可以在发布前完成。Hermess 当前安装入口使用 Git 或市场。已安装开发版本更新后可重新扫描，重新读取清单并重新加载脚本。样例 `__init__.py` 只提供 Hermes 插件入口。

## 清单与注册

| 项 | 用途 |
| --- | --- |
| `plugin.yaml` | Hermes 插件身份及安装版本 |
| `dashboard/manifest.json` | Dashboard 插件身份、入口、页面及声明的插槽 |
| `dashboard/index.js` | 通过宿主提供的 React 和 SDK 注册页面及组件 |

`slots` 是描述字段，组件在 `registerSlot()` 执行后才出现。`tab.hidden: true` 可隐藏独立页面入口，清单仍需填写有效的 `tab.path`。覆盖已有页面时使用 `tab.override` 并选择客户端已映射的路由。支持的位置以 [Hermess 路由定义](../../apps/frontend/src/features/dashboard-plugins/dashboardRouteModel.ts) 和 [应用壳插槽](../../apps/frontend/src/App.tsx) 为准。

样例从当前 WebView 的 `window.__HERMES_PLUGIN_SDK__` 取得 React、Card 和 Button。安装前可以直接阅读入口脚本。开发时可在插件管理页区分资产加载失败、入口已加载但未注册，以及注册成功。清单若在原生边界被拒绝，桌面日志会记录 `dashboard_plugin_manifest_invalid`。Hermes 扫描阶段跳过的无效清单则在对应 Gateway 日志排查。
