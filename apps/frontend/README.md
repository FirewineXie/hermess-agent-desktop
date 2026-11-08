# 前端项目

React 界面代码位于 `src/`。桌面客户端通过 `mountApp(root, api)` 注入宿主能力；浏览器预览使用明确的模拟实现，不连接真实 Hermes，也不代表原生窗口验收。

## 当前结构

- `src/public.tsx`：公开装配入口。
- `src/App.tsx`：页面装配、导航及跨页面协调。
- `src/features/`：各 View 的控制器在所属功能目录。聊天的会话、事件补发、审批、附件状态在 `chat/useChatController.ts`；模型配置与选择在 `models/useModelController.ts`；运行时启动与存储状态在 `runtime/useRuntimeController.ts`；客户端集成工具的应用级清单、安装和本机探测状态在 `tools/useToolsController.ts`；统一安全/高级配置的读写、草稿与保存状态在 `configuration/useConfigEditor.ts`。各功能组件留在所属目录。
- `src/app/DesktopContext.tsx`：宿主能力注入。
- `src/features/models/components/ProviderCard.tsx`：提供方模型清单和本地编辑状态。
- `src/features/agent-settings/components/`：配置字段、分组树、辅助模型任务卡片与完整 YAML 编辑器；View 组合组件并呈现控制器状态。
- `src/features/about/`：「关于」三个 Tab，以及左侧独立的「软件更新」页、RC/正式版渠道偏好和纯版本比较规则；无可信发行源时不报告更新结果。
- `src/features/runtime/`：运行时与存储设置、独立的开发者诊断页。诊断页默认隐藏入口，在主聊天页面空白区域连续点击五次后打开。
- `src/features/channels/`：飞书、微信、Telegram、钉钉、企微群机器人、QQ Bot 与 WhatsApp 优先扫码；其他消息渠道按锁定 Gateway 返回的字段配置、启停并测试连接。扫码凭据由 Rust 保管，前端只显示二维码和非敏感状态；WhatsApp 扫码复用锁定 Dashboard 的配对记录，配置保存后由桌面端负责重启，不调用 fork 的自动重启接口。异常退出时 WhatsApp Node 进程的桌面兜底回收尚待双平台原生验收。
- `src/features/workspaces/`：本地工作区目录快捷入口、当前新会话目录选择；选中的目录在创建新会话时传给桌面宿主，恢复旧会话不改其原目录。
- `src/preview/`：浏览器预览的模拟宿主。
- `src/locales/`：界面文案与 Agent 配置翻译。
- `tests/`：前端纯逻辑测试，与 `src/` 中的产品代码分开。

## 本地命令

从仓库根目录运行 `pnpm install --frozen-lockfile` 后，可使用：

```sh
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend build
pnpm --dir apps/frontend test:recovery
pnpm --dir apps/frontend dev
```

预览地址为 `http://127.0.0.1:1421`。生产桌面 UI 由 `apps/desktop` 装配和构建。前端源码不得直接导入 `@tauri-apps/*`，也不得使用原生命令或事件字符串；通过 `DesktopApi` 的具名能力调用宿主。

## 本批设置能力开发预览

运行前端开发服务器后，访问 `/settings-capabilities-preview.html` 检查委派路由、提供商同步对话框和桌面设置；`?quick` 查看快捷输入窗。此入口始终使用 `PREVIEW_ONLY` 内存模拟，不注册系统快捷键或写入真实 Profile。实现及原生验收范围见 [设置能力记录](../../docs/settings-models-desktop-capabilities.md)。

## 聊天媒体开发预览

`/media-preview.html` 使用内存宿主检查 `MEDIA:`、Markdown 图片和文件链接、图片放大、音视频控件、文件卡、加载失败与重试、会话切换和资源释放。音频是内存生成的 WAV，视频由浏览器 Canvas/MediaRecorder 生成，不读取用户文件；模拟下载和定位不调用系统。此入口只验证前端，不证明 Tauri 自定义协议、原生保存对话框或双平台解码已经验收。

媒体组件只调用注入的 `DesktopApi.media`，通过 `ChatMediaProvider` 获取对应会话及 Gateway epoch；后台任务使用任务自己的会话归属。解析保留代码块和行内代码，流式未完成路径等待完整边界再读取；历史恢复保留正文中的 `MEDIA:`。支持的宿主读取方式和大小边界见 [桌面客户端说明](../desktop/README.md#聊天媒体读取)。

## 编程输入附件

编程输入框支持粘贴剪贴板图片（Windows `Ctrl+V`、macOS `Command+V`），通过「＋」选择图片或文件，以及桌面原生文件拖入。PNG、JPEG、GIF、WebP 作为图片输入发送，每轮最多四张、合计 20 MiB；剪贴板图片在前端内存中保留，无需先保存为文件，桌面接收方校验编码、格式与总大小。其他文件显示为可移除的「文件引用」，发送时附上本地路径，由编程工具按当前权限读取，不直接上传文件内容。发送失败保留附件，新建或切换会话清空；编程任务运行中禁止添加。只有当前页面订阅拖放，避免文件进入隐藏的普通聊天。
