---
name: hermess-plugin-development
description: 在 Hermess Agent Desktop 会话中开发、调试、测试和交付 Dashboard 插件，包括独立页面、聊天插槽和已有插件的修改。
version: 0.1.0
author: Hermess Agent Desktop
platforms: [macos, windows]
metadata:
  hermes:
    tags: [hermess, desktop, dashboard, plugin, development]
---

# 开发 Hermess Dashboard 插件

用户要求实现时，在当前会话工作区创建或修改一个独立的插件目录，交付可从 Git 安装的完整文件。用户只要求设计或审核时，核对已有文件和接入点，给出结论。现有桌面、Hermes fork 和 Gateway 协议是宿主约束。

## 1. 确定接入点

| 用户需要 | 使用的入口 |
| --- | --- |
| 独立页面，例如记忆浏览 | `register(name, Page)`，清单配置 `tab.path`，安装后从侧栏「更多」打开 |
| 普通聊天里的横幅、摘要或入口 | `registerSlot(name, 'chat:top', Component)` 或 `chat:bottom` |
| 仅提供插槽 | 清单填写唯一的 `tab.path`，设 `tab.hidden: true`，用 `registerSlot()` 注册 |
| 替换已支持的整个页面 | 仅在用户明确要求覆盖时核对宿主映射，再用 `tab.override` 配合 `register()` |

有产品源码时，以当前 `dashboardRouteModel.ts` 和 `App.tsx` 核对实际位置。纯 UI 插件优先使用现有 React SDK，先明确数据来源、空态、失败和交互结果。接真实数据前查明当前宿主能提供的请求、返回字段及 Profile 作用域。缺少接口时，可以交付明确标注的样例数据，但须把真实数据接入列为未验收。涉及 Hermes 工具、Hook 或记忆提供方时，先查目标版本公开的 Agent 插件接口，再扩展 Python 入口。

## 2. 写出可安装的文件

已有插件先读清单、构建命令和已安装版本，保留插件 ID 和路由。新插件可直接采用下方四个文件。用实际名称、描述、唯一 ID、页面和交互替换示例。目录里的构建产物要与清单一致。JSX 或 TypeScript 要先打成浏览器可直接加载的自执行 JavaScript，再将产物提交到 Git。React 通过宿主 SDK 获取。

### `plugin.yaml`

```yaml
name: my-chat-panel
version: 0.1.0
description: 在聊天顶部展示摘要，并提供独立页面。
```

### `__init__.py`

```python
def register(_ctx):
    """Hermes 插件入口，界面贡献由 Dashboard 脚本注册。"""
```

### `dashboard/manifest.json`

```json
{
  "name": "my-chat-panel",
  "label": "聊天摘要",
  "version": "0.1.0",
  "tab": { "path": "/my-chat-panel" },
  "entry": "index.js",
  "slots": ["chat:top"]
}
```

### `dashboard/index.js`

```javascript
(() => {
  const name = 'my-chat-panel'
  const { React, components } = window.__HERMES_PLUGIN_SDK__
  const { register, registerSlot } = window.__HERMES_PLUGINS__
  const h = React.createElement

  function Page() {
    const [expanded, setExpanded] = React.useState(false)
    return h(components.Card, null,
      h(components.CardContent, null,
        h('h1', null, '聊天摘要'),
        h(components.Button, { onClick: () => setExpanded(value => !value) }, expanded ? '收起示例' : '查看示例'),
        expanded && h('p', null, '示例数据：当前没有已连接的摘要数据源。'),
      ),
    )
  }

  function ChatTop() {
    return h('p', null, '聊天摘要 · 示例')
  }

  register(name, Page)
  registerSlot(name, 'chat:top', ChatTop)
})()
```

`plugin.yaml`、Dashboard 清单和注册调用使用同一插件名，两个清单使用同一版本。`slots` 声明用途，实际渲染取决于脚本注册。可选样式写入 `dashboard/` 并由清单的 `css` 指向。页面和 CSS 限定在插件自身容器内。

## 3. 检查、安装和复测

1. 检查入口和样式文件存在，运行现有构建和测试。新建纯 JavaScript 插件可先用 `node --check dashboard/index.js`，再写一个 Node 检查，用 `node:vm` 执行入口并用宿主注册函数替身收集调用，断言实际插件名、页面和插槽与清单一致。已有 `npm run check` 时直接运行。注册检查与客户端交互分别记录。
2. 用插件自己的 Git 仓库保存源码与可加载产物。已有可用 Git 地址时，按用户授权推送到指定仓库。需要用户提供仓库地址时，先交付已完成的本地插件，再给出准确的发布和安装步骤。客户端从「专家管理 → 目标 Profile → 插件」接受 `owner/repo` 或 HTTPS Git 地址。仅在用户要求安装且能确认目标是本产品 Profile 时执行。当前支持 Git 安装和市场入口，本地目录直接导入与聊天一键安装留待后续。
3. 在目标 Profile 安装并启用，从「Dashboard 界面状态」核对页面和实际插槽。从「更多」打开独立页面，按需求点击交互，并从实际聊天确认插槽位置。更改已推送时使用「更新」，需要重新读取已安装产物时使用「重新扫描」。停用后确认界面贡献撤下。涉及 Profile 隔离时，再用另一个 Profile 核对。
4. 失败时先定位阶段。安装失败看管理页结果，入口加载失败检查清单的文件名及产物，入口已加载但未注册时核对运行异常、注册名和插槽名，已注册但不可见时核对路由、`tab.hidden`、覆盖配置和所选 Profile。修复已复现的问题后重跑对应验证。

交付时给出工作区插件路径、Git 地址或待发布步骤、安装后的可见位置、实际运行过的检查与验收结果。只完成静态检查时，说明客户端安装和交互仍待验证。
