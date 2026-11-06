# 桌面外观偏好

Hermess 的外观属于产品设备设置，不写入 Hermes Profile 的 `dashboard.theme` 或 `dashboard.font`。原因是产品页面由自己的 React 宿主实现，外观应在同一设备上跨 Profile 保持一致；锁定 Dashboard 的字段只控制上游网页皮肤。

当前提供浅色、深色和跟随系统三种颜色模式，以及系统无衬线、系统衬线和系统等宽三种字体族。偏好保存在产品 WebView 的本地存储中，不加载远程字体。Windows 和 macOS 都通过 `prefers-color-scheme` 响应系统外观；显式选择浅色或深色后不再跟随系统。

自动验证覆盖损坏值回退、字段独立校验和系统颜色解析。前端类型检查与生产构建验证组件和样式可打包；Windows/macOS 原生窗口的完整页面对比、操作系统主题实时切换和本地存储清理后的行为仍需分别验收。
